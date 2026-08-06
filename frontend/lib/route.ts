export type GeneratedCheckpoint = {
  name: string
  lat: number
  lng: number
  expected_time: string
}

export type RoutePoint = {
  lat: number
  lng: number
}

export type GeocodedPlace = {
  id: string
  name: string
  lat: number
  lng: number
}

type OsrmStep = {
  distance: number
  duration: number
  name?: string
  // OSRM tags every step with the profile that actually computed it. This is
  // the field that exposed the walking/driving mixup in the first place -
  // requesting the "foot" profile from the wrong server came back with every
  // step tagged mode:"driving". See validateRouteMode below.
  mode?: string
  maneuver?: {
    location?: [number, number]
  }
}

type GeoapifyResult = {
  place_id: string
  formatted: string
  lat: number
  lon: number
}

export async function searchPlaces(
  query: string,
  signal?: AbortSignal,
  // Where to prioritize results from. Without this, Geoapify ranks purely on
  // text relevance with no location context, so a query like "park" or
  // "market" while standing in Bangalore could easily surface a
  // better-known match in a different city entirely before any nearby
  // option - which is what "very limited set of places showing" actually
  // was: not too few results existing, but the relevant nearby ones losing
  // to unrelated better-known ones with an identical name. Passing the
  // user's current position as a proximity bias fixes the ranking without
  // hard-excluding anything.
  near?: { lat: number; lng: number }
): Promise<GeocodedPlace[]> {
  const trimmedQuery = query.trim()
  if (trimmedQuery.length < 3) return []

  const apiKey = process.env.NEXT_PUBLIC_GEOAPIFY_API_KEY
  if (!apiKey) throw new Error('Geoapify API key is not configured')

  const params = new URLSearchParams({
    text: trimmedQuery,
    format: 'json',
    // Was hardcoded to 5, which is what made it feel like only a tiny
    // sliver of a city's places ever showed up. 20 gives enough room to
    // actually scroll through nearby options instead of getting cut off
    // after a handful of the "most globally relevant" matches.
    limit: '20',
    apiKey,
  })
  if (near) {
    params.set('bias', `proximity:${near.lng},${near.lat}`)
  }
  const res = await fetch(`https://api.geoapify.com/v1/geocode/autocomplete?${params}`, {
    signal,
  })

  if (!res.ok) throw new Error('Could not look up places')

  const data = (await res.json()) as { results?: GeoapifyResult[] }

  return (data.results ?? []).map((place) => ({
    id: place.place_id,
    name: place.formatted,
    lat: place.lat,
    lng: place.lon,
  }))
}

export type TravelMode = 'walking' | 'driving'

export type RouteResult = {
  checkpoints: GeneratedCheckpoint[]
  // The full walking-route polyline, in order. Sent to the backend so it can
  // measure "how far along the intended route" someone actually is (see
  // ProjectOntoPolyline server-side) instead of requiring an exact-radius
  // hit on a handful of fixed pins - which only works if you walk the one
  // specific path OSRM happened to pick. Empty if OSRM didn't return
  // geometry for some reason; the backend falls back to the old
  // radius-only behavior in that case.
  geometry: RoutePoint[]
  // What the routing API actually confirmed it computed this route for -
  // not just what we asked for. Show this in the UI so the mode is never a
  // silent assumption.
  travelMode: TravelMode
  // Raw numbers straight from the routing API - what the "Confirmed via
  // routing API" line shows, so that confirmation stays honest even though
  // checkpoint expected_time values (below) are padded for driving.
  totalMeters: number
  totalSeconds: number
  averageKmh: number
  // Elapsed time actually used to schedule checkpoints, after the traffic
  // buffer (driving only - equals totalSeconds for walking).
  scheduledTotalSeconds: number
  trafficBufferApplied: boolean
}

// OSRM's public routing server computes free-flow driving time only - it has
// no traffic data, so it assumes every road is clear. In real city traffic
// (signals, congestion) an actual drive commonly takes several times longer
// than this estimate. Without accounting for that, a "driving" session would
// reintroduce the exact bug already fixed for walking: checkpoints expected
// way too soon, triggering false "overdue" alerts the moment real traffic
// shows up. Padding driving ETAs by this factor before they're used to set
// checkpoint times (not before they're shown as the "confirmed" API numbers,
// which stay raw/honest).
const DRIVING_TRAFFIC_BUFFER = 1.6

// router.project-osrm.org's own driving profile is legitimate (it's the one
// profile that server actually hosts properly - verified: real streets,
// realistic ~40 km/h urban driving pace). Its /foot/ endpoint is the broken
// one - it accepts the URL but silently serves the same car-profile data
// back, which is how a 6km route once showed up as a 6-minute walk.
// routing.openstreetmap.de/routed-foot is a real walking-profile OSRM
// instance (confirmed: ~4.5 km/h implied pace, mode:"walking" on every
// step), so that's used for walking instead.
const ROUTE_PROFILES: Record<
  TravelMode,
  { buildUrl: (sLng: number, sLat: number, eLng: number, eLat: number) => string; expectedStepMode: string }
> = {
  walking: {
    buildUrl: (sLng, sLat, eLng, eLat) =>
      `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${sLng},${sLat};${eLng},${eLat}?steps=true&overview=full&geometries=geojson`,
    expectedStepMode: 'walking',
  },
  driving: {
    buildUrl: (sLng, sLat, eLng, eLat) =>
      `https://router.project-osrm.org/route/v1/driving/${sLng},${sLat};${eLng},${eLat}?steps=true&overview=full&geometries=geojson`,
    expectedStepMode: 'driving',
  },
}

// Never trust a routing API to have actually honored what you asked for -
// check its own labels and the physics of what it returned. This exists
// specifically because that trust failed silently once already (asked for
// walking, quietly got driving speeds back). Two independent checks: the
// API's own per-step mode tag, and a sanity bound on the implied pace.
function validateRouteMode(
  steps: OsrmStep[],
  travelMode: TravelMode,
  totalMeters: number,
  totalSeconds: number
) {
  const expectedStepMode = ROUTE_PROFILES[travelMode].expectedStepMode
  const mismatchedStep = steps.find((step) => step.mode && step.mode !== expectedStepMode)
  if (mismatchedStep) {
    throw new Error(
      `The routing service returned "${mismatchedStep.mode}" data for a ${travelMode} request, not "${expectedStepMode}" - refusing to use it. Please try generating checkpoints again.`
    )
  }

  const impliedKmh = totalSeconds > 0 ? (totalMeters / totalSeconds) * 3.6 : 0
  if (travelMode === 'walking' && impliedKmh > 9) {
    throw new Error(
      `This route's timing implies ${impliedKmh.toFixed(0)} km/h, which isn't a walking pace - the routing service likely returned driving data. Refusing to use it.`
    )
  }
}

// OSRM's turn-by-turn steps already carry everything a real checkpoint
// needs: a road/place name (step.name) and exact distance/duration for that
// segment - straight from the routing engine, not guessed client-side. So
// "generate checkpoints" is really just "walk the steps and pick well-spaced
// ones," using each step's own name and cumulative timing.
const CHECKPOINT_INTERVAL_METERS = 800
const MAX_INTERMEDIATE_CHECKPOINTS = 6
const MIN_ROUTE_METERS_FOR_INTERMEDIATE = 300

type StepWaypoint = {
  lat: number
  lng: number
  name: string
  // Distance/duration already covered by the time you reach this point -
  // i.e. this step hasn't been walked yet, but everything before it has.
  cumulativeDistance: number
  cumulativeDuration: number
}

function buildStepWaypoints(steps: OsrmStep[]): StepWaypoint[] {
  const waypoints: StepWaypoint[] = []
  let cumulativeDistance = 0
  let cumulativeDuration = 0

  for (const step of steps) {
    const location = step.maneuver?.location
    if (location) {
      waypoints.push({
        lat: location[1],
        lng: location[0],
        name: step.name?.trim() ?? '',
        cumulativeDistance,
        cumulativeDuration,
      })
    }
    cumulativeDistance += step.distance ?? 0
    cumulativeDuration += step.duration ?? 0
  }

  return waypoints
}

export async function getRouteCheckpoints(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
  startTime: Date,
  travelMode: TravelMode = 'walking'
): Promise<RouteResult> {
  const profile = ROUTE_PROFILES[travelMode]
  const url = profile.buildUrl(startLng, startLat, endLng, endLat)

  const res = await fetch(url)
  const data = (await res.json()) as {
    routes?: Array<{
      distance?: number
      duration?: number
      legs?: Array<{
        steps?: OsrmStep[]
      }>
      geometry?: {
        coordinates?: Array<[number, number]>
      }
    }>
  }

  if (!data.routes || data.routes.length === 0) {
    throw new Error(`No ${travelMode} route found between these points`)
  }

  const routeData = data.routes[0]
  const geometry: RoutePoint[] = (routeData.geometry?.coordinates ?? []).map(
    ([lng, lat]) => ({ lat, lng })
  )

  const steps = routeData.legs?.[0]?.steps ?? []
  const totalSeconds = routeData.duration ?? steps.reduce((sum, step) => sum + step.duration, 0)
  const totalMeters = routeData.distance ?? steps.reduce((sum, step) => sum + step.distance, 0)

  validateRouteMode(steps, travelMode, totalMeters, totalSeconds)

  const trafficBufferApplied = travelMode === 'driving'
  const timeMultiplier = trafficBufferApplied ? DRIVING_TRAFFIC_BUFFER : 1
  const scheduledTotalSeconds = totalSeconds * timeMultiplier

  const checkpoints: GeneratedCheckpoint[] = []
  checkpoints.push({
    name: 'Start',
    lat: startLat,
    lng: startLng,
    expected_time: startTime.toISOString(),
  })

  // Number of stops scales with how long the route actually is, instead of
  // always dropping exactly one fixed "Midpoint" regardless of whether the
  // route is 300m or 30km.
  if (steps.length > 2 && totalMeters >= MIN_ROUTE_METERS_FOR_INTERMEDIATE) {
    const waypoints = buildStepWaypoints(steps)
    // First waypoint is Start, last is Destination - both already added
    // explicitly with the exact place names the user searched for, so only
    // the ones in between are candidates.
    const candidates = waypoints.slice(1, -1)

    let lastPickedDistance = 0
    let intermediateIndex = 0
    for (const waypoint of candidates) {
      if (intermediateIndex >= MAX_INTERMEDIATE_CHECKPOINTS) break
      if (waypoint.cumulativeDistance - lastPickedDistance < CHECKPOINT_INTERVAL_METERS) continue

      intermediateIndex += 1
      checkpoints.push({
        // Real street/place name from OSRM. Some short unnamed paths (e.g.
        // an unclassified footway) come back with an empty name - fall back
        // to a numbered label only in that specific case.
        name: waypoint.name || `Checkpoint ${intermediateIndex}`,
        lat: waypoint.lat,
        lng: waypoint.lng,
        // Real elapsed time to this exact point along the route, from
        // OSRM's own per-step duration, padded by the traffic buffer for
        // driving - not a distance-proportional guess either way.
        expected_time: new Date(
          startTime.getTime() + waypoint.cumulativeDuration * timeMultiplier * 1000
        ).toISOString(),
      })
      lastPickedDistance = waypoint.cumulativeDistance
    }
  }

  checkpoints.push({
    name: 'Destination',
    lat: endLat,
    lng: endLng,
    expected_time: new Date(startTime.getTime() + scheduledTotalSeconds * 1000).toISOString(),
  })

  return {
    checkpoints,
    geometry,
    travelMode,
    totalMeters,
    totalSeconds,
    averageKmh: totalSeconds > 0 ? (totalMeters / totalSeconds) * 3.6 : 0,
    scheduledTotalSeconds,
    trafficBufferApplied,
  }
}

// Unchanged logic from the web app's lib/route.ts - plain fetch calls to
// Geoapify and OSRM, framework agnostic. Only the env var prefix changed.
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

// How far a "local area" extends around the user for place search - roughly
// a large metro area's radius. Bias alone (below) only *reorders* results,
// it doesn't guarantee your city actually wins the limited result slots:
// for a common word ("park", "market", a chain name) Geoapify's text
// relevance can still out-rank a same-named place a few km away even with
// proximity bias applied, which is exactly what "still not showing every
// place in Blr" was. A hard filter guarantees every result is actually
// local. See the fallback below for when someone genuinely wants a
// destination further away.
const LOCAL_SEARCH_RADIUS_METERS = 60_000

async function fetchGeoapifyAutocomplete(
  trimmedQuery: string,
  apiKey: string,
  signal: AbortSignal | undefined,
  near: { lat: number; lng: number } | undefined,
  restrictToLocalArea: boolean
): Promise<GeoapifyResult[]> {
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
    if (restrictToLocalArea) {
      params.set('filter', `circle:${near.lng},${near.lat},${LOCAL_SEARCH_RADIUS_METERS}`)
    }
  }
  const res = await fetch(`https://api.geoapify.com/v1/geocode/autocomplete?${params}`, {
    signal,
  })
  if (!res.ok) throw new Error('Could not look up places')
  const data = (await res.json()) as { results?: GeoapifyResult[] }
  return data.results ?? []
}

export async function searchPlaces(
  query: string,
  signal?: AbortSignal,
  // Where to prioritize (and, first, restrict) results to. See
  // LOCAL_SEARCH_RADIUS_METERS above for why this is a hard filter, not
  // just a ranking hint.
  near?: { lat: number; lng: number }
): Promise<GeocodedPlace[]> {
  const trimmedQuery = query.trim()
  if (trimmedQuery.length < 3) return []

  const apiKey = process.env.EXPO_PUBLIC_GEOAPIFY_API_KEY
  if (!apiKey) throw new Error('Geoapify API key is not configured')

  let results = await fetchGeoapifyAutocomplete(trimmedQuery, apiKey, signal, near, true)

  // Nothing turned up locally - the destination might genuinely be outside
  // the immediate area (planning ahead for a trip to a different city, for
  // instance) rather than actually not existing. Retry without the hard
  // filter instead of just showing "no results" for something real.
  if (results.length === 0 && near) {
    results = await fetchGeoapifyAutocomplete(trimmedQuery, apiKey, signal, near, false)
  }

  return results.map((place) => ({
    id: place.place_id,
    name: place.formatted,
    lat: place.lat,
    lng: place.lon,
  }))
}

type GeoapifyReverseResult = {
  formatted?: string
  street?: string
  suburb?: string
  neighbourhood?: string
  district?: string
  city?: string
}

// Turns a bare coordinate into a short, human-readable place label. Used for
// two things: labeling route checkpoints that land on an unnamed path (see
// resolveCheckpointName below), and naming the "use my current location as
// start" suggestion instead of showing raw lat/lng to confirm against.
export async function reverseGeocodePlaceName(
  lat: number,
  lng: number,
  signal?: AbortSignal
): Promise<string | null> {
  const apiKey = process.env.EXPO_PUBLIC_GEOAPIFY_API_KEY
  if (!apiKey) return null

  try {
    const params = new URLSearchParams({
      lat: String(lat),
      lon: String(lng),
      format: 'json',
      apiKey,
    })
    const res = await fetch(`https://api.geoapify.com/v1/geocode/reverse?${params}`, { signal })
    if (!res.ok) return null

    const data = (await res.json()) as { results?: GeoapifyReverseResult[] }
    const result = data.results?.[0]
    if (!result) return null

    return (
      result.street ||
      result.suburb ||
      result.neighbourhood ||
      result.district ||
      result.city ||
      result.formatted ||
      null
    )
  } catch {
    return null
  }
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

const CHECKPOINT_INTERVAL_METERS = 800
const MAX_INTERMEDIATE_CHECKPOINTS = 6
const MIN_ROUTE_METERS_FOR_INTERMEDIATE = 300

// Each OSRM step covers a distance/duration range along the route -
// [startDistance, startDistance + distance). Kept as ranges (not just a
// single point per step, like the old maneuver-only approach) so any
// distance along the whole route can be mapped back to "which step, and how
// far into it."
type StepRange = {
  name: string
  startDistance: number
  distance: number
  startDuration: number
  duration: number
}

function buildStepRanges(steps: OsrmStep[]): StepRange[] {
  const ranges: StepRange[] = []
  let cumulativeDistance = 0
  let cumulativeDuration = 0

  for (const step of steps) {
    const distance = step.distance ?? 0
    const duration = step.duration ?? 0
    ranges.push({
      name: step.name?.trim() ?? '',
      startDistance: cumulativeDistance,
      distance,
      startDuration: cumulativeDuration,
      duration,
    })
    cumulativeDistance += distance
    cumulativeDuration += duration
  }

  return ranges
}

function findStepRangeIndex(ranges: StepRange[], distance: number): number {
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i]
    if (distance < range.startDistance + range.distance || i === ranges.length - 1) {
      return i
    }
  }
  return Math.max(0, ranges.length - 1)
}

// A step's own duration only tells you how long the *whole* step takes -
// this interpolates for a point partway through it, assuming roughly
// constant pace across the step (true enough for an 800m sampling interval).
function interpolateDuration(range: StepRange, distance: number): number {
  if (range.distance <= 0) return range.startDuration
  const progress = Math.min(1, Math.max(0, (distance - range.startDistance) / range.distance))
  return range.startDuration + progress * range.duration
}

// Scans outward in both directions from an unnamed step for the nearest one
// that does have a name. Unnamed steps are common on real routes - short
// unclassified footways, driveways, minor lanes - and are exactly what used
// to fall back to a bare "Checkpoint 3": meaningless on its own, but a named
// street is very likely a few steps away in either direction on the same
// route.
function findNearestNamedStepRange(ranges: StepRange[], fromIndex: number): string | null {
  for (let distance = 1; distance < ranges.length; distance++) {
    const before = ranges[fromIndex - distance]
    if (before?.name) return before.name
    const after = ranges[fromIndex + distance]
    if (after?.name) return after.name
  }
  return null
}

// Picks the best available label for a checkpoint, in order of how good the
// information actually is: OSRM's own name for the step at this point, then
// the nearest named street elsewhere on the route, then (only if the entire
// route has nothing named nearby, which is rare) whatever a reverse-geocode
// lookup says is actually at that spot. A numbered "Checkpoint N" is the
// last resort, not the default it used to be.
async function resolveCheckpointName(
  ranges: StepRange[],
  rangeIndex: number,
  lat: number,
  lng: number,
  intermediateIndex: number
): Promise<string> {
  const range = ranges[rangeIndex]
  if (range?.name) return range.name

  const nearestNamed = findNearestNamedStepRange(ranges, rangeIndex)
  if (nearestNamed) return `Near ${nearestNamed}`

  const reverseGeocoded = await reverseGeocodePlaceName(lat, lng)
  if (reverseGeocoded) return reverseGeocoded

  return `Checkpoint ${intermediateIndex}`
}

// Great-circle distance between two route points, used to reconstruct real
// arc-length distance along OSRM's raw geometry (which has many more points
// than just its turn-by-turn maneuvers).
function haversineMeters(a: RoutePoint, b: RoutePoint): number {
  const earthRadiusMeters = 6_371_000
  const toRadians = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRadians(b.lat - a.lat)
  const dLng = toRadians(b.lng - a.lng)
  const sinDLat = Math.sin(dLat / 2)
  const sinDLng = Math.sin(dLng / 2)
  const h =
    sinDLat * sinDLat +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * sinDLng * sinDLng
  return 2 * earthRadiusMeters * Math.asin(Math.min(1, Math.sqrt(h)))
}

type GeometrySample = { lat: number; lng: number; cumulativeDistance: number }

// Walks OSRM's raw route geometry (dense points along the actual path) and
// tags each point with its real arc-length distance from the start. This -
// not the handful of turn-by-turn maneuver points - is what checkpoint
// spacing is now based on, so a long, mostly-straight stretch of road with
// few or no turns still gets checkpoints every ~800m instead of none at all.
function buildGeometrySamples(geometry: RoutePoint[]): GeometrySample[] {
  const samples: GeometrySample[] = []
  let cumulativeDistance = 0

  for (let i = 0; i < geometry.length; i++) {
    if (i > 0) cumulativeDistance += haversineMeters(geometry[i - 1], geometry[i])
    samples.push({ lat: geometry[i].lat, lng: geometry[i].lng, cumulativeDistance })
  }

  return samples
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
  // route is 300m or 30km - and, since this samples the route's actual
  // geometry rather than just its turn-by-turn maneuvers, a long stretch of
  // road with few or no turns (a direct trip along one main road, say) still
  // gets checkpoints every ~800m instead of the maneuver-only approach
  // silently producing zero.
  if (totalMeters >= MIN_ROUTE_METERS_FOR_INTERMEDIATE && geometry.length > 1) {
    const stepRanges = buildStepRanges(steps)
    const samples = buildGeometrySamples(geometry)

    let lastPickedDistance = 0
    let intermediateIndex = 0
    for (const sample of samples) {
      if (intermediateIndex >= MAX_INTERMEDIATE_CHECKPOINTS) break
      if (sample.cumulativeDistance - lastPickedDistance < CHECKPOINT_INTERVAL_METERS) continue

      const rangeIndex = findStepRangeIndex(stepRanges, sample.cumulativeDistance)
      intermediateIndex += 1
      const name = await resolveCheckpointName(
        stepRanges,
        rangeIndex,
        sample.lat,
        sample.lng,
        intermediateIndex
      )
      checkpoints.push({
        name,
        lat: sample.lat,
        lng: sample.lng,
        // Real elapsed time to this exact point along the route, from
        // OSRM's own per-step duration interpolated across the step it
        // falls within, padded by the traffic buffer for driving - not a
        // distance-proportional guess either way.
        expected_time: new Date(
          startTime.getTime() +
            interpolateDuration(stepRanges[rangeIndex], sample.cumulativeDistance) *
              timeMultiplier *
              1000
        ).toISOString(),
      })
      lastPickedDistance = sample.cumulativeDistance
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

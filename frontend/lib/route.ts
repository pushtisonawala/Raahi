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
  near?: { lat: number; lng: number }
): Promise<GeocodedPlace[]> {
  const trimmedQuery = query.trim()
  if (trimmedQuery.length < 3) return []

  const apiKey = process.env.NEXT_PUBLIC_GEOAPIFY_API_KEY
  if (!apiKey) throw new Error('Geoapify API key is not configured')

  let results = await fetchGeoapifyAutocomplete(trimmedQuery, apiKey, signal, near, true)

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

export async function reverseGeocodePlaceName(
  lat: number,
  lng: number,
  signal?: AbortSignal
): Promise<string | null> {
  const apiKey = process.env.NEXT_PUBLIC_GEOAPIFY_API_KEY
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
  geometry: RoutePoint[]
  travelMode: TravelMode
  totalMeters: number
  totalSeconds: number
  averageKmh: number
  scheduledTotalSeconds: number
  trafficBufferApplied: boolean
}

const DRIVING_TRAFFIC_BUFFER = 1.6

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

function interpolateDuration(range: StepRange, distance: number): number {
  if (range.distance <= 0) return range.startDuration
  const progress = Math.min(1, Math.max(0, (distance - range.startDistance) / range.distance))
  return range.startDuration + progress * range.duration
}

function findNearestNamedStepRange(ranges: StepRange[], fromIndex: number): string | null {
  for (let distance = 1; distance < ranges.length; distance++) {
    const before = ranges[fromIndex - distance]
    if (before?.name) return before.name
    const after = ranges[fromIndex + distance]
    if (after?.name) return after.name
  }
  return null
}

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

  if (totalMeters >= MIN_ROUTE_METERS_FOR_INTERMEDIATE && geometry.length > 1) {
    const stepRanges = buildStepRanges(steps)
    const samples = buildGeometrySamples(geometry)

    const targetIntermediateCount = Math.min(
      MAX_INTERMEDIATE_CHECKPOINTS,
      Math.max(1, Math.round(totalMeters / CHECKPOINT_INTERVAL_METERS))
    )
    const pickInterval = totalMeters / (targetIntermediateCount + 1)

    let nextPickDistance = pickInterval
    let intermediateIndex = 0
    for (const sample of samples) {
      if (intermediateIndex >= targetIntermediateCount) break
      if (sample.cumulativeDistance < nextPickDistance) continue

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
        expected_time: new Date(
          startTime.getTime() +
            interpolateDuration(stepRanges[rangeIndex], sample.cumulativeDistance) *
              timeMultiplier *
              1000
        ).toISOString(),
      })
      nextPickDistance += pickInterval
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

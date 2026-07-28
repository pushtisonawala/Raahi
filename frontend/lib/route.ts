export type GeneratedCheckpoint = {
  name: string
  lat: number
  lng: number
  expected_time: string
}

export type GeocodedPlace = {
  id: string
  name: string
  lat: number
  lng: number
}

type OsrmStep = {
  duration: number
  name?: string
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
  signal?: AbortSignal
): Promise<GeocodedPlace[]> {
  const trimmedQuery = query.trim()
  if (trimmedQuery.length < 3) return []

  const apiKey = process.env.NEXT_PUBLIC_GEOAPIFY_API_KEY
  if (!apiKey) throw new Error('Geoapify API key is not configured')

  const params = new URLSearchParams({
    text: trimmedQuery,
    format: 'json',
    limit: '5',
    apiKey,
  })
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

export async function getRouteCheckpoints(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
  startTime: Date
): Promise<GeneratedCheckpoint[]> {
  const url = `https://router.project-osrm.org/route/v1/foot/${startLng},${startLat};${endLng},${endLat}?steps=true&overview=false`

  const res = await fetch(url)
  const data = (await res.json()) as {
    routes?: Array<{
      legs?: Array<{
        steps?: OsrmStep[]
      }>
    }>
  }

  if (!data.routes || data.routes.length === 0) {
    throw new Error('No walking route found between these points')
  }

  const steps = data.routes[0].legs?.[0]?.steps ?? []
  const checkpoints: GeneratedCheckpoint[] = []
  let cumulativeSeconds = 0

  steps.forEach((step, index) => {
    cumulativeSeconds += step.duration
    if (index === 0) return

    const location = step.maneuver?.location
    if (!location) return

    const expectedTime = new Date(startTime.getTime() + cumulativeSeconds * 1000)
    checkpoints.push({
      name: step.name || `Stop ${index}`,
      lat: location[1],
      lng: location[0],
      expected_time: expectedTime.toISOString(),
    })
  })

  return checkpoints
}

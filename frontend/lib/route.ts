export type GeneratedCheckpoint = {
  name: string
  lat: number
  lng: number
  expected_time: string
}

export type GeocodedPlace = {
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

type NominatimResult = {
  display_name: string
  lat: string
  lon: string
}

export async function geocodePlace(query: string): Promise<GeocodedPlace> {
  const trimmedQuery = query.trim()
  if (!trimmedQuery) {
    throw new Error('Enter a place name first')
  }

  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(trimmedQuery)}`
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  })

  if (!res.ok) {
    throw new Error('Could not look up that place')
  }

  const results = (await res.json()) as NominatimResult[]
  const first = results[0]
  if (!first) {
    throw new Error(`No results found for "${trimmedQuery}"`)
  }

  return {
    name: first.display_name,
    lat: Number(first.lat),
    lng: Number(first.lon),
  }
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
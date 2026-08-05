package geo

import "math"

// Point is a plain lat/lng pair, used to represent a route's polyline
// (the sequence of coordinates a routing engine like OSRM says the person
// will walk between checkpoints).
type Point struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

// CumulativeDistances returns, for each point in the polyline, the walking
// distance (meters) from the first point up to that point, plus the total
// length of the whole polyline. cum[0] is always 0.
func CumulativeDistances(points []Point) (cum []float64, total float64) {
	cum = make([]float64, len(points))
	for i := 1; i < len(points); i++ {
		d := DistanceMeters(points[i-1].Lat, points[i-1].Lng, points[i].Lat, points[i].Lng)
		cum[i] = cum[i-1] + d
	}
	if len(cum) > 0 {
		total = cum[len(cum)-1]
	}
	return cum, total
}

// ProjectOntoPolyline finds the closest point on the polyline to (lat, lng)
// and returns:
//   - deviationMeters: the perpendicular distance from (lat, lng) to the
//     route - how far "off the path" the person currently is.
//   - progressMeters: the arc-length distance along the polyline, from its
//     start, to that closest point - how far along the route they've gotten,
//     regardless of which literal street they took to get there.
//
// This is what lets a session tolerate someone taking a different street
// than the one a routing engine originally picked: instead of requiring the
// walker to physically enter a small radius around a handful of fixed pins
// (which only exist on one specific path), progress is measured as "how far
// along the intended route, as the crow flies from the nearest point on it,"
// which stays meaningful even when the literal path taken differs block to
// block.
//
// The projection uses a local equirectangular (flat-plane) approximation
// centered on the polyline, which is accurate to well under a meter of
// error at city-block scale and much cheaper than full geodesic segment
// math.
func ProjectOntoPolyline(points []Point, lat, lng float64) (deviationMeters, progressMeters float64) {
	if len(points) == 0 {
		return math.Inf(1), 0
	}
	if len(points) == 1 {
		return DistanceMeters(lat, lng, points[0].Lat, points[0].Lng), 0
	}

	cum, _ := CumulativeDistances(points)

	refLat := points[0].Lat * math.Pi / 180
	const metersPerDegLat = 111320.0
	metersPerDegLng := 111320.0 * math.Cos(refLat)

	toXY := func(p Point) (float64, float64) {
		return p.Lng * metersPerDegLng, p.Lat * metersPerDegLat
	}
	qx, qy := toXY(Point{Lat: lat, Lng: lng})

	bestDist := math.Inf(1)
	bestProgress := 0.0

	for i := 0; i < len(points)-1; i++ {
		ax, ay := toXY(points[i])
		bx, by := toXY(points[i+1])
		dx, dy := bx-ax, by-ay
		segLenSq := dx*dx + dy*dy

		t := 0.0
		if segLenSq > 0 {
			t = ((qx-ax)*dx + (qy-ay)*dy) / segLenSq
			if t < 0 {
				t = 0
			} else if t > 1 {
				t = 1
			}
		}

		projX, projY := ax+t*dx, ay+t*dy
		dist := math.Hypot(qx-projX, qy-projY)

		if dist < bestDist {
			bestDist = dist
			segLen := cum[i+1] - cum[i]
			bestProgress = cum[i] + t*segLen
		}
	}

	return bestDist, bestProgress
}

package geo

import "testing"

// A straight north-south line, roughly 1.1km long (0.01 degrees of latitude
// is ~1112m). Easy to reason about by hand.
func straightLine() []Point {
	return []Point{
		{Lat: 12.9000, Lng: 77.6000},
		{Lat: 12.9050, Lng: 77.6000},
		{Lat: 12.9100, Lng: 77.6000},
	}
}

func TestCumulativeDistancesTotalMatchesEndpoints(t *testing.T) {
	points := straightLine()
	cum, total := CumulativeDistances(points)

	if cum[0] != 0 {
		t.Fatalf("expected cum[0] == 0, got %f", cum[0])
	}
	if len(cum) != len(points) {
		t.Fatalf("expected %d cumulative entries, got %d", len(points), len(cum))
	}

	directDistance := DistanceMeters(points[0].Lat, points[0].Lng, points[len(points)-1].Lat, points[len(points)-1].Lng)
	if diff := total - directDistance; diff > 1 || diff < -1 {
		t.Fatalf("expected total (%f) to match direct distance on a straight line (%f)", total, directDistance)
	}
}

func TestProjectOntoPolyline_OnRoute(t *testing.T) {
	points := straightLine()

	// A point sitting almost exactly on the midpoint of the line should
	// report near-zero deviation and progress at roughly half the total
	// length.
	_, total := CumulativeDistances(points)
	deviation, progress := ProjectOntoPolyline(points, 12.9050, 77.6000)

	if deviation > 1 {
		t.Fatalf("expected near-zero deviation for a point on the route, got %f meters", deviation)
	}
	if diff := progress - total/2; diff > 5 || diff < -5 {
		t.Fatalf("expected progress near %f (half the route), got %f", total/2, progress)
	}
}

func TestProjectOntoPolyline_OffRouteButAheadStillMakesProgress(t *testing.T) {
	points := straightLine()

	// Standing ~100m to the side (different street, same latitude as the
	// route's midpoint) should register meaningful deviation but should
	// still credit progress roughly at the midpoint - this is exactly the
	// "took a different street but is still on pace" case.
	deviation, progress := ProjectOntoPolyline(points, 12.9050, 77.6009)
	_, total := CumulativeDistances(points)

	if deviation < 50 {
		t.Fatalf("expected a noticeable deviation for a point ~100m off the route, got %f meters", deviation)
	}
	if diff := progress - total/2; diff > 20 || diff < -20 {
		t.Fatalf("expected progress to still track along-route position (~%f), got %f", total/2, progress)
	}
}

func TestProjectOntoPolyline_BeforeStartClampsToZero(t *testing.T) {
	points := straightLine()

	_, progress := ProjectOntoPolyline(points, 12.8990, 77.6000)
	if progress != 0 {
		t.Fatalf("expected progress to clamp to 0 for a point behind the route start, got %f", progress)
	}
}

func TestProjectOntoPolyline_PastEndClampsToTotal(t *testing.T) {
	points := straightLine()
	_, total := CumulativeDistances(points)

	_, progress := ProjectOntoPolyline(points, 12.9110, 77.6000)
	if diff := progress - total; diff > 1 || diff < -1 {
		t.Fatalf("expected progress to clamp to total (%f) past the route end, got %f", total, progress)
	}
}

package geo

import "testing"

func TestDistanceMeters_SamePointIsZero(t *testing.T) {
	got := DistanceMeters(12.9716, 77.5946, 12.9716, 77.5946)
	if got != 0 {
		t.Errorf("DistanceMeters(same point) = %v; want 0", got)
	}
}


func TestDistanceMeters_KnownDistance(t *testing.T) {
	const mgRoadLat, mgRoadLng = 12.9716, 77.6033
	const airportLat, airportLng = 13.1986, 77.7066

	got := DistanceMeters(mgRoadLat, mgRoadLng, airportLat, airportLng)

	const wantMeters = 34_500.0
	const toleranceMeters = 2_000.0

	diff := got - wantMeters
	if diff < 0 {
		diff = -diff
	}
	if diff > toleranceMeters {
		t.Errorf("DistanceMeters(MG Road, airport) = %v meters; want ~%v (+/- %v)", got, wantMeters, toleranceMeters)
	}
}

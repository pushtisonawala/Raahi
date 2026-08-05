package models

import (
	"time"

	"github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/geo"
)

type Checkpoint struct {
	ID           string     `json:"id"`
	SessionID    string     `json:"session_id"`
	Name         string     `json:"name"`
	Status       string     `json:"status"`
	ExpectedTime *time.Time `json:"expected_time,omitempty"`
	Lat          *float64   `json:"lat,omitempty"`
	Lng          *float64   `json:"lng,omitempty"`
	RadiusMeters int        `json:"radius_meters"`
	OrderIndex   int        `json:"order_index"`
	// DistanceMeters is this checkpoint's position along its session's
	// RouteGeometry (arc length from the route start). Nil when the session
	// has no route geometry, in which case reaching a checkpoint falls back
	// to the radius-based check against Lat/Lng.
	DistanceMeters *float64 `json:"distance_meters,omitempty"`
}

type Session struct {
	ID             string       `json:"id"`
	UserID         string       `json:"user_id"`
	Status         string       `json:"status"`
	StartedAt      time.Time    `json:"started_at"`
	LastLat        *float64     `json:"last_lat,omitempty"`
	LastLng        *float64     `json:"last_lng,omitempty"`
	LastLocationAt *time.Time   `json:"last_location_at,omitempty"`
	Checkpoints    []Checkpoint `json:"checkpoints,omitempty"`
	// RouteGeometry is the full walking-route polyline from the routing
	// engine, used to measure progress-along-route rather than requiring
	// exact-radius hits on a handful of fixed pins (see internal/geo).
	RouteGeometry    []geo.Point `json:"route_geometry,omitempty"`
	RouteTotalMeters *float64    `json:"route_total_meters,omitempty"`
	ProgressMeters   float64     `json:"progress_meters"`
	RouteDeviation   bool        `json:"route_deviation"`
}

package models

import "time"

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
}

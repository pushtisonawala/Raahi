package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/db"
	"github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/geo"
	"github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/ws"
)

type checkpointInput struct {
	Name         string     `json:"name"`
	ExpectedTime *time.Time `json:"expected_time"`
	Lat          float64    `json:"lat"`
	Lng          float64    `json:"lng"`
	RadiusMeters int        `json:"radius_meters"`
}

type createSessionInput struct {
	Name        string            `json:"name"`
	Route       string            `json:"route"`
	GracePeriod int               `json:"grace_period"`
	Checkpoints []checkpointInput `json:"checkpoints"`
	// RouteGeometry is optional: the full walking-route polyline (ordered
	// lat/lng points) from the client's routing lookup. When present, each
	// checkpoint's along-route position is precomputed and stored so that
	// later location updates can measure "progress along the intended
	// route" instead of requiring an exact-radius hit on each pin - see
	// internal/geo.ProjectOntoPolyline and UpdateLocationHandler.
	RouteGeometry []geo.Point `json:"route_geometry"`
	// TravelMode records which routing profile (walking/driving) produced
	// this route, so a later auto-reroute asks for the same kind of route
	// again instead of guessing. Defaults to "walking" for older clients
	// that don't send it.
	TravelMode string `json:"travel_mode"`
}

// rerouteInput is the payload for POST /sessions/:id/reroute: a freshly
// computed route (same shape the client already builds via
// lib/route.ts#getRouteCheckpoints) from wherever the walker currently is to
// the same destination, sent when they've strayed far enough from the
// original path that the fixed-corridor progress tracking would otherwise
// just freeze. See RerouteSessionHandler.
type rerouteInput struct {
	Checkpoints   []checkpointInput `json:"checkpoints"`
	RouteGeometry []geo.Point       `json:"route_geometry"`
}

type checkpointResponse struct {
	ID             string     `json:"id"`
	Name           string     `json:"name"`
	Status         string     `json:"status"`
	ExpectedTime   *time.Time `json:"expected_time"`
	Lat            *float64   `json:"lat"`
	Lng            *float64   `json:"lng"`
	RadiusMeters   int        `json:"radius_meters"`
	OrderIndex     int        `json:"order_index"`
	DistanceMeters *float64   `json:"distance_meters,omitempty"`
}

type sessionResponse struct {
	ID          string               `json:"id"`
	UserID      string               `json:"user_id"`
	Name        string               `json:"name"`
	Route       string               `json:"route"`
	Status      string               `json:"status"`
	GracePeriod int                  `json:"grace_period"`
	StartedAt   time.Time            `json:"started_at"`
	CompletedAt *time.Time           `json:"completed_at"`
	Checkpoints []checkpointResponse `json:"checkpoints"`

	RouteTotalMeters *float64 `json:"route_total_meters,omitempty"`
	ProgressMeters   float64  `json:"progress_meters"`
	RouteDeviation   bool     `json:"route_deviation"`
	// TravelMode is returned so the active-session screen knows which
	// routing profile to re-request from the client-side routing lookup if
	// it ever needs to auto-reroute (see RerouteSessionHandler).
	TravelMode string `json:"travel_mode"`
}

// precomputeRoute mirrors what CreateSessionHandler and RerouteSessionHandler
// both need: the route polyline as JSON to store, its total length, and each
// checkpoint's precomputed along-route distance (so later location updates
// don't have to re-project the whole polyline every time). Shared so a
// reroute computes its replacement checkpoints' distances exactly the same
// way the original route did.
func precomputeRoute(geometry []geo.Point, checkpoints []checkpointInput) (
	geometryJSON []byte, totalMeters *float64, checkpointDistances []*float64, err error,
) {
	checkpointDistances = make([]*float64, len(checkpoints))
	if len(geometry) == 0 {
		return nil, nil, checkpointDistances, nil
	}

	geometryJSON, err = json.Marshal(geometry)
	if err != nil {
		return nil, nil, nil, err
	}
	_, total := geo.CumulativeDistances(geometry)
	totalMeters = &total

	for i, cp := range checkpoints {
		_, progress := geo.ProjectOntoPolyline(geometry, cp.Lat, cp.Lng)
		d := progress
		checkpointDistances[i] = &d
	}
	return geometryJSON, totalMeters, checkpointDistances, nil
}

func CreateSessionHandler(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(userIDKey).(string)

	var req createSessionInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if len(req.Checkpoints) == 0 {
		http.Error(w, "at least one checkpoint is required", http.StatusBadRequest)
		return
	}
	if req.Name == "" {
		req.Name = "Safety session"
	}
	if req.GracePeriod <= 0 {
		req.GracePeriod = 5
	}
	if req.TravelMode == "" {
		req.TravelMode = "walking"
	}

	// If the client sent a route polyline, precompute its total length and
	// each checkpoint's along-route distance now, once, rather than
	// re-projecting the whole polyline on every future location update.
	routeGeometryJSON, routeTotalMeters, checkpointDistances, err := precomputeRoute(req.RouteGeometry, req.Checkpoints)
	if err != nil {
		http.Error(w, "invalid route geometry", http.StatusBadRequest)
		return
	}

	tx, err := db.Pool.Begin(r.Context())
	if err != nil {
		http.Error(w, "failed to start session", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(r.Context())

	var sessionID string
	err = tx.QueryRow(r.Context(),
		`INSERT INTO sessions (user_id, name, route, status, grace_period, route_geometry, route_total_meters, travel_mode)
		 VALUES ($1, $2, $3, 'active', $4, $5, $6, $7) RETURNING id`,
		userID, req.Name, req.Route, req.GracePeriod, routeGeometryJSON, routeTotalMeters, req.TravelMode,
	).Scan(&sessionID)
	if err != nil {
		http.Error(w, "failed to create session", http.StatusInternalServerError)
		return
	}

	for i, cp := range req.Checkpoints {
		radius := cp.RadiusMeters
		if radius == 0 {
			radius = 75
		}
		_, err = tx.Exec(r.Context(),
			`INSERT INTO checkpoints (session_id, name, status, expected_time, lat, lng, radius_meters, order_index, distance_meters)
			 VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7, $8)`,
			sessionID, cp.Name, cp.ExpectedTime, cp.Lat, cp.Lng, radius, i, checkpointDistances[i],
		)
		if err != nil {
			http.Error(w, "failed to create checkpoint", http.StatusInternalServerError)
			return
		}
	}

	if err := tx.Commit(r.Context()); err != nil {
		http.Error(w, "failed to save session", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"id": sessionID})
}

func GetSessionHandler(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(userIDKey).(string)
	sessionID := chi.URLParam(r, "id")

	var session sessionResponse
	err := db.Pool.QueryRow(r.Context(),
		`SELECT id, user_id, name, route, status, grace_period, started_at, completed_at,
		        route_total_meters, progress_meters, route_deviation, travel_mode
		 FROM sessions WHERE id = $1 AND user_id = $2`,
		sessionID, userID,
	).Scan(
		&session.ID, &session.UserID, &session.Name, &session.Route, &session.Status,
		&session.GracePeriod, &session.StartedAt, &session.CompletedAt,
		&session.RouteTotalMeters, &session.ProgressMeters, &session.RouteDeviation, &session.TravelMode,
	)
	if err != nil {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}

	session.Checkpoints, err = loadCheckpoints(r.Context(), sessionID)
	if err != nil {
		http.Error(w, "failed to fetch checkpoints", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(session)
}

func CompleteSessionHandler(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(userIDKey).(string)
	sessionID := chi.URLParam(r, "id")

	tag, err := db.Pool.Exec(r.Context(),
		`UPDATE sessions SET status = 'completed', completed_at = NOW()
		 WHERE id = $1 AND user_id = $2 AND status = 'active'`,
		sessionID, userID,
	)
	if err != nil {
		http.Error(w, "failed to complete session", http.StatusInternalServerError)
		return
	}
	if tag.RowsAffected() == 0 {
		http.Error(w, "session not found or not active", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "completed"})
}

func ListSessionsHandler(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(userIDKey).(string)

	rows, err := db.Pool.Query(r.Context(),
		`SELECT id, user_id, name, route, status, grace_period, started_at, completed_at,
		        route_total_meters, progress_meters, route_deviation, travel_mode
		 FROM sessions WHERE user_id = $1 ORDER BY started_at DESC`,
		userID,
	)
	if err != nil {
		http.Error(w, "failed to fetch sessions", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	sessions := []sessionResponse{}
	for rows.Next() {
		var session sessionResponse
		if err := rows.Scan(
			&session.ID, &session.UserID, &session.Name, &session.Route, &session.Status,
			&session.GracePeriod, &session.StartedAt, &session.CompletedAt,
			&session.RouteTotalMeters, &session.ProgressMeters, &session.RouteDeviation, &session.TravelMode,
		); err != nil {
			http.Error(w, "failed to read sessions", http.StatusInternalServerError)
			return
		}
		sessions = append(sessions, session)
	}
	if err := rows.Err(); err != nil {
		http.Error(w, "failed to read sessions", http.StatusInternalServerError)
		return
	}
	rows.Close()

	for i := range sessions {
		sessions[i].Checkpoints, err = loadCheckpoints(r.Context(), sessions[i].ID)
		if err != nil {
			http.Error(w, "failed to fetch checkpoints", http.StatusInternalServerError)
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sessions)
}

func loadCheckpoints(ctx context.Context, sessionID string) ([]checkpointResponse, error) {
	rows, err := db.Pool.Query(ctx,
		`SELECT id, name, status, expected_time, lat, lng, radius_meters, order_index, distance_meters
		 FROM checkpoints WHERE session_id = $1 ORDER BY order_index ASC`,
		sessionID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	checkpoints := []checkpointResponse{}
	for rows.Next() {
		var checkpoint checkpointResponse
		if err := rows.Scan(
			&checkpoint.ID, &checkpoint.Name, &checkpoint.Status, &checkpoint.ExpectedTime,
			&checkpoint.Lat, &checkpoint.Lng, &checkpoint.RadiusMeters, &checkpoint.OrderIndex,
			&checkpoint.DistanceMeters,
		); err != nil {
			return nil, err
		}
		checkpoints = append(checkpoints, checkpoint)
	}
	return checkpoints, rows.Err()
}

// RerouteSessionHandler replaces a session's route with a freshly computed
// one from wherever the walker currently is to the same destination.
//
// The original design locked onto a single OSRM route computed at session
// start and froze progress if you strayed more than corridorToleranceMeters
// from it - fine if you walk the exact path a routing engine happened to
// pick, but not how real trips actually go: a closed road, a shortcut, a
// wrong turn. This is the fix - once the client (see the active-session
// screens) notices sustained deviation via the route_deviation flag on
// progress_update websocket events, it computes a brand new route in its
// existing lib/route.ts (same mode, same validation, same traffic buffer
// logic already in place) from the current position to the same destination,
// and POSTs it here. This swaps in that new polyline and checkpoint set and
// resets the progress baseline to 0 against it, exactly like a turn-by-turn
// nav app's "recalculating route."
//
// Already-reached (or contacts_alerted) checkpoints are left untouched -
// this only replaces the ones still ahead - so the checkpoint history
// doesn't get rewritten every time someone takes a different street.
func RerouteSessionHandler(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(userIDKey).(string)
	sessionID := chi.URLParam(r, "id")

	var req rerouteInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if len(req.Checkpoints) == 0 {
		http.Error(w, "at least one checkpoint is required", http.StatusBadRequest)
		return
	}

	routeGeometryJSON, routeTotalMeters, checkpointDistances, err := precomputeRoute(req.RouteGeometry, req.Checkpoints)
	if err != nil {
		http.Error(w, "invalid route geometry", http.StatusBadRequest)
		return
	}

	tx, err := db.Pool.Begin(r.Context())
	if err != nil {
		http.Error(w, "failed to start reroute", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(r.Context())

	tag, err := tx.Exec(r.Context(),
		`UPDATE sessions
		 SET route_geometry = $1, route_total_meters = $2, progress_meters = 0, route_deviation = false
		 WHERE id = $3 AND user_id = $4 AND status = 'active'`,
		routeGeometryJSON, routeTotalMeters, sessionID, userID,
	)
	if err != nil {
		http.Error(w, "failed to update session route", http.StatusInternalServerError)
		return
	}
	if tag.RowsAffected() == 0 {
		http.Error(w, "session not found or not active", http.StatusNotFound)
		return
	}

	// Only checkpoints still ahead of you get replaced - anything already
	// reached (or already escalated to contacts) stays as a true record of
	// what actually happened during the session.
	if _, err := tx.Exec(r.Context(),
		`DELETE FROM checkpoints WHERE session_id = $1 AND status IN ('pending', 'overdue', 'pinged')`,
		sessionID,
	); err != nil {
		http.Error(w, "failed to replace checkpoints", http.StatusInternalServerError)
		return
	}

	var nextOrderIndex int
	if err := tx.QueryRow(r.Context(),
		`SELECT COALESCE(MAX(order_index), -1) + 1 FROM checkpoints WHERE session_id = $1`,
		sessionID,
	).Scan(&nextOrderIndex); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		http.Error(w, "failed to replace checkpoints", http.StatusInternalServerError)
		return
	}

	for i, cp := range req.Checkpoints {
		radius := cp.RadiusMeters
		if radius == 0 {
			radius = 75
		}
		if _, err := tx.Exec(r.Context(),
			`INSERT INTO checkpoints (session_id, name, status, expected_time, lat, lng, radius_meters, order_index, distance_meters)
			 VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7, $8)`,
			sessionID, cp.Name, cp.ExpectedTime, cp.Lat, cp.Lng, radius, nextOrderIndex+i, checkpointDistances[i],
		); err != nil {
			http.Error(w, "failed to replace checkpoints", http.StatusInternalServerError)
			return
		}
	}

	if err := tx.Commit(r.Context()); err != nil {
		http.Error(w, "failed to save rerouted session", http.StatusInternalServerError)
		return
	}

	checkpoints, err := loadCheckpoints(r.Context(), sessionID)
	if err != nil {
		http.Error(w, "failed to fetch checkpoints", http.StatusInternalServerError)
		return
	}

	ws.GlobalHub.Broadcast(sessionID, map[string]interface{}{
		"type": "route_recalculated",
	})
	ws.GlobalHub.Broadcast(sessionID, map[string]interface{}{
		"type":             "progress_update",
		"progress_meters":  0,
		"deviation_meters": 0,
		"route_deviation":  false,
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"checkpoints": checkpoints})
}

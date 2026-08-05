package api

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/db"
	"github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/geo"
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

	// If the client sent a route polyline, precompute its total length and
	// each checkpoint's along-route distance now, once, rather than
	// re-projecting the whole polyline on every future location update.
	var routeGeometryJSON []byte
	var routeTotalMeters *float64
	checkpointDistances := make([]*float64, len(req.Checkpoints))

	if len(req.RouteGeometry) > 0 {
		var err error
		routeGeometryJSON, err = json.Marshal(req.RouteGeometry)
		if err != nil {
			http.Error(w, "invalid route geometry", http.StatusBadRequest)
			return
		}
		_, total := geo.CumulativeDistances(req.RouteGeometry)
		routeTotalMeters = &total

		for i, cp := range req.Checkpoints {
			_, progress := geo.ProjectOntoPolyline(req.RouteGeometry, cp.Lat, cp.Lng)
			d := progress
			checkpointDistances[i] = &d
		}
	}

	tx, err := db.Pool.Begin(r.Context())
	if err != nil {
		http.Error(w, "failed to start session", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(r.Context())

	var sessionID string
	err = tx.QueryRow(r.Context(),
		`INSERT INTO sessions (user_id, name, route, status, grace_period, route_geometry, route_total_meters)
		 VALUES ($1, $2, $3, 'active', $4, $5, $6) RETURNING id`,
		userID, req.Name, req.Route, req.GracePeriod, routeGeometryJSON, routeTotalMeters,
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
		        route_total_meters, progress_meters, route_deviation
		 FROM sessions WHERE id = $1 AND user_id = $2`,
		sessionID, userID,
	).Scan(
		&session.ID, &session.UserID, &session.Name, &session.Route, &session.Status,
		&session.GracePeriod, &session.StartedAt, &session.CompletedAt,
		&session.RouteTotalMeters, &session.ProgressMeters, &session.RouteDeviation,
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
		        route_total_meters, progress_meters, route_deviation
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
			&session.RouteTotalMeters, &session.ProgressMeters, &session.RouteDeviation,
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

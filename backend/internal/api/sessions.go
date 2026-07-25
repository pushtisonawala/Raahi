package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/db"
)

type checkpointInput struct {
	Name         string     `json:"name"`
	ExpectedTime *time.Time `json:"expected_time"`
	Lat          float64    `json:"lat"`
	Lng          float64    `json:"lng"`
	RadiusMeters int        `json:"radius_meters"`
}

type createSessionInput struct {
	Checkpoints []checkpointInput `json:"checkpoints"`
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

	tx, err := db.Pool.Begin(r.Context())
	if err != nil {
		http.Error(w, "failed to start session", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(r.Context())

	var sessionID string
	err = tx.QueryRow(r.Context(),
		`INSERT INTO sessions (user_id, status) VALUES ($1, 'active') RETURNING id`,
		userID,
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
			`INSERT INTO checkpoints (session_id, name, status, expected_time, lat, lng, radius_meters, order_index)
			 VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7)`,
			sessionID, cp.Name, cp.ExpectedTime, cp.Lat, cp.Lng, radius, i,
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

	var session struct {
		ID        string    `json:"id"`
		UserID    string    `json:"user_id"`
		Status    string    `json:"status"`
		StartedAt time.Time `json:"started_at"`
	}
	err := db.Pool.QueryRow(r.Context(),
		`SELECT id, user_id, status, started_at FROM sessions WHERE id = $1 AND user_id = $2`,
		sessionID, userID,
	).Scan(&session.ID, &session.UserID, &session.Status, &session.StartedAt)
	if err != nil {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}

	rows, err := db.Pool.Query(r.Context(),
		`SELECT id, name, status, lat, lng, radius_meters, order_index
		 FROM checkpoints WHERE session_id = $1 ORDER BY order_index ASC`,
		sessionID,
	)
	if err != nil {
		http.Error(w, "failed to fetch checkpoints", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	checkpoints := []map[string]interface{}{}
	for rows.Next() {
		var id, name, status string
		var lat, lng *float64
		var radius, orderIndex int
		if err := rows.Scan(&id, &name, &status, &lat, &lng, &radius, &orderIndex); err != nil {
			http.Error(w, "failed to read checkpoints", http.StatusInternalServerError)
			return
		}
		checkpoints = append(checkpoints, map[string]interface{}{
			"id": id, "name": name, "status": status,
			"lat": lat, "lng": lng,
			"radius_meters": radius, "order_index": orderIndex,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id": session.ID, "user_id": session.UserID, "status": session.Status,
		"started_at": session.StartedAt, "checkpoints": checkpoints,
	})
}

func ListSessionsHandler(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(userIDKey).(string)

	rows, err := db.Pool.Query(r.Context(),
		`SELECT id, status, started_at FROM sessions WHERE user_id = $1 ORDER BY started_at DESC`,
		userID,
	)
	if err != nil {
		http.Error(w, "failed to fetch sessions", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	sessions := []map[string]interface{}{}
	for rows.Next() {
		var id, status string
		var startedAt time.Time
		if err := rows.Scan(&id, &status, &startedAt); err != nil {
			http.Error(w, "failed to read sessions", http.StatusInternalServerError)
			return
		}
		sessions = append(sessions, map[string]interface{}{
			"id": id, "status": status, "started_at": startedAt,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sessions)
}

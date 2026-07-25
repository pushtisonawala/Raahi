package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/db"
	"github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/geo"
)

type locationRequest struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

func UpdateLocationHandler(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(userIDKey).(string)
	sessionID := chi.URLParam(r, "id")

	var req locationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.Lat < -90 || req.Lat > 90 || req.Lng < -180 || req.Lng > 180 {
		http.Error(w, "invalid coordinates", http.StatusBadRequest)
		return
	}

	tag, err := db.Pool.Exec(r.Context(),
		`UPDATE sessions SET last_lat = $1, last_lng = $2, last_location_at = $3 WHERE id = $4 AND user_id = $5`,
		req.Lat, req.Lng, time.Now(), sessionID, userID,
	)
	if err != nil {
		http.Error(w, "failed to update location", http.StatusInternalServerError)
		return
	}
	if tag.RowsAffected() == 0 {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}
	var checkpointID string
	var cpLat, cpLng *float64
	var radius int
	err = db.Pool.QueryRow(r.Context(),
		`SELECT id, lat, lng, radius_meters FROM checkpoints
		 WHERE session_id = $1 AND status = 'pending'
		 ORDER BY order_index ASC LIMIT 1`,
		sessionID,
	).Scan(&checkpointID, &cpLat, &cpLng, &radius)

	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		http.Error(w, "failed to fetch checkpoint", http.StatusInternalServerError)
		return
	}

	if err == nil && cpLat != nil && cpLng != nil {
		distance := geo.DistanceMeters(req.Lat, req.Lng, *cpLat, *cpLng)
		if distance <= float64(radius) {
			if _, err := db.Pool.Exec(r.Context(),
				`UPDATE checkpoints SET status = 'reached' WHERE id = $1`,
				checkpointID,
			); err != nil {
				http.Error(w, "failed to update checkpoint", http.StatusInternalServerError)
				return
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "location updated"})
}

package api

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/db"
)

func generateToken() (string, error) {
	bytes := make([]byte, 24)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

func CreateShareLinkHandler(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(userIDKey).(string)
	sessionID := chi.URLParam(r, "id")

	var exists bool
	err := db.Pool.QueryRow(r.Context(),
		`SELECT EXISTS(SELECT 1 FROM sessions WHERE id = $1 AND user_id = $2)`,
		sessionID, userID,
	).Scan(&exists)
	if err != nil || !exists {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}

	token, err := generateToken()
	if err != nil {
		http.Error(w, "failed to generate token", http.StatusInternalServerError)
		return
	}

	expiresAt := time.Now().Add(12 * time.Hour)
	_, err = db.Pool.Exec(r.Context(),
		`INSERT INTO share_links (session_id, token, expires_at, revoked) VALUES ($1, $2, $3, false)`,
		sessionID, token, expiresAt,
	)
	if err != nil {
		http.Error(w, "failed to create share link", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"token": token, "expires_at": expiresAt.Format(time.RFC3339)})
}

func GetSharedSessionHandler(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")

	var sessionID string
	var revoked bool
	var expiresAt time.Time
	err := db.Pool.QueryRow(r.Context(),
		`SELECT session_id, revoked, expires_at FROM share_links WHERE token = $1`,
		token,
	).Scan(&sessionID, &revoked, &expiresAt)
	if err != nil {
		http.Error(w, "invalid link", http.StatusNotFound)
		return
	}
	if revoked || time.Now().After(expiresAt) {
		http.Error(w, "this link has expired", http.StatusGone)
		return
	}

	var status string
	var lastLat, lastLng *float64
	err = db.Pool.QueryRow(r.Context(),
		`SELECT status, last_lat, last_lng FROM sessions WHERE id = $1`,
		sessionID,
	).Scan(&status, &lastLat, &lastLng)
	if err != nil {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}

	rows, err := db.Pool.Query(r.Context(),
		`SELECT name, status FROM checkpoints WHERE session_id = $1 ORDER BY order_index ASC`,
		sessionID,
	)
	if err != nil {
		http.Error(w, "failed to fetch checkpoints", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	checkpoints := []map[string]string{}
	for rows.Next() {
		var name, cpStatus string
		if scanErr := rows.Scan(&name, &cpStatus); scanErr != nil {
			http.Error(w, "failed to read checkpoints", http.StatusInternalServerError)
			return
		}
		checkpoints = append(checkpoints, map[string]string{"name": name, "status": cpStatus})
	}
	if err := rows.Err(); err != nil {
		http.Error(w, "failed to read checkpoints", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"session_id":  sessionID,
		"status":      status,
		"last_lat":    lastLat,
		"last_lng":    lastLng,
		"checkpoints": checkpoints,
	})
}

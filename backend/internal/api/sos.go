package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/db"
	"github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/ws"
)

func TriggerSOSHandler(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(userIDKey).(string)
	sessionID := chi.URLParam(r, "id")

	// Used to send contact-alert emails synchronously, right here, before
	// responding - meaning a slow or hanging SMTP server made the SOS
	// button itself hang for the person using it. Now this just marks the
	// session and queues an outbox event; the outbox dispatcher (already
	// timeout- and circuit-breaker-protected via notify.SendEmail) sends
	// the actual emails a moment later, off the request path. Same atomic
	// CTE pattern as sweeper.go: the UPDATE and the INSERT either both
	// happen or neither does.
	tag, err := db.Pool.Exec(r.Context(), `
		WITH triggered AS (
			UPDATE sessions SET status = 'sos_triggered'
			WHERE id = $1 AND user_id = $2
			RETURNING id
		)
		INSERT INTO outbox_events (event_type, payload)
		SELECT 'sos_email', jsonb_build_object('session_id', id)
		FROM triggered
	`, sessionID, userID)
	if err != nil {
		http.Error(w, "failed to trigger sos", http.StatusInternalServerError)
		return
	}
	if tag.RowsAffected() == 0 {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}

	ws.GlobalHub.BroadcastDurable(r.Context(), sessionID, "sos_triggered", map[string]string{"type": "sos_triggered"})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "sos_triggered"})
}

package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/db"
	"github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/notify"
	"github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/ws"
)

func TriggerSOSHandler(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(userIDKey).(string)
	sessionID := chi.URLParam(r, "id")

	var lastLat, lastLng *float64
	err := db.Pool.QueryRow(r.Context(),
		`UPDATE sessions SET status = 'sos_triggered'
		 WHERE id = $1 AND user_id = $2
		 RETURNING last_lat, last_lng`,
		sessionID, userID,
	).Scan(&lastLat, &lastLng)
	if err != nil {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}

	ws.GlobalHub.Broadcast(sessionID, map[string]string{"type": "sos_triggered"})

	rows, err := db.Pool.Query(r.Context(),
		`SELECT email FROM contacts WHERE user_id = $1 AND email IS NOT NULL AND email != ''`,
		userID,
	)
	if err != nil {
		log.Printf("sos: failed to load contacts for user %s: %v", userID, err)
	} else {
		defer rows.Close()

		locationText := "Location unavailable."
		if lastLat != nil && lastLng != nil {
			locationText = fmt.Sprintf("Last known location: %f, %f.", *lastLat, *lastLng)
		}

		for rows.Next() {
			var contactEmail string
			if err := rows.Scan(&contactEmail); err != nil {
				log.Printf("sos: failed to read contact email: %v", err)
				continue
			}

			plainBody := "This is an emergency alert. Your contact has triggered SOS. " + locationText
			htmlBody := "<p>This is an emergency alert. Your contact has triggered SOS. " + locationText + "</p>"
			if err := notify.SendEmail(
				contactEmail,
				"SOS: your contact needs help now",
				plainBody,
				htmlBody,
			); err != nil {
				log.Printf("sos: failed to email contact %s: %v", contactEmail, err)
			}
		}
		if err := rows.Err(); err != nil {
			log.Printf("sos: failed while reading contacts: %v", err)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "sos_triggered"})
}

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

		// Raw decimal coordinates aren't something most people can act on in
		// the middle of an emergency - a tappable map link that drops a pin
		// exactly where the person last was is what actually helps someone
		// find them. Google Maps' "q=lat,lng" URL scheme opens directly to
		// that point with no API key required, and works from any email
		// client on any device.
		plainLocationText := "Location unavailable."
		htmlLocationText := "Location unavailable."
		if lastLat != nil && lastLng != nil {
			mapsURL := fmt.Sprintf("https://www.google.com/maps?q=%f,%f", *lastLat, *lastLng)
			plainLocationText = fmt.Sprintf("Last known location: %s (%f, %f)", mapsURL, *lastLat, *lastLng)
			htmlLocationText = fmt.Sprintf(
				`Last known location: <a href="%s">view on map</a> (%f, %f)`,
				mapsURL, *lastLat, *lastLng,
			)
		}

		for rows.Next() {
			var contactEmail string
			if err := rows.Scan(&contactEmail); err != nil {
				log.Printf("sos: failed to read contact email: %v", err)
				continue
			}

			plainBody := "This is an emergency alert. Your contact has triggered SOS.\n\n" + plainLocationText
			htmlBody := "<p>This is an emergency alert. Your contact has triggered SOS.</p><p>" + htmlLocationText + "</p>"
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

package outbox

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/db"
	"github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/notify"
)

const (
	tickInterval = 5 * time.Second
	batchSize    = 20
	maxAttempts  = 8
)

func Run(ctx context.Context, pool *pgxpool.Pool) {
	ticker := time.NewTicker(tickInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			dispatchBatch(ctx, pool)
		}
	}
}

type claimedEvent struct {
	id        string
	eventType string
	payload   json.RawMessage
	attempts  int
}

func dispatchBatch(ctx context.Context, pool *pgxpool.Pool) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		log.Printf("outbox: failed to begin transaction: %v", err)
		return
	}
	defer tx.Rollback(ctx)

	rows, err := tx.Query(ctx, `
		SELECT id, event_type, payload, attempts
		FROM outbox_events
		WHERE status = 'pending' AND next_attempt_at <= now()
		ORDER BY next_attempt_at
		LIMIT $1
		FOR UPDATE SKIP LOCKED
	`, batchSize)
	if err != nil {
		log.Printf("outbox: failed to query pending events: %v", err)
		return
	}

	var events []claimedEvent
	for rows.Next() {
		var e claimedEvent
		if scanErr := rows.Scan(&e.id, &e.eventType, &e.payload, &e.attempts); scanErr != nil {
			log.Printf("outbox: failed to scan event: %v", scanErr)
			continue
		}
		events = append(events, e)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		log.Printf("outbox: error iterating claimed events: %v", err)
		return
	}

	for _, e := range events {
		deliverErr := deliver(ctx, e.eventType, e.payload)

		if deliverErr == nil {
			if _, err := tx.Exec(ctx, `UPDATE outbox_events SET status = 'delivered' WHERE id = $1`, e.id); err != nil {
				log.Printf("outbox: failed to mark event %s delivered: %v", e.id, err)
			}
			continue
		}

		attempts := e.attempts + 1
		if attempts >= maxAttempts {
			if _, err := tx.Exec(ctx,
				`UPDATE outbox_events SET status = 'failed', attempts = $1, last_error = $2 WHERE id = $3`,
				attempts, deliverErr.Error(), e.id,
			); err != nil {
				log.Printf("outbox: failed to dead-letter event %s: %v", e.id, err)
			}
			log.Printf("outbox: event %s exhausted retries, dead-lettered: %v", e.id, deliverErr)
			continue
		}

		wait := backoff(attempts)
		if _, err := tx.Exec(ctx,
			`UPDATE outbox_events
			 SET attempts = $1, last_error = $2, next_attempt_at = now() + make_interval(secs => $3)
			 WHERE id = $4`,
			attempts, deliverErr.Error(), wait.Seconds(), e.id,
		); err != nil {
			log.Printf("outbox: failed to schedule retry for event %s: %v", e.id, err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		log.Printf("outbox: failed to commit dispatch batch: %v", err)
	}
}

func backoff(attempts int) time.Duration {
	const maxBackoff = 5 * time.Minute

	if attempts < 1 {
		attempts = 1
	}
	d := time.Duration(1<<uint(attempts)) * time.Second
	if d <= 0 || d > maxBackoff {
		return maxBackoff
	}
	return d
}

type overduePayload struct {
	CheckpointID string `json:"checkpoint_id"`
}

type contactAlertPayload struct {
	CheckpointID string `json:"checkpoint_id"`
}

type sosPayload struct {
	SessionID string `json:"session_id"`
}

func deliver(ctx context.Context, eventType string, payload json.RawMessage) error {
	switch eventType {
	case "overdue_email":
		var p overduePayload
		if err := json.Unmarshal(payload, &p); err != nil {
			return fmt.Errorf("invalid overdue_email payload: %w", err)
		}
		return SendOverdueEmail(ctx, p.CheckpointID)

	case "contact_alert_email":
		var p contactAlertPayload
		if err := json.Unmarshal(payload, &p); err != nil {
			return fmt.Errorf("invalid contact_alert_email payload: %w", err)
		}
		return SendContactEmails(ctx, p.CheckpointID)

	case "sos_email":
		var p sosPayload
		if err := json.Unmarshal(payload, &p); err != nil {
			return fmt.Errorf("invalid sos_email payload: %w", err)
		}
		return SendSOSEmails(ctx, p.SessionID)

	default:
		return fmt.Errorf("unknown outbox event_type: %s", eventType)
	}
}

// SendSOSEmails alerts every emergency contact configured for a session's
// owner that SOS was triggered. Looks up the session fresh at delivery
// time instead of trusting anything captured when the event was queued, so
// the location sent is whatever's true right now, not a stale snapshot.
func SendSOSEmails(ctx context.Context, sessionID string) error {
	from := os.Getenv("SMTP_EMAIL")
	password := os.Getenv("SMTP_PASSWORD")
	if from == "" || password == "" {
		log.Printf("outbox: SMTP not configured, skipping SOS email for session %s", sessionID)
		return nil
	}

	var userID string
	var lastLat, lastLng *float64
	if err := db.Pool.QueryRow(ctx,
		`SELECT user_id, last_lat, last_lng FROM sessions WHERE id = $1`,
		sessionID,
	).Scan(&userID, &lastLat, &lastLng); err != nil {
		return err
	}

	plainLocationText := "Location unavailable."
	htmlLocationText := "Location unavailable."
	if lastLat != nil && lastLng != nil {
		mapsURL := fmt.Sprintf("https://www.google.com/maps?q=%f,%f", *lastLat, *lastLng)
		plainLocationText = fmt.Sprintf("Last known location: %s (%f, %f)", mapsURL, *lastLat, *lastLng)
		htmlLocationText = fmt.Sprintf(`Last known location: <a href="%s">view on map</a> (%f, %f)`, mapsURL, *lastLat, *lastLng)
	}

	rows, err := db.Pool.Query(ctx,
		`SELECT email FROM contacts WHERE user_id = $1 AND email <> ''`,
		userID,
	)
	if err != nil {
		return err
	}
	defer rows.Close()

	var sentCount int
	for rows.Next() {
		var contactEmail string
		if err := rows.Scan(&contactEmail); err != nil {
			return err
		}
		plainBody := "This is an emergency alert. Your contact has triggered SOS.\n\n" + plainLocationText
		htmlBody := "<p>This is an emergency alert. Your contact has triggered SOS.</p><p>" + htmlLocationText + "</p>"
		if err := notify.SendEmail(contactEmail, "SOS: your contact needs help now", plainBody, htmlBody); err != nil {
			return err
		}
		sentCount++
	}

	if sentCount == 0 {
		log.Printf("outbox: no contact emails configured for SOS on session %s", sessionID)
	}
	return rows.Err()
}

func SendContactEmails(ctx context.Context, checkpointID string) error {
	from := os.Getenv("SMTP_EMAIL")
	password := os.Getenv("SMTP_PASSWORD")
	if from == "" || password == "" {
		log.Printf("outbox: SMTP not configured, skipping contact-alert email for checkpoint %s", checkpointID)
		return nil
	}

	var checkpointName string
	var userID string
	var lastLat, lastLng *float64
	if err := db.Pool.QueryRow(ctx,
		`SELECT c.name, s.user_id, s.last_lat, s.last_lng
		 FROM checkpoints c
		 JOIN sessions s ON s.id = c.session_id
		 WHERE c.id = $1`,
		checkpointID,
	).Scan(&checkpointName, &userID, &lastLat, &lastLng); err != nil {
		return err
	}

	plainLocationText := "Location unavailable."
	htmlLocationText := "Location unavailable."
	if lastLat != nil && lastLng != nil {
		mapsURL := fmt.Sprintf("https://www.google.com/maps?q=%f,%f", *lastLat, *lastLng)
		plainLocationText = fmt.Sprintf("Last known location: %s (%f, %f)", mapsURL, *lastLat, *lastLng)
		htmlLocationText = fmt.Sprintf(`Last known location: <a href="%s">view on map</a> (%f, %f)`, mapsURL, *lastLat, *lastLng)
	}

	rows, err := db.Pool.Query(ctx,
		`SELECT name, email
		 FROM contacts
		 WHERE user_id = $1 AND email <> ''`,
		userID,
	)
	if err != nil {
		return err
	}
	defer rows.Close()

	var sentCount int
	for rows.Next() {
		var contactName, contactEmail string
		if err := rows.Scan(&contactName, &contactEmail); err != nil {
			return err
		}
		plainBody := fmt.Sprintf(
			"%s, a checkpoint for %s was missed. Please reach out and check on them.\n\n%s",
			contactName, checkpointName, plainLocationText,
		)
		htmlBody := strings.Join([]string{
			"<p><strong>", contactName, "</strong>, a checkpoint for ", checkpointName, " was missed.</p>",
			"<p>Please reach out and check on them.</p>",
			"<p>", htmlLocationText, "</p>",
		}, "")
		if err := notify.SendEmail(contactEmail, "Checking in from Raahi", plainBody, htmlBody); err != nil {
			return err
		}
		sentCount++
	}

	if sentCount == 0 {
		log.Printf("outbox: no contact emails configured for checkpoint %s", checkpointID)
	}
	return rows.Err()
}

func SendOverdueEmail(ctx context.Context, checkpointID string) error {
	from := os.Getenv("SMTP_EMAIL")
	password := os.Getenv("SMTP_PASSWORD")
	if from == "" || password == "" {
		log.Printf("outbox: SMTP not configured, skipping overdue email for checkpoint %s", checkpointID)
		return nil
	}

	var recipientEmail, checkpointName string
	err := db.Pool.QueryRow(ctx,
		`SELECT u.email, c.name
		 FROM checkpoints c
		 JOIN sessions s ON s.id = c.session_id
		 JOIN users u ON u.id = s.user_id
		 WHERE c.id = $1`,
		checkpointID,
	).Scan(&recipientEmail, &checkpointName)
	if err != nil {
		return err
	}

	subject := "Safety check-in from Raahi"
	plainBody := fmt.Sprintf("Your Raahi checkpoint \"%s\" is overdue. Please check in as soon as possible.", checkpointName)
	htmlBody := fmt.Sprintf(
		"<p>Your Raahi checkpoint <strong>%s</strong> is overdue.</p><p>Please check in as soon as possible.</p>",
		checkpointName,
	)

	return notify.SendEmail(recipientEmail, subject, plainBody, htmlBody)
}

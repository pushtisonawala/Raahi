package sweeper

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/db"
	"github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/notify"
	"github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/ws"
)

const (
	gracePeriod1 = 5 * time.Minute // wait after expected_time before pinging
	gracePeriod2 = 3 * time.Minute // wait after ping before escalating
	tickInterval = 15 * time.Second
)

func Run(ctx context.Context, pool *pgxpool.Pool) {
	ticker := time.NewTicker(tickInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			sweepOnce(ctx, pool)
		}
	}
}
func sweepOnce(ctx context.Context, pool *pgxpool.Pool) {
	rows, err := pool.Query(ctx, `UPDATE checkpoints SET status='overdue' WHERE status='pending' AND expected_time IS NOT NULL AND expected_time <= now() RETURNING id, session_id`)
	if err != nil {
		log.Printf("sweeper stage1 error: %v", err)
	} else {
		for rows.Next() {
			var id, sessionID string
			if scanErr := rows.Scan(&id, &sessionID); scanErr != nil {
				log.Printf("sweeper stage1 scan error: %v", scanErr)
				continue
			}
			log.Printf("sweeper: checkpoint %s is now OVERDUE", id)
			ws.GlobalHub.Broadcast(sessionID, map[string]string{
				"type":          "checkpoint_overdue",
				"checkpoint_id": id,
			})
			if emailErr := sendOverdueEmail(ctx, id); emailErr != nil {
				log.Printf("sweeper email error for checkpoint %s: %v", id, emailErr)
			}
		}
		rows.Close()
	}

	rows, err = pool.Query(ctx,
		`UPDATE checkpoints SET status = 'pinged'
		 WHERE status = 'overdue' AND expected_time <= now() - $1::interval
		 RETURNING id, session_id`, gracePeriod1)
	if err != nil {
		log.Printf("sweeper stage2 error: %v", err)
	} else {
		for rows.Next() {
			var id, sessionID string
			if scanErr := rows.Scan(&id, &sessionID); scanErr != nil {
				log.Printf("sweeper stage2 scan error: %v", scanErr)
				continue
			}
			log.Printf("sweeper: checkpoint %s PINGED - would send push notification here", id)
			ws.GlobalHub.Broadcast(sessionID, map[string]string{
				"type":          "checkpoint_pinged",
				"checkpoint_id": id,
			})
		}
		rows.Close()
	}

	rows, err = pool.Query(ctx,
		`UPDATE checkpoints SET status = 'contacts_alerted'
		 WHERE status = 'pinged' AND expected_time <= now() - $1::interval
		 RETURNING id, session_id`, gracePeriod1+gracePeriod2)
	if err != nil {
		log.Printf("sweeper stage3 error: %v", err)
	} else {
		for rows.Next() {
			var id, sessionID string
			if scanErr := rows.Scan(&id, &sessionID); scanErr != nil {
				log.Printf("sweeper stage3 scan error: %v", scanErr)
				continue
			}
			log.Printf("sweeper: checkpoint %s ESCALATED - would send email to contacts here", id)
			if contactErr := sendContactEmails(ctx, id); contactErr != nil {
				log.Printf("sweeper contact email error for checkpoint %s: %v", id, contactErr)
			}
			ws.GlobalHub.Broadcast(sessionID, map[string]string{
				"type":          "contacts_alerted",
				"checkpoint_id": id,
			})
		}
		rows.Close()
	}
}

func sendOverdueEmail(ctx context.Context, checkpointID string) error {
	from := os.Getenv("SMTP_EMAIL")
	password := os.Getenv("SMTP_PASSWORD")
	if from == "" || password == "" {
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
	// Was interpolating the raw checkpoint UUID here instead of its name -
	// fixed to use the actual checkpoint (e.g. "1st Cross Road") like the
	// contacts-alerted email below already does.
	plainBody := fmt.Sprintf("Your Raahi checkpoint \"%s\" is overdue. Please check in as soon as possible.", checkpointName)
	htmlBody := fmt.Sprintf(
		"<p>Your Raahi checkpoint <strong>%s</strong> is overdue.</p><p>Please check in as soon as possible.</p>",
		checkpointName,
	)

	return notify.SendEmail(recipientEmail, subject, plainBody, htmlBody)
}

func sendContactEmails(ctx context.Context, checkpointID string) error {
	from := os.Getenv("SMTP_EMAIL")
	password := os.Getenv("SMTP_PASSWORD")
	if from == "" || password == "" {
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

	// Same fix as the SOS email: a raw lat/lng pair isn't actionable in an
	// emergency, a tappable map pin is. This is the alert that actually goes
	// out to trusted contacts when someone is overdue, so it matters at
	// least as much as the SOS email that a location link is here.
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
		log.Printf("sweeper: no contact emails configured for checkpoint %s", checkpointID)
	}
	return rows.Err()
}

package sweeper

import (
	"context"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/telemetry"
	"github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/ws"
	"go.opentelemetry.io/otel/codes"
)

const (
	// secondaryGracePeriod is the fixed extra wait after the "Are you OK?"
	// check-in prompt before contacts actually get alerted - not
	// user-configurable, unlike the grace period below.
	secondaryGracePeriod = 3 * time.Minute
	tickInterval         = 15 * time.Second
	sweeperLockKey = 727_100
)

func Run(ctx context.Context, pool *pgxpool.Pool) {
	ticker := time.NewTicker(tickInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			runIfLeader(ctx, pool)
		}
	}
}

func runIfLeader(ctx context.Context, pool *pgxpool.Pool) {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		log.Printf("sweeper: failed to acquire connection: %v", err)
		return
	}
	defer conn.Release()

	var acquired bool
	err = conn.QueryRow(ctx,
		`SELECT pg_try_advisory_lock($1)`,
		sweeperLockKey,
	).Scan(&acquired)

	if err != nil {
		log.Printf("sweeper: failed to acquire advisory lock: %v", err)
		return
	}

	if !acquired {
		return
	}

	defer func() {
		var unlocked bool
		if err := conn.QueryRow(ctx,
			`SELECT pg_advisory_unlock($1)`,
			sweeperLockKey,
		).Scan(&unlocked); err != nil {
			log.Printf("sweeper: failed to release advisory lock: %v", err)
		}
	}()

	sweepOnce(ctx, pool)
}
func sweepOnce(ctx context.Context, pool *pgxpool.Pool) {

	ctx, span := telemetry.Tracer().Start(ctx, "sweeper.tick")
	defer span.End()

	traceContext, err := telemetry.InjectJSON(ctx)
	if err != nil {
		log.Printf("sweeper: failed to serialize trace context: %v", err)
	}

	rows, err := pool.Query(ctx, `
		WITH newly_overdue AS (
			UPDATE checkpoints
			SET status = 'overdue'
			WHERE status = 'pending'
			  AND expected_time IS NOT NULL
			  AND expected_time <= now()
			RETURNING id, session_id
		)
		INSERT INTO outbox_events (event_type, payload, trace_context)
		SELECT 'overdue_email', jsonb_build_object('checkpoint_id', id, 'session_id', session_id), $1::jsonb
		FROM newly_overdue
		RETURNING payload ->> 'checkpoint_id', payload ->> 'session_id'
	`, traceContext)
	if err != nil {
		log.Printf("sweeper stage1 error: %v", err)
		span.RecordError(err)
		span.SetStatus(codes.Error, "stage1: "+err.Error())
	} else {
		for rows.Next() {
			var id, sessionID string
			if scanErr := rows.Scan(&id, &sessionID); scanErr != nil {
				log.Printf("sweeper stage1 scan error: %v", scanErr)
				continue
			}
			log.Printf("sweeper: checkpoint %s is now OVERDUE, queued for email delivery", id)
			ws.GlobalHub.BroadcastDurable(ctx, sessionID, "checkpoint_overdue", map[string]string{
				"type":          "checkpoint_overdue",
				"checkpoint_id": id,
			})
		}
		rows.Close()
	}

	// Stage 2 used to always wait a hardcoded 5 minutes here regardless of
	// what the session's own grace period was set to - the "Are you OK?"
	// prompt is supposed to appear once you're that many minutes late (the
	// wizard tells the user exactly this: "If you're X minutes late...
	// we'll check on you"), but the setting was never actually read. It
	// happened to look right for anyone who left the default (5 min)
	// alone, and silently did nothing for anyone who changed it. Joining to
	// sessions and using its real grace_period fixes that.
	rows, err = pool.Query(ctx,
		`UPDATE checkpoints
		 SET status = 'pinged'
		 FROM sessions
		 WHERE checkpoints.session_id = sessions.id
		   AND checkpoints.status = 'overdue'
		   AND checkpoints.expected_time <= now() - (sessions.grace_period * interval '1 minute')
		 RETURNING checkpoints.id, checkpoints.session_id`)
	if err != nil {
		log.Printf("sweeper stage2 error: %v", err)
		span.RecordError(err)
		span.SetStatus(codes.Error, "stage2: "+err.Error())
	} else {
		for rows.Next() {
			var id, sessionID string
			if scanErr := rows.Scan(&id, &sessionID); scanErr != nil {
				log.Printf("sweeper stage2 scan error: %v", scanErr)
				continue
			}
			log.Printf("sweeper: checkpoint %s PINGED - would send push notification here", id)
			ws.GlobalHub.BroadcastDurable(ctx, sessionID, "checkpoint_pinged", map[string]string{
				"type":          "checkpoint_pinged",
				"checkpoint_id": id,
			})
		}
		rows.Close()
	}

	rows, err = pool.Query(ctx, `
		WITH newly_escalated AS (
			UPDATE checkpoints
			SET status = 'contacts_alerted'
			FROM sessions
			WHERE checkpoints.session_id = sessions.id
			  AND checkpoints.status = 'pinged'
			  AND checkpoints.expected_time <= now() - (sessions.grace_period * interval '1 minute') - $1::interval
			RETURNING checkpoints.id, checkpoints.session_id
		)
		INSERT INTO outbox_events (event_type, payload, trace_context)
		SELECT 'contact_alert_email', jsonb_build_object('checkpoint_id', id, 'session_id', session_id), $2::jsonb
		FROM newly_escalated
		RETURNING payload ->> 'checkpoint_id', payload ->> 'session_id'
	`, secondaryGracePeriod, traceContext)
	if err != nil {
		log.Printf("sweeper stage3 error: %v", err)
		span.RecordError(err)
		span.SetStatus(codes.Error, "stage3: "+err.Error())
	} else {
		for rows.Next() {
			var id, sessionID string
			if scanErr := rows.Scan(&id, &sessionID); scanErr != nil {
				log.Printf("sweeper stage3 scan error: %v", scanErr)
				continue
			}
			log.Printf("sweeper: checkpoint %s ESCALATED, queued for contact-alert email delivery", id)
			ws.GlobalHub.BroadcastDurable(ctx, sessionID, "contacts_alerted", map[string]string{
				"type":          "contacts_alerted",
				"checkpoint_id": id,
			})
		}
		rows.Close()
	}
}

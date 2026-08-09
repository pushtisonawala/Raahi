package db

import (
	"context"
	"log"

	"github.com/jackc/pgx/v5/pgxpool"
)

var Pool *pgxpool.Pool

func Connect(databaseURL string) {
	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		log.Fatalf("unable to connect to db: %v", err)

	}
	if err := pool.Ping(context.Background()); err != nil {
		log.Fatalf("database ping failed: %v", err)
	}
	Pool = pool
	log.Println("database connected successfully")
}

func Migrate() {
	const schema = `
		CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
			email TEXT NOT NULL UNIQUE,
			password_hash TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

		CREATE TABLE IF NOT EXISTS contacts (
			id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			name TEXT NOT NULL,
			phone TEXT NOT NULL,
			email TEXT NOT NULL DEFAULT '',
			relationship TEXT NOT NULL DEFAULT '',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

		ALTER TABLE contacts
			ADD COLUMN IF NOT EXISTS user_id TEXT,
			ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '',
			ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '',
			ADD COLUMN IF NOT EXISTS relationship TEXT NOT NULL DEFAULT '',
			ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

		ALTER TABLE contacts
			ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '';

		UPDATE contacts SET email = '' WHERE email IS NULL;
		UPDATE contacts SET relationship = '' WHERE relationship IS NULL;

		ALTER TABLE contacts
			ALTER COLUMN email SET DEFAULT '',
			ALTER COLUMN email SET NOT NULL,
			ALTER COLUMN relationship SET DEFAULT '',
			ALTER COLUMN relationship SET NOT NULL;

		CREATE INDEX IF NOT EXISTS contacts_user_id_created_at_idx
			ON contacts (user_id, created_at DESC);

		-- The CREATE TABLE above only sets ON DELETE CASCADE for brand-new
		-- databases. Any database created before that clause was added still
		-- has the old constraint with no cascade, so deleting a user fails
		-- with a foreign key violation instead of cleaning up their contacts.
		-- Drop and recreate the constraint on every boot so existing
		-- databases actually get the cascade behavior the schema promises.
		ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_user_id_fkey;
		ALTER TABLE contacts ADD CONSTRAINT contacts_user_id_fkey
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

		CREATE TABLE IF NOT EXISTS sessions (
			id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			name TEXT NOT NULL DEFAULT 'Safety session',
			route TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT 'active',
			grace_period INTEGER NOT NULL DEFAULT 5,
			started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			completed_at TIMESTAMPTZ,
			last_lat DOUBLE PRECISION,
			last_lng DOUBLE PRECISION,
			last_location_at TIMESTAMPTZ
		);

		ALTER TABLE sessions
			ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT 'Safety session',
			ADD COLUMN IF NOT EXISTS route TEXT NOT NULL DEFAULT '',
			ADD COLUMN IF NOT EXISTS grace_period INTEGER NOT NULL DEFAULT 5,
			ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
			ADD COLUMN IF NOT EXISTS last_lat DOUBLE PRECISION,
			ADD COLUMN IF NOT EXISTS last_lng DOUBLE PRECISION,
			ADD COLUMN IF NOT EXISTS last_location_at TIMESTAMPTZ;

		-- route_geometry stores the full walking-route polyline (an ordered
		-- JSON array of {lat,lng} points) returned by the routing engine when
		-- the session was created. progress_meters/route_total_meters let us
		-- measure "how far along the intended route" someone is by projecting
		-- their live location onto this line, instead of requiring them to
		-- physically enter a small radius around a handful of fixed pins -
		-- which only ever worked if they walked the one exact path the
		-- routing engine picked. route_deviation flags when the person's
		-- current location is meaningfully off that line.
		ALTER TABLE sessions
			ADD COLUMN IF NOT EXISTS route_geometry JSONB,
			ADD COLUMN IF NOT EXISTS route_total_meters DOUBLE PRECISION,
			ADD COLUMN IF NOT EXISTS progress_meters DOUBLE PRECISION NOT NULL DEFAULT 0,
			ADD COLUMN IF NOT EXISTS route_deviation BOOLEAN NOT NULL DEFAULT FALSE;

		-- Which routing profile (walking/driving) this session's route was
		-- computed with. Needed so that an auto-reroute (see
		-- POST /sessions/:id/reroute) can ask the same routing API for the
		-- same mode again, instead of guessing - a walking session that
		-- strays off path should get a new walking route, not a driving one.
		ALTER TABLE sessions
			ADD COLUMN IF NOT EXISTS travel_mode TEXT NOT NULL DEFAULT 'walking';

		CREATE INDEX IF NOT EXISTS sessions_user_id_started_at_idx
			ON sessions (user_id, started_at DESC);

		-- Same retrofit as contacts above.
		ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_user_id_fkey;
		ALTER TABLE sessions ADD CONSTRAINT sessions_user_id_fkey
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

		CREATE TABLE IF NOT EXISTS checkpoints (
			id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
			session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
			name TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'pending',
			expected_time TIMESTAMPTZ,
			lat DOUBLE PRECISION,
			lng DOUBLE PRECISION,
			radius_meters INTEGER NOT NULL DEFAULT 75,
			order_index INTEGER NOT NULL DEFAULT 0
		);

		-- distance_meters is this checkpoint's position along the session's
		-- route_geometry (arc length from the route's start). When a session
		-- has a route_geometry, checkpoints are marked "reached" once the
		-- walker's progress_meters passes this value, rather than requiring
		-- them to physically enter radius_meters of the checkpoint's exact
		-- lat/lng. NULL for sessions/checkpoints created before this existed,
		-- or for manually-added checkpoints with no associated route - those
		-- keep falling back to the original radius check.
		ALTER TABLE checkpoints
			ADD COLUMN IF NOT EXISTS distance_meters DOUBLE PRECISION;

		CREATE INDEX IF NOT EXISTS checkpoints_session_id_order_idx
			ON checkpoints (session_id, order_index);

		CREATE INDEX IF NOT EXISTS checkpoints_status_expected_time_idx
			ON checkpoints (status, expected_time);

		CREATE TABLE IF NOT EXISTS share_links (
			id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
			session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
			token TEXT NOT NULL UNIQUE,
			expires_at TIMESTAMPTZ NOT NULL,
			revoked BOOLEAN NOT NULL DEFAULT FALSE,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

		CREATE INDEX IF NOT EXISTS share_links_session_id_idx
			ON share_links (session_id);

		CREATE INDEX IF NOT EXISTS share_links_token_idx
			ON share_links (token);

		-- Transactional outbox: sweeper.go inserts a row here in the SAME
		-- statement that flips a checkpoint's status (see the CTE pattern in
		-- sweepOnce), so "the state changed" and "a side effect is now
		-- guaranteed to eventually be delivered" become one atomic fact
		-- instead of two separate steps where the second one could silently
		-- fail and never be retried. internal/outbox is the only thing that
		-- reads from this table.
		CREATE TABLE IF NOT EXISTS outbox_events (
			id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
			event_type TEXT NOT NULL,
			payload JSONB NOT NULL,
			status TEXT NOT NULL DEFAULT 'pending',
			attempts INTEGER NOT NULL DEFAULT 0,
			last_error TEXT,
			next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

		-- Partial index: only rows the dispatcher will ever actually query
		-- for ('pending' and due) are indexed, instead of indexing every row
		-- including ones already 'delivered' or 'failed' that pile up over
		-- time and are never looked up by status again.
		CREATE INDEX IF NOT EXISTS outbox_events_pending_idx
			ON outbox_events (next_attempt_at)
			WHERE status = 'pending';

		-- Durable, ordered log of the "must not silently miss this" events
		-- for a session (checkpoint state changes, SOS, reroutes - NOT
		-- routine progress/location pings, which are superseded by the next
		-- one and never need replaying). id is a plain ever-increasing
		-- sequence number: a reconnecting WebSocket client sends back the
		-- highest id it already saw (?since=) and gets everything after
		-- that replayed before switching to live delivery, instead of
		-- whatever happened while it was disconnected just being gone.
		CREATE TABLE IF NOT EXISTS session_events (
			id BIGSERIAL PRIMARY KEY,
			session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
			event_type TEXT NOT NULL,
			payload JSONB NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

		CREATE INDEX IF NOT EXISTS session_events_session_id_id_idx
			ON session_events (session_id, id);
	`

	if _, err := Pool.Exec(context.Background(), schema); err != nil {
		log.Fatalf("database migration failed: %v", err)
	}
	log.Println("database schema is ready")
}

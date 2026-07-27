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

		CREATE INDEX IF NOT EXISTS sessions_user_id_started_at_idx
			ON sessions (user_id, started_at DESC);

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
	`

	if _, err := Pool.Exec(context.Background(), schema); err != nil {
		log.Fatalf("database migration failed: %v", err)
	}
	log.Println("database schema is ready")
}

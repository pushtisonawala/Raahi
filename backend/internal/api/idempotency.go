package api

import (
	"bytes"
	"log"
	"net/http"

	"github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/db"
)

const idempotencyHeader = "Idempotency-Key"

// responseRecorder sits between a handler and the real ResponseWriter,
// forwarding every write through immediately (the client isn't delayed at
// all) while also buffering a copy, so Idempotency can persist exactly what
// was sent for replay on a future retry.
type responseRecorder struct {
	http.ResponseWriter
	statusCode int
	body       bytes.Buffer
}

func (rr *responseRecorder) WriteHeader(statusCode int) {
	rr.statusCode = statusCode
	rr.ResponseWriter.WriteHeader(statusCode)
}

func (rr *responseRecorder) Write(b []byte) (int, error) {
	rr.body.Write(b)
	return rr.ResponseWriter.Write(b)
}

// Idempotency makes a handler safe to retry. A client that sends the same
// Idempotency-Key header twice gets the same recorded response back the
// second time instead of the handler's side effects (creating a session,
// triggering SOS, emailing every contact) happening again. Opt-in: a
// request with no header behaves exactly as it did before this existed.
//
// Must run after RequireAuth in the middleware chain - it reads userID from
// context to scope keys per user, so a key is meaningless (and safely
// ignored) without one.
func Idempotency(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := r.Header.Get(idempotencyHeader)
		if key == "" {
			next.ServeHTTP(w, r)
			return
		}

		userID, _ := r.Context().Value(userIDKey).(string)
		if userID == "" {
			next.ServeHTTP(w, r)
			return
		}

		// Try to claim the key. ON CONFLICT DO NOTHING makes this safe
		// against two identical requests racing each other: Postgres's own
		// unique constraint on (user_id, key) is what actually prevents
		// both from believing they're first, not anything in this Go code.
		tag, err := db.Pool.Exec(r.Context(),
			`INSERT INTO idempotency_keys (user_id, key, status)
			 VALUES ($1, $2, 'processing')
			 ON CONFLICT (user_id, key) DO NOTHING`,
			userID, key,
		)
		if err != nil {
			log.Printf("idempotency: failed to claim key: %v", err)
			next.ServeHTTP(w, r)
			return
		}

		if tag.RowsAffected() == 0 {
			// Someone already claimed this key - either the original
			// request finished (replay its response) or it's still
			// running (tell the caller to back off rather than doing the
			// risky operation a second time in parallel).
			var status string
			var responseStatus *int
			var responseBody []byte
			err := db.Pool.QueryRow(r.Context(),
				`SELECT status, response_status, response_body
				 FROM idempotency_keys WHERE user_id = $1 AND key = $2`,
				userID, key,
			).Scan(&status, &responseStatus, &responseBody)
			if err != nil {
				log.Printf("idempotency: failed to look up existing key: %v", err)
				http.Error(w, "request already in progress", http.StatusConflict)
				return
			}

			if status == "completed" && responseStatus != nil {
				w.Header().Set("Idempotency-Replayed", "true")
				w.WriteHeader(*responseStatus)
				w.Write(responseBody)
				return
			}

			http.Error(w, "a request with this idempotency key is already in progress", http.StatusConflict)
			return
		}

		recorder := &responseRecorder{ResponseWriter: w, statusCode: http.StatusOK}
		next.ServeHTTP(recorder, r)

		if recorder.statusCode >= 500 {
			// A 5xx is presumed transient (DB blip, timeout) rather than a
			// verdict on the request itself - caching it would mean a
			// retry replays the same failure forever instead of ever
			// getting a real second attempt. Release the claim instead, so
			// the next request with this key is treated as brand new.
			if _, err := db.Pool.Exec(r.Context(),
				`DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2`,
				userID, key,
			); err != nil {
				log.Printf("idempotency: failed to release key after server error: %v", err)
			}
			return
		}

		if _, err := db.Pool.Exec(r.Context(),
			`UPDATE idempotency_keys
			 SET status = 'completed', response_status = $1, response_body = $2
			 WHERE user_id = $3 AND key = $4`,
			recorder.statusCode, recorder.body.Bytes(), userID, key,
		); err != nil {
			log.Printf("idempotency: failed to store response for replay: %v", err)
		}
	})
}

package api

import (
	"context"
	"log"
	"net"
	"net/http"
	"os"
	"strings"

	"github.com/golang-jwt/jwt/v5"
	"github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/ratelimit"
)

type contextKey string

const userIDKey contextKey = "user_id"

func RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {

		authHeader := r.Header.Get("Authorization")

		if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
			http.Error(w, "missing or invalid authorization header", http.StatusUnauthorized)
			return
		}

		tokenString := strings.TrimPrefix(authHeader, "Bearer ")
		secret := os.Getenv("JWT_SECRET")
		if secret == "" {
			http.Error(w, "server misconfiguration", http.StatusInternalServerError)
			return
		}

		token, err := jwt.Parse(tokenString, func(t *jwt.Token) (interface{}, error) {
			return []byte(secret), nil
		}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}))

		if err != nil || !token.Valid {
			http.Error(w, "invalid or expired token", http.StatusUnauthorized)
			return
		}
		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			http.Error(w, "invalid token claims", http.StatusUnauthorized)
			return

		}
		userID, ok := claims["user_id"].(string)
		if !ok {
			http.Error(w, "invalid token claims", http.StatusUnauthorized)
			return
		}

		ctx := context.WithValue(r.Context(), userIDKey, userID)
		next.ServeHTTP(w, r.WithContext(ctx))

	})
}

// RateLimit returns middleware that checks the given Limiter before letting
// a request through, keyed by "<name>:<caller's IP>". name distinguishes
// routes sharing one Redis instance (e.g. "login" vs "signup") so their
// buckets don't collide with each other under the same IP.
//
// It's a factory (returns a func(http.Handler) http.Handler), not
// middleware itself, because different routes need different Limiters -
// login and signup shouldn't share one bucket, or a burst of signups would
// eat into an unrelated user's login attempts.
func RateLimit(limiter *ratelimit.Limiter, name string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			key := "ratelimit:" + name + ":" + clientIP(r)

			allowed, err := limiter.Allow(r.Context(), key)
			if err != nil {
				// Fail open: if Redis itself is unreachable, letting login
				// requests through beats taking the whole app down over a
				// dependency that's just there to slow down abuse, not to
				// gate core functionality. Logged loudly because "silently
				// allowing everything" is exactly the kind of failure mode
				// that should be visible, not just tolerated.
				log.Printf("ratelimit: %s check failed, allowing request through: %v", name, err)
				next.ServeHTTP(w, r)
				return
			}

			if !allowed {
				w.Header().Set("Retry-After", "60")
				http.Error(w, "too many requests, please try again later", http.StatusTooManyRequests)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// clientIP extracts the caller's address, preferring X-Forwarded-For since
// Render (and any reverse proxy) puts the real client IP there - r.RemoteAddr
// on a proxied request is just the proxy's own address, which would put
// every single caller behind the same bucket.
func clientIP(r *http.Request) string {
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		// X-Forwarded-For can be a comma-separated chain if the request
		// passed through multiple proxies; the first entry is the
		// original client.
		if idx := strings.Index(fwd, ","); idx != -1 {
			return strings.TrimSpace(fwd[:idx])
		}
		return strings.TrimSpace(fwd)
	}

	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

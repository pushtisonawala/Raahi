package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/joho/godotenv"
	"github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/api"
	"github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/db"
	"github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/ratelimit"
	"github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/sweeper"
	"github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/ws"
	"github.com/redis/go-redis/v9"
)

func main() {
	_ = godotenv.Load()

	// backend/.env is gitignored (it holds secrets), so it never makes it
	// into a deployed environment like Render - those platforms only read
	// environment variables set in their own dashboard. Without this check,
	// a missing SMTP config fails completely silently: sweeper.go's email
	// functions just no-op, and SOS emails fail deep inside notify.SendEmail
	// with only a per-request log line easy to miss. This one is impossible
	// to miss in the boot log.
	if os.Getenv("SMTP_EMAIL") == "" || os.Getenv("SMTP_PASSWORD") == "" {
		log.Println("WARNING: SMTP_EMAIL and/or SMTP_PASSWORD are not set - SOS alerts and check-in emails will NOT be sent. Set them in your hosting provider's environment variables (not just a local .env file).")
	}

	r := chi.NewRouter()
	r.Use(api.CORS)
	r.Get("/health", func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	})

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		databaseURL = "postgres://raahi:raahi_dev@localhost:5433/raahi?sslmode=disable"
	}
	db.Connect(databaseURL)
	go sweeper.Run(context.Background(), db.Pool)

	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		redisURL = "redis://localhost:6379"
	}
	redisOptions, err := redis.ParseURL(redisURL)
	if err != nil {
		log.Fatalf("invalid REDIS_URL: %v", err)
	}
	redisClient := redis.NewClient(redisOptions)
	ws.GlobalHub.SetRedis(redisClient)
	go ws.GlobalHub.Run(context.Background())

	// Separate Limiters (separate Redis key namespaces via the "name" tag
	// in RateLimit) so a burst of signups can't eat into login's budget or
	// vice versa. Login is the tighter of the two: it's the one an
	// attacker actually gains something from brute-forcing.
	loginLimiter := ratelimit.New(redisClient, 5, 5*time.Minute)
	signupLimiter := ratelimit.New(redisClient, 3, time.Hour)

	defer db.Pool.Close()
	db.Migrate()

	r.With(api.RateLimit(signupLimiter, "signup")).Post("/signup", api.SignupHandler)
	r.With(api.RateLimit(loginLimiter, "login")).Post("/login", api.LoginHandler)
	r.Get("/sessions/{id}/ws", api.SessionWebSocketHandler)
	r.With(api.RequireAuth).Post("/sessions/{id}/share", api.CreateShareLinkHandler)
	r.Get("/share/{token}", api.GetSharedSessionHandler)
	r.Get("/share/{token}/ws", api.SharedSessionWebSocketHandler)
	r.With(api.RequireAuth).Post("/contacts", api.CreateContactHandler)
	r.With(api.RequireAuth).Get("/contacts", api.ListContactHandler)
	r.With(api.RequireAuth).Put("/contacts/{id}", api.UpdateContact)
	r.With(api.RequireAuth).Delete("/contacts/{id}", api.DeleteContactHandler)
	r.With(api.RequireAuth).Post("/sessions", api.CreateSessionHandler)
	r.With(api.RequireAuth).Get("/sessions", api.ListSessionsHandler)
	r.With(api.RequireAuth).Get("/sessions/{id}", api.GetSessionHandler)
	r.With(api.RequireAuth).Post("/sessions/{id}/complete", api.CompleteSessionHandler)
	r.With(api.RequireAuth).Post("/sessions/{id}/location", api.UpdateLocationHandler)
	r.With(api.RequireAuth).Post("/sessions/{id}/reroute", api.RerouteSessionHandler)
	r.With(api.RequireAuth).Post("/sessions/{id}/sos", api.TriggerSOSHandler)
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	log.Printf("listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

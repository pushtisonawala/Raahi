package main

import (
	"context"
	"log"
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"
	"github.com/joho/godotenv"
	"github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/api"
	"github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/db"
	"github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/sweeper"
)

func main() {
	_ = godotenv.Load()

	r := chi.NewRouter()
	r.Use(api.CORS)
	r.Get("/health", func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	})

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		databaseURL = "postgres://raahi:raahi_dev@localhost:5432/raahi?sslmode=disable"
	}
	db.Connect(databaseURL)
	go sweeper.Run(context.Background(), db.Pool)

	defer db.Pool.Close()
	db.Migrate()

	r.Post("/signup", api.SignupHandler)
	r.Post("/login", api.LoginHandler)
	r.Get("/sessions/{id}/ws", api.SessionWebSocketHandler)
	r.With(api.RequireAuth).Post("/contacts", api.CreateContactHandler)
	r.With(api.RequireAuth).Get("/contacts", api.ListContactHandler)
	r.With(api.RequireAuth).Put("/contacts/{id}", api.UpdateContact)
	r.With(api.RequireAuth).Delete("/contacts/{id}", api.DeleteContactHandler)
	r.With(api.RequireAuth).Post("/sessions", api.CreateSessionHandler)
	r.With(api.RequireAuth).Get("/sessions", api.ListSessionsHandler)
	r.With(api.RequireAuth).Get("/sessions/{id}", api.GetSessionHandler)
	r.With(api.RequireAuth).Post("/sessions/{id}/location", api.UpdateLocationHandler)
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	log.Printf("listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

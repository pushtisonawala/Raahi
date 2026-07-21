package main

import (
	"log"
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"
	"github.com/joho/godotenv"
	api "github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/api"
	db "github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/db"
)

func main() {
	r := chi.NewRouter()
	r.Get("/health", func(w http.ResponseWriter, req *http.Request) {
		w.Write([]byte(`{"status":"ok"}`))
	})

	_ = godotenv.Load()

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		databaseURL = "postgres://raahi:raahi_dev@localhost:5432/raahi?sslmode=disable"
	}
	db.Connect(databaseURL)

	r.Post("/signup", api.SignupHandler)
	r.Post("/login", api.LoginHandler)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	log.Printf("listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

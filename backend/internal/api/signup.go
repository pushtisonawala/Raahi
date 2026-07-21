package api

import (
	"encoding/json"
	"net/http"

	"github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/db"
	"golang.org/x/crypto/bcrypt"
)

type signupRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func SignupHandler(w http.ResponseWriter, r *http.Request) {
	var req signupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if req.Email == "" || req.Password == "" {
		http.Error(w, "email and password are required", http.StatusBadRequest)
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		http.Error(w, "failed to process password", http.StatusInternalServerError)
		return
	}

	var newID string
	err = db.Pool.QueryRow(r.Context(),
		`INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id`,
		req.Email, string(hash),
	).Scan(&newID)

	if err != nil {
		http.Error(w, "email already in use or invalid", http.StatusConflict)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"id": newID, "email": req.Email})
}

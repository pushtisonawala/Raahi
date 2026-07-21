package api

import (
	"encoding/json"
	"net/http"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/db"
	"golang.org/x/crypto/bcrypt"
)

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func LoginHandler(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	var userID, storedHash string
	err := db.Pool.QueryRow(r.Context(),
		`SELECT id, password_hash FROM users WHERE email = $1`,
		req.Email,
	).Scan(&userID, &storedHash)

	if err != nil {
		http.Error(w, "invalid email or password", http.StatusUnauthorized)
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(storedHash), []byte(req.Password)); err != nil {
		http.Error(w, "invalid email or password", http.StatusUnauthorized)
		return
	}

	claims := jwt.MapClaims{
		"user_id": userID,
		"exp":     time.Now().Add(24 * time.Hour).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		http.Error(w, "server misconfiguration", http.StatusInternalServerError)
		return
	}
	signedToken, err := token.SignedString([]byte(secret))
	if err != nil {
		http.Error(w, "failed to create token", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"token": signedToken})
}

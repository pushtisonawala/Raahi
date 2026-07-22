package api

import (
	"encoding/json"
	"net/http"

	"github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/db"
)

type createContactRequest struct {
	Name         string `json:"name"`
	Phone        string `json:"phone"`
	Relationship string `json:"relationship"`
}

func CreateContactHandler(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(userIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	var req createContactRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if req.Name == "" || req.Phone == "" {
		http.Error(w, "name and phone are required", http.StatusBadRequest)
		return
	}

	var newID string
	err := db.Pool.QueryRow(r.Context(),
		`INSERT INTO contacts (user_id, name, phone, relationship) VALUES ($1, $2, $3, $4) RETURNING id`,
		userID, req.Name, req.Phone, req.Relationship,
	).Scan(&newID)
	if err != nil {
		http.Error(w, "failed to create contact", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"id": newID})
}

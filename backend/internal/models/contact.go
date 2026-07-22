package models

import "time"

type Contact struct {
	ID           string    `json:"id"`
	UserID       string    `json:"user_id"`
	Name         string    `json:"name"`
	Phone        string    `json:"phone"`
	Relationship string    `json:"relationship"`
	CreatedAt    time.Time `json:"created_at"`
}
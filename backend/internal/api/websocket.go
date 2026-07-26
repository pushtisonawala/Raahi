package api

import (
	"log"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
	"github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/ws"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true }, 
}

func SessionWebSocketHandler(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "id")

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("ws upgrade failed: %v", err)
		return
	}

	ws.GlobalHub.Register(sessionID, conn)
	log.Printf("ws: client connected to session %s", sessionID)

	defer ws.GlobalHub.Unregister(sessionID, conn)

	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			log.Printf("ws: client disconnected from session %s", sessionID)
			break
		}
	}
}
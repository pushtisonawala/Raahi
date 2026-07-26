package ws

import (
	"log"
	"sync"

	"github.com/gorilla/websocket"
)

type Hub struct {
	mu      sync.Mutex
	clients map[string]map[*websocket.Conn]bool
}

var GlobalHub = &Hub{
	clients: make(map[string]map[*websocket.Conn]bool),
}

func (h *Hub) Register(sessionId string, conn *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.clients[sessionId] == nil {
		h.clients[sessionId] = make(map[*websocket.Conn]bool)
	}
	h.clients[sessionId][conn] = true
}

func (h *Hub) Unregister(sessionId string, conn *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if conns, ok := h.clients[sessionId]; ok {
		delete(conns, conn)
		conn.Close()
	}
}

func (h *Hub) Broadcast(sessionId string, message interface{}) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for conn := range h.clients[sessionId] {
		if err := conn.WriteJSON(message); err != nil {
			log.Printf("ws: failed to send to a client of session %s: %v", sessionId, err)
			conn.Close()
			delete(h.clients[sessionId], conn)
		}
	}
}

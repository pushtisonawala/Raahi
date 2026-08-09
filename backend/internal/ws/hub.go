package ws

import (
	"context"
	"encoding/json"
	"log"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/db"
	"github.com/redis/go-redis/v9"
)

const wsBackplaneChannel = "raahi:ws-broadcast"

type broadcastEnvelope struct {
	SessionID string          `json:"session_id"`
	Payload   json.RawMessage `json:"payload"`
}

type Hub struct {
	mu      sync.Mutex
	clients map[string]map[*websocket.Conn]bool

	redis *redis.Client
}

var GlobalHub = &Hub{
	clients: make(map[string]map[*websocket.Conn]bool),
}

func (h *Hub) SetRedis(client *redis.Client) {
	h.redis = client
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

func (h *Hub) deliverLocal(sessionId string, payload json.RawMessage) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for conn := range h.clients[sessionId] {
		if err := conn.WriteMessage(websocket.TextMessage, payload); err != nil {
			log.Printf("ws: failed to send to a client of session %s: %v", sessionId, err)
			conn.Close()
			delete(h.clients[sessionId], conn)
		}
	}
}

func (h *Hub) Broadcast(sessionId string, message interface{}) {
	payload, err := json.Marshal(message)
	if err != nil {
		log.Printf("failed to marshal message: %v", err)
		return
	}
	envelope := broadcastEnvelope{
		SessionID: sessionId,
		Payload:   payload,
	}
	envelopeBytes, err := json.Marshal(envelope)
	if err != nil {
		log.Printf("failed to marshal envelope: %v", err)
		return
	}
	ctx := context.Background()
	if h.redis == nil {
		log.Printf("ws: Redis client is not configured")
		return
	}
	if err := h.redis.Publish(ctx, wsBackplaneChannel, envelopeBytes).Err(); err != nil {
		log.Printf("ws: failed to publish message: %v", err)
	}
}
func (h *Hub) BroadcastDurable(ctx context.Context, sessionId string, eventType string, message interface{}) {
	payload, err := json.Marshal(message)
	if err != nil {
		log.Printf("failed to marshal durable message: %v", err)
		return
	}

	if _, err := db.Pool.Exec(ctx,
		`INSERT INTO session_events (session_id, event_type, payload) VALUES ($1, $2, $3)`,
		sessionId, eventType, payload,
	); err != nil {
		log.Printf("ws: failed to persist durable event: %v", err)
	}

	h.Broadcast(sessionId, message)
}

func (h *Hub) Run(ctx context.Context) {
	if h.redis == nil {
		log.Printf("ws: Redis client is not configured")
		return
	}
	pubsub := h.redis.Subscribe(ctx, wsBackplaneChannel)
	defer pubsub.Close()
	ch := pubsub.Channel()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			var envelope broadcastEnvelope

			if err := json.Unmarshal([]byte(msg.Payload), &envelope); err != nil {
				log.Printf("ws: failed to unmarshal broadcast envelope: %v", err)
				continue
			}

			h.deliverLocal(envelope.SessionID, envelope.Payload)

		}
	}
}

package api

import (
	"context"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
	"github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/db"
	"github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/ws"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}
func replayMissedEvents(ctx context.Context, conn *websocket.Conn, sessionID, sinceParam string) {
	since, err := strconv.ParseInt(sinceParam, 10, 64)
	if err != nil {
		since = 0
	}

	rows, err := db.Pool.Query(ctx,
		`SELECT payload FROM session_events WHERE session_id = $1 AND id > $2 ORDER BY id ASC`,
		sessionID, since,
	)
	if err != nil {
		log.Printf("ws: failed to query missed events for session %s: %v", sessionID, err)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var payload []byte
		if scanErr := rows.Scan(&payload); scanErr != nil {
			log.Printf("ws: failed to scan missed event for session %s: %v", sessionID, scanErr)
			continue
		}
		if writeErr := conn.WriteMessage(websocket.TextMessage, payload); writeErr != nil {
			log.Printf("ws: failed to replay event to session %s: %v", sessionID, writeErr)
			return
		}
	}
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

	replayMissedEvents(r.Context(), conn, sessionID, r.URL.Query().Get("since"))

	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			log.Printf("ws: client disconnected from session %s", sessionID)
			break
		}
	}
}

func SharedSessionWebSocketHandler(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")

	var sessionID string
	var revoked bool
	var expiresAt time.Time
	err := db.Pool.QueryRow(r.Context(),
		`SELECT session_id, revoked, expires_at FROM share_links WHERE token = $1`,
		token,
	).Scan(&sessionID, &revoked, &expiresAt)
	if err != nil || revoked || time.Now().After(expiresAt) {
		http.Error(w, "invalid or expired link", http.StatusForbidden)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("ws upgrade failed: %v", err)
		return
	}

	ws.GlobalHub.Register(sessionID, conn)
	log.Printf("ws: shared client connected to session %s", sessionID)
	defer ws.GlobalHub.Unregister(sessionID, conn)

	replayMissedEvents(r.Context(), conn, sessionID, r.URL.Query().Get("since"))

	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			log.Printf("ws: shared client disconnected from session %s", sessionID)
			break
		}
	}
}

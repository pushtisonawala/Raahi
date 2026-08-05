package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/db"
	"github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/geo"
	"github.com/pushtisonawala/raahi-personal-safety-app/backend/internal/ws"
)

// corridorToleranceMeters is how far someone can stray perpendicular to the
// planned route before we consider them "off route." Wide enough to cover
// the opposite side of a street or a parallel block, narrow enough to still
// mean something.
const corridorToleranceMeters = 60.0

type locationRequest struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

func UpdateLocationHandler(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(userIDKey).(string)
	sessionID := chi.URLParam(r, "id")

	var req locationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.Lat < -90 || req.Lat > 90 || req.Lng < -180 || req.Lng > 180 {
		http.Error(w, "invalid coordinates", http.StatusBadRequest)
		return
	}

	var routeGeometryJSON []byte
	var progressMeters float64
	err := db.Pool.QueryRow(r.Context(),
		`SELECT route_geometry, progress_meters FROM sessions WHERE id = $1 AND user_id = $2`,
		sessionID, userID,
	).Scan(&routeGeometryJSON, &progressMeters)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "session not found", http.StatusNotFound)
			return
		}
		http.Error(w, "failed to load session", http.StatusInternalServerError)
		return
	}

	var routeGeometry []geo.Point
	if len(routeGeometryJSON) > 0 {
		if err := json.Unmarshal(routeGeometryJSON, &routeGeometry); err != nil {
			routeGeometry = nil
		}
	}

	if len(routeGeometry) > 1 {
		if err := updateLocationWithRouteProgress(r, sessionID, userID, req, routeGeometry, progressMeters); err != nil {
			http.Error(w, "failed to update location", http.StatusInternalServerError)
			return
		}
	} else {
		if err := updateLocationWithRadiusFallback(r, sessionID, userID, req); err != nil {
			http.Error(w, "failed to update location", http.StatusInternalServerError)
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "location updated"})
}

// updateLocationWithRouteProgress is the new path: it projects the walker's
// live position onto the session's planned route polyline, tracks how far
// along that route they've gotten (arc-length "progress"), and marks any
// checkpoint whose along-route position is behind that progress as reached -
// regardless of whether the walker is currently standing near that specific
// checkpoint's literal pin. This is what makes checkpoints tolerant of
// someone taking a different block/street than the one the routing engine
// originally picked. It's still gated on actually being near the route
// corridor as a whole, though (see corridorToleranceMeters below) - being
// somewhere in the city isn't enough to credit progress toward any
// checkpoint, including Start.
func updateLocationWithRouteProgress(
	r *http.Request,
	sessionID, userID string,
	req locationRequest,
	routeGeometry []geo.Point,
	storedProgress float64,
) error {
	deviation, rawProgress := geo.ProjectOntoPolyline(routeGeometry, req.Lat, req.Lng)
	offRoute := deviation > corridorToleranceMeters

	// ProjectOntoPolyline always returns *some* arc-length position - the
	// nearest point on the route line - no matter how far away the real
	// point is. Left unguarded, that meant literally any location ping
	// (anywhere in the city) would credit "progress" and could instantly
	// mark the Start checkpoint (distance_meters ~0) reached before the
	// walker had gone anywhere near the route. Progress - and therefore
	// which checkpoints count as reached - can only advance while actually
	// within the route corridor; a ping while off-route just updates the
	// live position and the deviation flag, without moving progress at all.
	// Progress never goes backwards either: a noisy GPS ping that projects
	// slightly earlier than where we already know the person reached
	// shouldn't undo that progress.
	newProgress := storedProgress
	if !offRoute && rawProgress > newProgress {
		newProgress = rawProgress
	}

	tag, err := db.Pool.Exec(r.Context(),
		`UPDATE sessions
		 SET last_lat = $1, last_lng = $2, last_location_at = $3,
		     progress_meters = $4, route_deviation = $5
		 WHERE id = $6 AND user_id = $7`,
		req.Lat, req.Lng, time.Now(), newProgress, offRoute, sessionID, userID,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("session not found")
	}

	rows, err := db.Pool.Query(r.Context(),
		`UPDATE checkpoints SET status = 'reached'
		 WHERE session_id = $1 AND status = 'pending'
		   AND distance_meters IS NOT NULL AND distance_meters <= $2
		 RETURNING id`,
		sessionID, newProgress,
	)
	if err != nil {
		return err
	}
	var reachedIDs []string
	for rows.Next() {
		var id string
		if scanErr := rows.Scan(&id); scanErr != nil {
			rows.Close()
			return scanErr
		}
		reachedIDs = append(reachedIDs, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()

	for _, id := range reachedIDs {
		ws.GlobalHub.Broadcast(sessionID, map[string]string{
			"type":          "checkpoint_reached",
			"checkpoint_id": id,
		})
	}

	ws.GlobalHub.Broadcast(sessionID, map[string]interface{}{
		"type":            "progress_update",
		"progress_meters": newProgress,
		"deviation_meters": deviation,
		"route_deviation": offRoute,
	})

	return nil
}

// updateLocationWithRadiusFallback is the original behavior, kept for
// sessions with no route geometry (created before this feature existed, or
// whose checkpoints were added manually with no associated route): the next
// pending checkpoint is reached once the walker comes within its
// radius_meters.
func updateLocationWithRadiusFallback(r *http.Request, sessionID, userID string, req locationRequest) error {
	tag, err := db.Pool.Exec(r.Context(),
		`UPDATE sessions SET last_lat = $1, last_lng = $2, last_location_at = $3 WHERE id = $4 AND user_id = $5`,
		req.Lat, req.Lng, time.Now(), sessionID, userID,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("session not found")
	}

	var checkpointID string
	var cpLat, cpLng *float64
	var radius int
	err = db.Pool.QueryRow(r.Context(),
		`SELECT id, lat, lng, radius_meters FROM checkpoints
		 WHERE session_id = $1 AND status = 'pending'
		 ORDER BY order_index ASC LIMIT 1`,
		sessionID,
	).Scan(&checkpointID, &cpLat, &cpLng, &radius)

	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}

	if err == nil && cpLat != nil && cpLng != nil {
		distance := geo.DistanceMeters(req.Lat, req.Lng, *cpLat, *cpLng)
		if distance <= float64(radius) {
			if _, err := db.Pool.Exec(r.Context(),
				`UPDATE checkpoints SET status = 'reached' WHERE id = $1`,
				checkpointID,
			); err != nil {
				return err
			}
			ws.GlobalHub.Broadcast(sessionID, map[string]string{
				"type":          "checkpoint_reached",
				"checkpoint_id": checkpointID,
			})
		}
	}

	return nil
}

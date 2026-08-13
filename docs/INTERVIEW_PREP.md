# Raahi Backend — Interview Reference

Every backend/infra pattern in this codebase, code-level, with the follow-up
questions an interviewer is likely to ask and how to answer them. Organized
in the order you'd naturally explain them if walking through the SOS flow
end to end, since that's the one path that touches all of them.

How to use this: don't recite it. Read a section, close the file, explain
it out loud to yourself in your own words, then check what you missed.
Memorized answers sound memorized.

---

## 1. Idempotency keys

**The problem.** A client retries a `POST /sessions/{id}/sos` after a
dropped connection (mobile network, timeout, whatever). Without protection,
the retry re-runs the whole handler — session gets marked SOS-triggered
twice (harmless, idempotent update on its own), but a second `outbox_events`
row gets inserted, meaning contacts get emailed twice. For a safety app,
duplicate alerts erode trust in the product fast.

**The code** (`internal/api/idempotency.go`). A client sends an
`Idempotency-Key` header. Middleware tries to claim it:
```go
tag, err := db.Pool.Exec(r.Context(),
    `INSERT INTO idempotency_keys (user_id, key, status)
     VALUES ($1, $2, 'processing')
     ON CONFLICT (user_id, key) DO NOTHING`,
    userID, key,
)
```
`ON CONFLICT DO NOTHING` is doing the real work — Postgres's unique
constraint on `(user_id, key)` is what actually prevents two concurrent
identical requests from both believing they got there first, not anything
in the Go code. If `tag.RowsAffected() == 0`, someone already claimed it:
either it finished (look up and replay the stored response) or it's still
running (`409 Conflict`, "in progress").

If the claim succeeds, the handler runs behind a `responseRecorder` — a
thin wrapper around `http.ResponseWriter` that forwards every write
immediately (client isn't delayed) while also buffering a copy, so the
final response can be persisted for replay:
```go
if recorder.statusCode >= 500 {
    // release the claim — a 5xx is presumed transient, caching it would
    // mean every retry replays the same failure forever
    db.Pool.Exec(r.Context(), `DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2`, ...)
    return
}
// otherwise: cache status + body for replay
```

**Follow-ups:**
- *"Why release on 5xx but not 4xx?"* — A 5xx is presumed transient (DB
  blip, timeout) — caching it would mean a legitimate retry replays a
  server failure forever instead of ever getting a real second attempt. A
  4xx is a verdict on the request itself (bad input, auth failure) —
  replaying it is correct, the client should fix its request rather than
  hammer the same broken one.
- *"What if two identical requests race each other?"* — The Postgres
  unique constraint resolves the race, not the Go code. One `INSERT`
  succeeds, the other gets `RowsAffected() == 0` and either replays or
  gets told to back off. This is the actual point of trusting the
  database's constraint instead of, say, an in-memory lock, which
  wouldn't work across multiple app instances anyway.
- *"Why scope the key to `(user_id, key)` instead of just `key`?"* — So
  one user can never replay — even by accident — a response meant for a
  different user. Two different users could pick the same key string with
  zero coordination.

---

## 2. Transactional outbox

**The problem.** Dual-write problem: updating Postgres and calling an
external system (SMTP) can't be made atomic directly. Call SMTP inline and
either it hangs the request, or it fails silently with no retry.

**The code.** Producer side (`internal/api/sos.go`), one atomic statement:
```go
tag, err := db.Pool.Exec(r.Context(), `
    WITH triggered AS (
        UPDATE sessions SET status = 'sos_triggered'
        WHERE id = $1 AND user_id = $2
        RETURNING id
    )
    INSERT INTO outbox_events (event_type, payload)
    SELECT 'sos_email', jsonb_build_object('session_id', id)
    FROM triggered
`, sessionID, userID)
```
The `INSERT ... SELECT ... FROM triggered` only fires if the `UPDATE`
actually matched a row — one statement, one transaction, so the state
change and the "promise to send an email" either both happen or neither
does.

Consumer side (`internal/outbox/outbox.go`), a ticker every 5 seconds:
```go
rows, err := tx.Query(ctx, `
    SELECT id, event_type, payload, attempts
    FROM outbox_events
    WHERE status = 'pending' AND next_attempt_at <= now()
    ORDER BY next_attempt_at
    LIMIT $1
    FOR UPDATE SKIP LOCKED
`, batchSize)
```
`FOR UPDATE SKIP LOCKED` — locks the claimed rows, and if another dispatcher
instance already has a row locked, this query skips it instead of blocking.
That's what makes running multiple instances of this dispatcher safe: no
double-processing, no blocking on each other.

Failure handling: success → `delivered`. Failure, retries left → exponential
backoff (`2^attempts` seconds, capped at 5 minutes), `next_attempt_at`
pushed forward. Failure, `attempts >= 8` → `failed`, permanently — a dead
letter, sitting in the table with `last_error` for later inspection.

**Follow-ups:**
- *"Why not Kafka/RabbitMQ?"* — Overkill at this scale, and it introduces
  its own dual-write problem unless you add CDC (Debezium) on top. The
  DB-backed outbox gets atomicity for free from the same transaction as
  the state change. I'd reach for a real broker if throughput or fan-out
  needs actually demanded it.
- *"What happens to a permanently-failed row?"* — It sits at `status =
  'failed'` forever, un-retried, with `last_error` populated. In a real
  system this would feed an alert/dashboard — "outbox dead-letter rate" is
  exactly the kind of thing you'd want a Prometheus counter on (see the
  observability roadmap — this is one I flagged as not-yet-built).
- *"Why store the minimal payload (`session_id`) instead of the whole
  email content?"* — Because delivery might happen minutes later; looking
  up fresh data at delivery time (current location, current contact list)
  means the alert is never stale. Baking in a snapshot at enqueue time
  would send outdated information.
- *"What if the dispatcher crashes mid-batch?"* — The whole batch runs
  inside one Postgres transaction (`tx.Begin`/`tx.Commit`) — if the process
  dies before `Commit`, nothing in that batch changed status, and the row
  locks release automatically when the connection drops. Next tick (on
  this or another instance) picks the same rows back up. No work is lost,
  worst case is a delayed retry.

---

## 3. Circuit breaker

**The problem.** If SMTP is down, every call to it waits out its own
timeout (10s) before failing. Under a burst of failures, that's a lot of
goroutines all blocked for 10 seconds each, for a dependency already known
to be broken.

**The code** (`internal/breaker/breaker.go`). Three states — closed
(normal), open (tripped, fails instantly), half-open (cooldown elapsed,
one trial call let through):
```go
func (b *Breaker) Call(fn func() error) error {
    if !b.allow() {
        return ErrOpen
    }
    err := fn()
    b.recordResult(err)
    return err
}
```
Trips open after `failureThreshold` (5) consecutive failures, stays open
for `cooldown` (1 minute), then lets exactly one call through as a trial —
success closes it, failure re-opens it for another cooldown.

Deliberately **in-process, not Redis-shared** (unlike the rate limiter):
each instance tracks the health of the dependency along its own network
path — "can this instance currently reach smtp.gmail.com" is correctly
scoped per-instance, not something that needs cluster-wide consistency.

Wired in `internal/notify/email.go`:
```go
var smtpBreaker = breaker.New(5, 1*time.Minute)

func SendEmail(ctx context.Context, to string, ...) error {
    ...
    err := smtpBreaker.Call(func() error {
        return sendEmailNow(ctx, to, subject, plainBody, htmlBody)
    })
```

**Follow-ups:**
- *"Why in-process instead of shared state like the rate limiter?"* —
  Different question being answered. Rate limiting needs cluster-wide
  consistency (one shared budget across all instances). Breaker state is
  "is *this instance's* network path to SMTP currently healthy" — sharing
  that across instances would be actively wrong if, say, one instance has
  a firewall issue the others don't.
- *"What's the failure mode if the breaker itself has a bug — say it never
  closes again?"* — Every email send fails instantly with `ErrOpen`
  forever, which is a visible, loud failure (every call logs it) — bad,
  but not silent. Compare to no breaker at all, where the failure mode is
  every request hanging for 10s under sustained SMTP outage.
- *"Why 5 failures / 1 minute specifically?"* — Somewhat arbitrary
  tuning — enough consecutive failures to be confident it's not a blip
  (one flaky request), short enough cooldown that recovery is detected
  reasonably fast. In production I'd tune these against real observed
  failure patterns rather than guess, which is exactly the kind of thing
  the "breaker state transition" metric from the observability roadmap
  would let you actually measure.

---

## 4. Rate limiting (Redis token bucket)

**The problem.** Login/signup need brute-force protection, and it has to
work correctly across multiple app instances, not just per-process.

**The code** (`internal/ratelimit/ratelimit.go`). Token bucket implemented
as a Lua script, executed atomically inside Redis:
```go
func (l *Limiter) Allow(ctx context.Context, key string) (bool, error) {
    now := float64(time.Now().UnixNano()) / 1e9
    result, err := l.script.Run(ctx, l.client, []string{key},
        l.capacity, l.refillPerSec, now, 1,
    ).Int()
    return result == 1, nil
}
```
Running the check-and-decrement as a single Lua script matters: without
that atomicity, two concurrent requests could both read "1 token left,"
both decide to proceed, and the bucket goes negative — a classic
check-then-act race condition. Redis executes Lua scripts atomically, so
this can't happen regardless of how many app instances are hitting the
same key concurrently.

Separate limiters for login (5 per 5 min) and signup (3 per hour) —
different Redis key namespaces via the `name` tag, so a burst of signups
can't eat into a different user's login budget:
```go
key := "ratelimit:" + name + ":" + clientIP(r)
```
Fails **open**, not closed, on Redis errors:
```go
if err != nil {
    log.Printf("ratelimit: %s check failed, allowing request through: %v", name, err)
    next.ServeHTTP(w, r)
    return
}
```

**Follow-ups:**
- *"Why fail open instead of closed?"* — A dependency that exists purely
  to slow down abuse (not gate core functionality) shouldn't take down
  login entirely if Redis has a blip. Failing open means an outage in
  Redis degrades security posture temporarily rather than availability —
  a deliberate trade-off, and logged loudly (`log.Printf`) specifically
  because "silently allow everything" is the failure mode most likely to
  go unnoticed if it isn't visible.
- *"Why token bucket over, say, fixed window or sliding log?"* — Token
  bucket allows bursts up to the capacity while still enforcing an average
  rate — a fixed window has the edge-burst problem (2x the limit right at
  a window boundary), sliding log is more accurate but more
  memory/computation per check. Token bucket is the standard middle
  ground.
- *"How does `clientIP` avoid every request looking like it's from the
  same address behind a proxy?"* — Reads `X-Forwarded-For`, takes the
  first entry (original client) if the header's a comma-separated chain
  from multiple proxy hops — otherwise every caller behind Render's
  reverse proxy would collide into one bucket.

---

## 5. Graceful shutdown

**The problem.** On deploy/restart, in-flight requests and background work
(sweeper, outbox dispatcher, WS hub) need to finish cleanly instead of
being killed mid-operation — half-sent emails, dropped WebSocket messages,
truncated DB writes.

**The code** (`cmd/api/main.go`):
```go
quit := make(chan os.Signal, 1)
signal.Notify(quit, os.Interrupt, syscall.SIGTERM)
<-quit

cancel()  // rootCtx cancellation — sweeper/outbox/ws hub all select on rootCtx.Done()

shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 15*time.Second)
if err := srv.Shutdown(shutdownCtx); err != nil { ... }

backgroundLoops.Wait()  // sync.WaitGroup — blocks until sweeper/outbox/ws hub goroutines actually exit

db.Pool.Close()
redisClient.Close()
shutdownTelemetry(context.Background())  // last — flushes any spans from requests that finished during the drain above
```
Order matters here: signal → cancel the root context (background loops see
`ctx.Done()` and stop starting new work) → `srv.Shutdown` drains in-flight
HTTP requests with a 15s deadline → wait for background goroutines to
actually finish their current iteration → close DB/Redis → flush telemetry
last, so spans from anything that happened during the drain aren't lost.

**Follow-ups:**
- *"Why cancel the context before `srv.Shutdown` instead of after?"* — So
  background loops stop picking up *new* work the moment shutdown starts,
  while the HTTP server still has 15 seconds to finish requests already in
  flight. Reversing the order would mean the outbox dispatcher might start
  a new batch right as the process is trying to exit.
- *"What if a background loop doesn't respect `ctx.Done()` and hangs
  forever?"* — `backgroundLoops.Wait()` would block indefinitely — this is
  a real risk if that contract is violated anywhere, worth a timeout
  wrapper in production (`select` with a timeout channel alongside the
  `Wait()`, which this doesn't currently have).
- *"Why 15 seconds for `srv.Shutdown`'s deadline?"* — Long enough for
  slow-but-legitimate in-flight requests to finish, short enough that a
  genuinely hung request doesn't block a deploy indefinitely — a judgment
  call, would tune against observed p99 request latency in production.

---

## 6. WebSocket horizontal scaling via Redis pub/sub

**The problem.** A user's live-tracking WebSocket connection lands on
whichever app instance handled that specific request. When an event needs
to reach them (SOS triggered, location updated), the instance that has
something to broadcast might not be the instance holding their connection.

**The code** (`internal/ws/hub.go`). Each instance keeps its own
in-memory map of session → connections:
```go
type Hub struct {
    mu      sync.Mutex
    clients map[string]map[*websocket.Conn]bool
    redis   *redis.Client
}
```
Broadcasting doesn't write directly to connections — it publishes to
Redis:
```go
func (h *Hub) Broadcast(ctx context.Context, sessionId string, message interface{}) {
    ...
    h.redis.Publish(context.Background(), wsBackplaneChannel, envelopeBytes)
}
```
Every instance subscribes to that same channel and delivers only to
whatever local connections it actually holds:
```go
func (h *Hub) Run(ctx context.Context) {
    pubsub := h.redis.Subscribe(ctx, wsBackplaneChannel)
    for msg := range pubsub.Channel() {
        ...
        h.deliverLocal(envelope.SessionID, envelope.Payload)  // no-op if this instance has no matching connection
    }
}
```
Two broadcast variants: `Broadcast` (fire-and-forget, for high-frequency
things like live location pings) and `BroadcastDurable` (also persists to
a `session_events` table first) — used for anything a reconnecting client
must not silently miss, like `sos_triggered` or `checkpoint_overdue`. A
reconnecting WebSocket client can send `?since=<last_seen_id>` and replay
everything it missed from that table instead of just resuming live
delivery and losing whatever happened while disconnected.

**Follow-ups:**
- *"Why not just have the client reconnect to the specific instance
  holding its connection?"* — That requires sticky sessions at the load
  balancer, which reintroduces state into what's otherwise a stateless
  fleet — one instance going down drops every session pinned to it. The
  pub/sub approach means any instance can serve any client's WebSocket,
  full statelessness preserved.
- *"What happens if Redis goes down?"* — `Broadcast` logs and returns if
  `h.redis == nil` or the publish fails — messages are lost, not queued,
  for the ephemeral `Broadcast` path. For `BroadcastDurable` the DB write
  happens first and independently, so at minimum the event is captured for
  replay even if the live push fails.
- *"Why two broadcast variants instead of always persisting?"* — Cost.
  Live location updates fire continuously while a session's active —
  persisting every one would bloat the table with data nobody needs to
  replay (only the *latest* position matters, not history). Reserved
  durability for events where missing one specifically matters.

---

## 7. Leader election (the sweeper)

**The problem.** The sweeper checks for overdue checkpoints on a 15-second
timer. Running multiple app instances means multiple sweepers — without
coordination, the same overdue checkpoint gets escalated (and emailed)
multiple times, once per instance.

**The code** (`internal/sweeper/sweeper.go`), a Postgres advisory lock:
```go
var acquired bool
conn.QueryRow(ctx, `SELECT pg_try_advisory_lock($1)`, sweeperLockKey).Scan(&acquired)
if !acquired {
    return  // someone else is already running this tick
}
defer conn.QueryRow(ctx, `SELECT pg_advisory_unlock($1)`, sweeperLockKey).Scan(&unlocked)
sweepOnce(ctx, pool)
```
`pg_try_advisory_lock` is non-blocking — if another instance already holds
the lock, this returns `false` immediately instead of waiting, and that
tick just no-ops on this instance. Only one instance across the whole
fleet actually runs the sweep logic on any given tick.

**Follow-ups:**
- *"Why a DB advisory lock instead of, say, a Redis lock (Redlock)?"* —
  Postgres was already a hard dependency and already holds the data being
  swept — no new infrastructure needed, and advisory locks release
  automatically if the holding connection dies (crash-safe without extra
  logic), which a Redis-based lock would need explicit TTL/heartbeat
  handling to replicate.
- *"What if the leader crashes mid-sweep?"* — The advisory lock is tied to
  the database *session* (connection), not a manual token — if the
  connection drops (process crash), Postgres releases the lock
  automatically. The next tick, on any instance, acquires it and proceeds.
  No stale lock, no manual expiry needed.
- *"Isn't this a single point of contention — only one instance doing
  useful work?"* — For this workload, yes, deliberately — the sweep query
  itself is cheap (a few UPDATE/INSERT statements against indexed columns)
  and only one instance needs to run it. This isn't a scaling bottleneck
  unless the sweep logic itself became expensive, at which point you'd
  want to shard by session ID range instead of full leader election.

---

## 8. Distributed tracing (OpenTelemetry)

Already covered in depth in this conversation — the short version for an
interview, with the two propagation boundaries as the centerpiece:

**The problem.** SOS trigger touches three things that don't share a
`context.Context`: the HTTP request itself, an async outbox delivery
seconds later in a different goroutine, and a WebSocket broadcast that
might land on a different instance via Redis pub/sub. Without manual
propagation, these show up as three disconnected traces.

**The mechanism** (`internal/telemetry/telemetry.go`): `Inject(ctx)`
serializes the active span into a `map[string]string` (W3C `traceparent`
format). `Extract(ctx, carrier)` does the reverse — rebuilds a
`context.Context` carrying that span as parent, from data that arrived via
some non-context channel.

**Boundary 1 — outbox**, a new `trace_context JSONB` column:
```go
// producer (sos.go)
traceContext, _ := telemetry.InjectJSON(r.Context())
// ...written into the same atomic INSERT as the state change

// consumer (outbox.go), different goroutine, ticker-triggered
eventCtx := telemetry.ExtractJSON(ctx, e.traceContext)
eventCtx, span := telemetry.Tracer().Start(eventCtx, "outbox.deliver "+e.eventType, ...)
```

**Boundary 2 — Redis pub/sub**, a `trace_context` field on the broadcast
envelope, same `Inject`/`Extract` pair, publishing side vs. subscribing
side (`ws/hub.go`).

**Automatic instrumentation, no manual `Inject`/`Extract` needed** — every
DB query, via a hand-rolled `pgx.QueryTracer` (`db/tracing.go`), and every
HTTP request, via middleware (`api/tracing.go`) that renames the span from
raw path to chi's matched route pattern *after* routing completes (so
`/sessions/abc123/sos` doesn't fragment into one span name per session ID).

**Follow-ups:** see the previous answer in this conversation for the full
list (why not a message queue, what happens if context is missing/corrupt,
overhead, why hand-roll the pgx tracer, the "so what" business-value
answer). The one to add here: *"How does this compose with everything
else in this document?"* — it doesn't replace any of the other patterns,
it makes them observable. The circuit breaker's `ErrOpen` now shows up as
a tagged span attribute instead of just a log line. The outbox's async
delivery now visibly nests under the request that caused it instead of
being an unlinked background event. Tracing is the connective tissue
across every other pattern here, not a separate feature.

---

## The one-sentence version of the whole project, if asked to summarize

"I built a personal safety app's backend around the assumption that
everything fails eventually — SMTP goes down, requests get retried,
instances get killed mid-request, multiple copies of a background job run
at once — and every pattern here (outbox, idempotency, circuit breaker,
advisory-lock leader election, graceful shutdown) is a specific answer to
one of those failure modes, with distributed tracing tying them together so
a failure is diagnosable in one place instead of three."

# Observability

This doc covers two things: how the OpenTelemetry tracing that's now wired into the backend works and how to run/verify it, and a guide for you to implement the remaining three observability pieces (structured logging, Prometheus metrics, SLOs) yourself, using the tracing code as the reference pattern.

## Part 1: distributed tracing (implemented)

### What was built

One trace now follows a single logical operation across every hop it touches, including the two hops that don't share a process or a live `context.Context`:

```
HTTP request (api.Tracing span)
  -> RequireAuth tags the span with user.id
  -> handler runs, e.g. TriggerSOSHandler
       -> pg.query spans for every DB statement (internal/db/tracing.go)
       -> outbox_events row is inserted WITH the current span's
          traceparent serialized into a new trace_context JSONB column
       -> ws.publish span -> Redis pub/sub message carries the same
          traceparent in its JSON envelope
  -> HTTP response returns, HTTP span closes

  [seconds later, a different goroutine, same process or a different
   instance entirely]

  outbox dispatcher's tick picks up the row
    -> extracts trace_context, starts "outbox.deliver sos_email" as a
       CHILD of the original HTTP span
    -> smtp.send span (records whether the circuit breaker was open)

  [meanwhile, on every instance subscribed to the Redis channel]

  ws.deliver span, also a child of the original HTTP span
```

The two boundary-crossing pieces are the interesting part for an interview story:

- **`internal/telemetry/telemetry.go`** - `Inject`/`Extract` (and their JSON-wrapped variants) serialize/deserialize a span's W3C `traceparent` into a plain `map[string]string`, so it can round-trip through anything that can hold a string: a Postgres JSONB column, a Redis pub/sub message.
- **`outbox_events.trace_context`** (new column, `db.Migrate`) - written on enqueue (`sos.go`, `sweeper.go`), read and extracted by the dispatcher (`outbox.go`) before it delivers the event. This is what makes an async, retried-with-backoff, potentially-minutes-later email send still show up attached to the request that triggered it.
- **`broadcastEnvelope.trace_context`** (`ws/hub.go`) - same idea over Redis pub/sub, since a WS broadcast might be delivered by a completely different instance than the one that published it.

Every SQL statement also gets a `pg.query` span for free (`internal/db/tracing.go`, a hand-rolled `pgx.QueryTracer` - no extra dependency), so "how much of this request was spent waiting on Postgres" is visible without any per-query code.

### Files touched

| File | What changed |
|---|---|
| `internal/telemetry/telemetry.go` | new - tracer init/shutdown, Carrier/Inject/Extract |
| `internal/db/tracing.go` | new - `pgx.QueryTracer` implementation |
| `internal/db/main.go` | `Connect` wires the tracer into `pgxpool.Config`; migration adds `outbox_events.trace_context` |
| `internal/api/tracing.go` | new - `Tracing` HTTP middleware |
| `internal/api/middleware.go` | `RequireAuth` tags the span with `user.id` |
| `cmd/api/main.go` | `telemetry.Init` at startup, `Tracing` registered first, shutdown flushed last |
| `internal/api/sos.go` | injects trace context into the SOS outbox row |
| `internal/sweeper/sweeper.go` | starts a `sweeper.tick` root span, injects it into the two outbox inserts it makes |
| `internal/outbox/outbox.go` | extracts trace context per event, wraps delivery in a span |
| `internal/notify/email.go` | `SendEmail` now takes `ctx`, adds an `smtp.send` span that flags breaker trips |
| `internal/ws/hub.go` | `broadcastEnvelope` carries trace context; `Broadcast`/`Run` inject/extract it |
| `docker-compose.yml` | adds a local Jaeger (all-in-one) service |

### Before you can build: install the new dependencies

I wrote the Go source but couldn't run `go build` myself in this session (the sandbox is out of disk space) - and hand-writing exact versions into `go.mod`/`go.sum` without being able to resolve/verify them is a good way to hand you a broken build. Run these from `backend/`:

```bash
go get go.opentelemetry.io/otel
go get go.opentelemetry.io/otel/sdk
go get go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp
go get go.opentelemetry.io/otel/exporters/stdout/stdouttrace
go mod tidy
go build ./...
```

If `go build` complains about anything, it's most likely one of: a package path typo on my part, or an API that shifted between otel-go versions since my training data. Paste me the error and I'll fix it - the design (middleware -> pg tracer -> outbox column -> ws envelope) won't change, at most a function name will.

### Running it

```bash
docker compose up -d          # now also starts jaeger
cd backend && go run ./cmd/api
```

`docker-compose.yml` sets `OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318` for the containerized `api` service. If you instead run the Go binary directly on your host while Jaeger runs in Docker, use `http://localhost:4318` instead (`jaeger` as a hostname only resolves inside the Docker network):

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
cd backend && go run ./cmd/api
```

With no `OTEL_EXPORTER_OTLP_ENDPOINT` set at all, spans print to stdout instead - useful to confirm tracing is firing before you even bring Jaeger up.

### Verifying a trace end-to-end

1. `docker compose up -d`, then run the API.
2. Sign up, log in, create a session, hit `POST /sessions/{id}/sos` (with an `Idempotency-Key` header).
3. Open `http://localhost:16686`, select service `raahi-api`, find the `POST /sessions/{id}/sos` trace.
4. You should see the HTTP span, several `pg.query` children, a `ws.publish` span, and - a moment later, once the outbox dispatcher's 5-second tick runs - an `outbox.deliver sos_email` span and an `smtp.send` span underneath it, still nested inside the same trace. That last part (a span appearing *after* the HTTP response already returned, still attached to the same trace) is the whole point of the outbox propagation work.
5. Trigger the sweeper path too: create a session with a checkpoint whose `expected_time` is already in the past, wait for a tick, and look for a `sweeper.tick` trace with its own `outbox.deliver overdue_email` child - proof the same propagation pattern works from a background job, not just a request.

If SMTP isn't configured locally, `smtp.send` won't appear (the outbox `deliver` functions no-op with a log line when `SMTP_EMAIL`/`SMTP_PASSWORD` are unset) - everything else in the trace still will.

---

## Part 2: what's left, and how to build it

The pattern that repeats across all three of these: define exactly what "good" looks like *before* writing instrumentation code, otherwise you end up with metrics/logs nobody ever looks at. Do them in this order - each one is easier with the previous one in place.

### 2a. Structured logging (zerolog or zap) + request IDs through Idempotency

**Why this one's next**: right now every `log.Printf` in this codebase is a free-floating string with no way to correlate "these five log lines are all about the same request." A request ID fixes that for logs the same way trace context fixes it for spans - and the two should actually be the *same* ID where it matters, so a support ticket ("here's the request ID from the error page") gets you straight to both the logs and the Jaeger trace.

**Steps**:

1. Pick zerolog or zap (zerolog has a smaller, more ergonomic API; zap is what most FAANG-adjacent Go shops actually run - either is a reasonable interview answer, but zap is the safer "I used what's used in production at scale" story). `go get github.com/rs/zerolog` or `go get go.uber.org/zap`.
2. Add a `internal/logging` package that builds a configured logger once (JSON output, level from an env var, timestamp format) - mirror the shape of `internal/telemetry`: one `Init` you call from `main.go`.
3. Generate a request ID in `api.Tracing` (you already have the perfect place - it's the outermost middleware). Two good options: reuse the trace ID that `telemetry.Tracer().Start` already generated (`span.SpanContext().TraceID().String()` - free correlation, no new ID needed) or generate a separate `X-Request-ID` via `google/uuid` (already a dependency) if you want request IDs to survive even when tracing is disabled. I'd use the trace ID - it's already there and it means "grep the logs for this ID" and "look up this trace in Jaeger" are the same ID.
4. Put the logger (with the ID already attached, e.g. `logger.With().Str("trace_id", ...).Logger()`) into the request context in `api.Tracing`, the same way `userIDKey` is already threaded through context in `middleware.go`. Every handler and middleware pulls it back out instead of calling the package-level `log` functions.
5. `Idempotency` (`internal/api/idempotency.go`) is the single best place to prove this works: log a line when a key is claimed, when a duplicate is rejected, and when a stored response is replayed - all three currently only have comments explaining the behavior, not a log trail you could actually search for "how many idempotent replays happened last week."
6. Do a pass replacing `log.Printf` with the contextual logger in the hot paths first: `sos.go`, `outbox.go`, `sweeper.go`, `notify/email.go`. Don't do a mechanical find-and-replace across the whole codebase in one sitting - it's more useful as a series of small, deliberate changes you can explain individually in an interview than one giant diff.

### 2b. Prometheus metrics + `/metrics` + Grafana

**Why this one's next, not first**: metrics answer "how much/how often," which is a different question than tracing's "what happened in this one request." You want both, but tracing is more valuable to build first because it's what taught you where the boundaries in this system actually are (outbox, ws pub/sub) - now you instrument volume across those same boundaries.

**Steps**:

1. `go get github.com/prometheus/client_golang/prometheus` and `.../promhttp`.
2. Add `r.Handle("/metrics", promhttp.Handler())` in `main.go` - do this *without* wrapping it in `api.Tracing`/auth, same as `/health` (metrics scrapers shouldn't need a JWT, and you don't want scrape traffic polluting your traces).
3. The four metrics from the original list, and where each one actually lives:
   - **WS connection count**: a `prometheus.Gauge`, `Inc()`/`Dec()` in `ws.Hub.Register`/`Unregister`.
   - **Outbox lag**: a `prometheus.Histogram` measuring `now() - next_attempt_at` (or better, `now() - created_at` for delivered events) at the point `dispatchBatch` marks an event `delivered` - this is your queue-depth/staleness signal, the single most useful outbox metric.
   - **Breaker state transitions**: `breaker.go` doesn't currently expose its state to anything outside the package. Add an optional `onStateChange func(from, to state)` callback to `Breaker` (set it in `notify/email.go` when constructing `smtpBreaker`), and increment a `prometheus.Counter` labeled by `from`/`to` state. This is a good one to talk through in an interview: it's a case where you had to *change* existing code to make it observable, not just bolt something on the side.
   - **Rate-limiter rejections**: `ratelimit.Allow` already returns `(bool, error)` - increment a `Counter` labeled by the `name` tag (`login`/`signup`) in `api.RateLimit` (`middleware.go`) whenever `allowed` is false.
4. Grafana: `docker compose` add a `grafana` service, point it at a Prometheus instance scraping `/metrics` (add a `prometheus` service too, or run one locally), build one dashboard with those four panels. Doesn't need to be fancy - the interview-relevant part is that you can explain *why* each metric type (gauge vs. histogram vs. counter) was the right choice for that signal.

### 2c. SLOs / error budgets for the SOS path

**Why this one's last**: an SLO is a *target expressed in terms of* the metrics and traces above - it's meaningless to define before you have the signal to measure it against.

**Steps**:

1. Pick the SLI (service level *indicator* - the actual measured thing) for the SOS path specifically, not the whole API. Two solid candidates, both measurable from what's now instrumented:
   - **Latency**: p99 of the `POST /sessions/{id}/sos` HTTP span duration (from the histogram you'd add via `api.Tracing`, or just wrap it - add a `prometheus.Histogram` observation right there alongside the span).
   - **Availability/correctness**: proportion of SOS triggers where the `outbox.deliver sos_email` span you now have actually completes successfully within some bound (say, 2 minutes of the triggering request) - this is a genuinely interesting SLI because it spans an async boundary, which most textbook SLO examples don't.
2. Pick numbers and write them down (e.g., "p99 SOS response < 300ms, SOS email delivered within 2 minutes for 99.9% of triggers, measured over a rolling 30 days") in a short `docs/SLO.md` - the specific numbers matter less than being able to justify them in an interview ("SOS is the one path where slow is a safety problem, so it gets the tightest budget in the system").
3. Error budget: 99.9% over 30 days = ~43 minutes of budget. The point of writing this down isn't the math, it's the policy that goes with it - e.g. "if the SOS delivery SLO is burning faster than budget allows, that's a page, and it blocks shipping anything else touching the outbox until it's back under control." You don't need real on-call tooling to make this a legitimate interview story; you need to demonstrate you understand SLOs are a *decision framework*, not a dashboard.
4. If you want the alerting to be real rather than just documented: a Prometheus alerting rule using `histogram_quantile` on the latency histogram, or a rule computing the outbox-delivery-success ratio from the `outbox.deliver` span outcomes (you'd need a counter of `outbox.deliver` successes/failures by `event_type` for this - a natural extension of the breaker-state-transitions counter above).

Bring the code back to me once you've built one of these and I'll do the same close read + implementation pass I did for tracing, if you want a second worked example instead of doing all three solo.

# Raahi — Product Walkthrough + Interview Demo Guide

Two things in one doc: (1) what the product actually does, end to end, as a user would experience it, mapped to what's happening on the backend at each step; (2) a concrete, timed script for demoing this in a backend/infra interview, where the demo should prove systems understanding, not show off UI.

---

## PART A: The product, walked through as a user

### 1. Sign up / log in

You create an account with an email and password. Backend: password is bcrypt-hashed before storage, never kept in plain text. On login, a JWT is issued (24-hour expiry) and the client stores it, attaching it as `Authorization: Bearer <token>` on every request after that.

### 2. Add trusted contacts

Before starting a session, you add the people who should be emailed if something goes wrong — name, phone, email, relationship. Plain CRUD, nothing fancy here. This is deliberate: the interesting engineering is all downstream of this, not in contact management.

### 3. Create a session (the wizard)

Five steps: name/route text → checkpoints (pick a Start and Destination by typing a place name, the app looks up a real route from a routing service and auto-generates checkpoints spaced along it) → grace period (how many minutes late is acceptable before the app checks in with you) → pick which contacts should be notified → review and submit.

Backend, on submit: one `POST /sessions` request creates the session row and every checkpoint row **inside a single database transaction** — either the whole session with all its checkpoints gets created, or none of it does. Each checkpoint's position is precomputed as "how far along the route, in meters" rather than a raw lat/lng, so later location updates don't have to redo that math on every single GPS ping.

### 4. The active session screen

Once a session starts, the app begins sending your live GPS location to the backend every ~10-15 seconds. Two things happen server-side on each ping:

- Your position is projected onto the planned route to compute **progress** (how far along you've gotten) and **deviation** (how far off the path you currently are). Checkpoints flip to `reached` automatically once your progress passes their stored position — this works even if you take a different street than the one the routing engine originally picked.
- The update is broadcast live over a WebSocket, so the screen updates instantly without a refresh.

If you drift far enough off the planned route for long enough (3 consecutive off-route pings, with a cooldown), the app automatically recalculates a new route from wherever you are to the same destination — like a turn-by-turn nav app's "recalculating."

### 5. Checkpoint escalation (the core safety feature)

This runs entirely in the background, on a timer, independent of anything you do:

```
pending → overdue → pinged → contacts_alerted
   ↓
reached
```

If you miss a checkpoint's expected time: first you get a quiet email nudge (`overdue`). If you're still late past your grace period, the app shows an "Are you OK?" popup on your own screen (`pinged`) — your last chance to confirm you're fine. If you still don't respond after a bit more time, every trusted contact gets emailed with your last known location (`contacts_alerted`).

A background job (the "sweeper") checks every 15 seconds whether any checkpoint's time has come, and moves it through these states. Every state change is delivered live to whoever's watching via the same WebSocket mechanism as location updates.

### 6. SOS

A press-and-hold button (1.5 seconds, deliberately not a single tap, to avoid accidental triggers) that immediately marks the session as SOS-triggered and emails every contact with your current location — no waiting, no grace period.

### 7. Share link

You can generate a link that lets someone without a Raahi account view a read-only, live-updating status page for your session — no login required, just the link (expires after 12 hours, revocable).

### 8. History

Every past session, filterable by outcome, with a flagged "emergency escalation" banner on any session where a checkpoint ever got as far as `overdue`/`pinged`/`contacts_alerted` — even if it ultimately completed fine, so a close call is still visible later.

---

## PART B: The interview demo

**Golden rule for a backend-focused demo: open with architecture, not the app. Spend most of the time proving resilience and correctness, not clicking through screens.**

### Before the interview — setup checklist

- [ ] Have a session ready to create fresh during the demo, with a **very short grace period** (1 minute) and a checkpoint whose expected time is only ~30-60 seconds out — so you can actually watch it escalate live within the interview instead of waiting.
- [ ] Have Render's log page open, filtered/searched to something readable (not the raw OTel JSON dump — search for `sweeper:` or `ws:` to keep it clean).
- [ ] Have your terminal ready with `curl` commands pre-typed (see below) so you're not fumbling live.
- [ ] Decide in advance: web or mobile for the visual part? Mobile is arguably the stronger story right now (it has the more complete `route.ts`, and demonstrates a real native app, not just a website). Web works fine too now that `route.ts` is fixed — just make sure you've tested session creation on whichever one you pick, once, before the interview.
- [ ] If you want to show distributed tracing, you need your **local** docker-compose stack running (`docker compose up`) with Jaeger — the deployed Render instance doesn't export traces anywhere (`OTEL_EXPORTER_OTLP_ENDPOINT` isn't set there). This is optional/stretch — skip it if short on time, or if you don't want to run a second stack alongside the deployed demo.

### Full script (aim for ~8-10 minutes if given room; cut to the compressed version below if not)

**1. Architecture, verbally, 30-45 seconds.** "It's a Go backend with Postgres and Redis, plus a Next.js web client and a React Native mobile client — both thin, all the actual logic lives in the backend. Three background loops run inside the API process: a sweeper that escalates missed checkpoints, an outbox dispatcher that delivers emails reliably, and a WebSocket hub that pushes live updates out over a Redis-backed pub/sub layer."

**2. Create a session live**, on whichever client you picked, with the short grace period. While it's being created, narrate: "this insert is one transaction — the session row and every checkpoint row commit together or not at all."

**3. Show the live update working.** Open browser devtools → Network → WS filter (if web) before or during this step, and point out the WebSocket connection and the message that arrives the moment something changes. This is your chance to mention, briefly and confidently, the actual bug you fixed: "this used to silently break in production — Redis wasn't configured, so this pub/sub layer failed quietly while everything else looked healthy. I found it by proving the database was correct first, which isolated the bug to delivery, not logic." (Full version of this story is in `RAAHI_LEARN_FROM_SCRATCH.md` Part 12 if you want to rehearse the whole thing — but the one-paragraph version above is the right length for a demo.)

**4. Let the checkpoint actually escalate on screen**, since your grace period is short. Narrate the state machine out loud as it happens: `pending → overdue → pinged → contacts_alerted`, and that a background job on a 15-second tick drives this, not any client action.

**5. Prove resilience — pick one or two of these, don't do all three unless asked:**
   - **Circuit breaker**: temporarily break `SMTP_PASSWORD` in Render's env (or just describe it if you don't want to actually break the live deploy mid-interview) and show the pattern in code instead — `internal/breaker/breaker.go` — explaining the three states and why it's per-instance, not Redis-shared.
   - **Idempotency**: run the same `curl` twice with the same key, show the second response is instant and identical (below).
   - **Rate limiter**: hammer `/login` a few times past the limit, show the 429.

**6. (Optional, if time/interest) Distributed tracing.** Open Jaeger locally, click into one trace that spans an HTTP request, a DB write, and — because trace context is serialized into the outbox row itself — the email send that happens seconds later in a completely different goroutine. This is a strong, less-common thing to show if you have the setup ready; skip it without hesitation if you don't.

**7. Close with the honest limitations, unprompted.** This lands better coming from you than being found by them: "WebSocket endpoints aren't behind auth right now — that's a known simplification I'd fix with a short-lived signed token in the handshake. And I found a real gap during this same debugging pass: the web app's routing logic had drifted out of sync with a more complete version that only existed on mobile — fixed that by porting it back over." Naming your own gaps, correctly and specifically, reads as far stronger than pretending everything is airtight.

### Compressed version (3-4 minutes, if that's all you get)

Architecture (30s) → create a session with a short grace period and let it escalate live while you narrate the sweeper/state machine (90s) → one resilience proof, idempotency via curl is fastest and most reliable to demo live (60s) → one honest limitation, unprompted (20s).

### Ready-to-paste curl commands for the idempotency demo

```bash
# First call - creates the session
curl -X POST https://<your-render-url>/sessions \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: demo-key-001" \
  -d '{"name":"Demo","route":"Test","grace_period":1,"checkpoints":[{"name":"Start","lat":0,"lng":0,"expected_time":"2026-01-01T00:00:00Z"}]}'

# Second call, same key - should return the exact same response instantly,
# without creating a second session
curl -X POST https://<your-render-url>/sessions \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: demo-key-001" \
  -d '{"name":"Demo","route":"Test","grace_period":1,"checkpoints":[{"name":"Start","lat":0,"lng":0,"expected_time":"2026-01-01T00:00:00Z"}]}'
```

Get `<token>` beforehand by logging in once via `POST /login` and saving the returned token. Test this exact sequence once *before* the interview so you're not debugging your demo commands live.

### If something breaks live

Have a fallback line ready and don't panic-debug in front of the interviewer: "this is a free-tier deployment, so occasionally there's cold-start latency or a flaky dependency — let me walk through what the code does here instead while that catches up." A calm recovery is a better signal than a flawless demo anyway.

### Rehearsal checklist

- [ ] Run the full script once, start to finish, alone, with a timer.
- [ ] Test the exact curl commands against the real deployed URL, with a real token, at least once.
- [ ] Confirm the short-grace-period session actually escalates within the time you expect (check the sweeper's 15-second tick plus your grace period plus the fixed 3-minute secondary grace period — for a genuinely fast demo, you mainly want to show `pending → overdue`, not wait for the full chain to `contacts_alerted`, which takes several extra minutes even with a 1-minute grace period).

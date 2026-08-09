// Package breaker implements a minimal circuit breaker: a guard in front of
// a call to an unreliable dependency that stops attempting the call at all
// once it's seen enough consecutive failures, instead of letting every
// caller separately wait out their own timeout against something already
// known to be down.
//
// Three states, same names used everywhere this pattern shows up (Hystrix,
// resilience4j, etc.):
//   - closed: normal operation, every call goes through.
//   - open: tripped - calls fail immediately with ErrOpen, no attempt made.
//   - half-open: after the cooldown, exactly one call is let through as a
//     trial. Success closes the breaker again; failure re-opens it for
//     another cooldown.
//
// Deliberately in-process rather than shared via Redis, unlike the rate
// limiter: each instance tracks the health of the dependency along its own
// network path, which is the right scope for something like "is this
// instance currently able to reach smtp.gmail.com," not something that
// needs to be consistent cluster-wide.
package breaker

import (
	"errors"
	"sync"
	"time"
)

var ErrOpen = errors.New("circuit breaker is open")

type state int

const (
	closed state = iota
	open
	halfOpen
)

type Breaker struct {
	mu               sync.Mutex
	state            state
	consecutiveFails int
	openedAt         time.Time

	failureThreshold int
	cooldown         time.Duration
}

// New builds a Breaker that trips open after failureThreshold consecutive
// failures, and stays open for cooldown before allowing a trial call.
func New(failureThreshold int, cooldown time.Duration) *Breaker {
	return &Breaker{
		failureThreshold: failureThreshold,
		cooldown:         cooldown,
	}
}

// Call runs fn if the breaker currently allows it, and updates the
// breaker's state based on the outcome. Returns ErrOpen without calling fn
// at all if the breaker is tripped and still cooling down.
func (b *Breaker) Call(fn func() error) error {
	if !b.allow() {
		return ErrOpen
	}

	err := fn()
	b.recordResult(err)
	return err
}

func (b *Breaker) allow() bool {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.state == open {
		if time.Since(b.openedAt) < b.cooldown {
			return false
		}
		// Cooldown elapsed - let exactly one trial call through.
		b.state = halfOpen
	}
	return true
}

func (b *Breaker) recordResult(err error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	if err == nil {
		b.consecutiveFails = 0
		b.state = closed
		return
	}

	b.consecutiveFails++
	if b.state == halfOpen || b.consecutiveFails >= b.failureThreshold {
		b.state = open
		b.openedAt = time.Now()
	}
}

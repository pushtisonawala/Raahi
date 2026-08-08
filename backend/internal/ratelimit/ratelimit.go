
package ratelimit

import (
	"context"
	_ "embed"
	"time"

	"github.com/redis/go-redis/v9"
)

var tokenBucketScript string
type Limiter struct {
	client       *redis.Client
	script       *redis.Script
	capacity     float64
	refillPerSec float64
}

func New(client *redis.Client, capacity int, window time.Duration) *Limiter {
	return &Limiter{
		client:       client,
		script:       redis.NewScript(tokenBucketScript),
		capacity:     float64(capacity),
		refillPerSec: float64(capacity) / window.Seconds(),
	}
}

func (l *Limiter) Allow(ctx context.Context, key string) (bool, error) {
	now := float64(time.Now().UnixNano()) / 1e9

	result, err := l.script.Run(ctx, l.client, []string{key},
		l.capacity, l.refillPerSec, now, 1,
	).Int()
	if err != nil {
		return false, err
	}

	return result == 1, nil
}

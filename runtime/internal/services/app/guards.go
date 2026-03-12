package app

import (
	"sync"
	"sync/atomic"
	"time"
)

const (
	maxPayloadBytes          = 64 * 1024
	rateLimitPerSecond       = 100
	loopLimitPerSecond       = 20
	loopBreakDurationSeconds = 60
)

type appRateLimiter struct {
	buckets sync.Map
}

type rateBucket struct {
	rollMu         sync.Mutex
	currentSecond  atomic.Int64
	currentCount   atomic.Int64
	previousSecond atomic.Int64
	previousCount  atomic.Int64
}

func newAppRateLimiter() *appRateLimiter {
	return &appRateLimiter{}
}

func (l *appRateLimiter) Allow(appID string, now time.Time) bool {
	if appID == "" {
		return true
	}
	raw, _ := l.buckets.LoadOrStore(appID, &rateBucket{})
	bucket := raw.(*rateBucket)
	second := now.Unix()
	bucket.rollWindow(second)

	current := bucket.currentCount.Add(1)
	previous := int64(0)
	if bucket.previousSecond.Load() == second-1 {
		previous = bucket.previousCount.Load()
	}

	fractionRemaining := 1 - float64(now.Nanosecond())/float64(time.Second)
	estimate := float64(current) + float64(previous)*fractionRemaining
	if estimate <= rateLimitPerSecond {
		return true
	}

	bucket.currentCount.Add(-1)
	return false
}

func (b *rateBucket) rollWindow(second int64) {
	current := b.currentSecond.Load()
	if current == second {
		return
	}

	b.rollMu.Lock()
	defer b.rollMu.Unlock()

	current = b.currentSecond.Load()
	if current == second {
		return
	}
	if current == 0 {
		b.currentSecond.Store(second)
		b.currentCount.Store(0)
		b.previousSecond.Store(0)
		b.previousCount.Store(0)
		return
	}
	if second == current+1 {
		b.previousSecond.Store(current)
		b.previousCount.Store(b.currentCount.Load())
	} else {
		b.previousSecond.Store(0)
		b.previousCount.Store(0)
	}
	b.currentSecond.Store(second)
	b.currentCount.Store(0)
}

type appLoopDetector struct {
	pairs sync.Map
}

type loopBucket struct {
	rollMu        sync.Mutex
	currentSecond atomic.Int64
	forwardCount  atomic.Int64
	reverseCount  atomic.Int64
	breakerUntil  atomic.Int64
}

func newAppLoopDetector() *appLoopDetector {
	return &appLoopDetector{}
}

func (d *appLoopDetector) Allow(fromAppID string, toAppID string, now time.Time) bool {
	if fromAppID == "" || toAppID == "" || fromAppID == toAppID {
		return true
	}

	key, forward := orderedPair(fromAppID, toAppID)
	raw, _ := d.pairs.LoadOrStore(key, &loopBucket{})
	bucket := raw.(*loopBucket)
	if now.Unix() < bucket.breakerUntil.Load() {
		return false
	}

	second := now.Unix()
	bucket.rollWindow(second)
	if forward {
		bucket.forwardCount.Add(1)
	} else {
		bucket.reverseCount.Add(1)
	}

	forwardCount := bucket.forwardCount.Load()
	reverseCount := bucket.reverseCount.Load()
	if forwardCount > 0 && reverseCount > 0 && forwardCount+reverseCount > loopLimitPerSecond {
		bucket.breakerUntil.Store(now.Add(loopBreakDurationSeconds * time.Second).Unix())
		if forward {
			bucket.forwardCount.Add(-1)
		} else {
			bucket.reverseCount.Add(-1)
		}
		return false
	}
	return true
}

func (b *loopBucket) rollWindow(second int64) {
	current := b.currentSecond.Load()
	if current == second {
		return
	}

	b.rollMu.Lock()
	defer b.rollMu.Unlock()

	current = b.currentSecond.Load()
	if current == second {
		return
	}
	b.currentSecond.Store(second)
	b.forwardCount.Store(0)
	b.reverseCount.Store(0)
}

func orderedPair(left string, right string) (string, bool) {
	if left <= right {
		return left + "::" + right, true
	}
	return right + "::" + left, false
}

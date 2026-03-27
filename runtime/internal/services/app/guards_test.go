package app

import (
	"testing"
	"time"
)

func TestAppRateLimiterEvictsStaleBuckets(t *testing.T) {
	limiter := newAppRateLimiter()
	now := time.Unix(1_700_000_000, 0).UTC()

	stale := &rateBucket{}
	stale.lastSeenUnix.Store(now.Add(-rateLimiterIdleTTL - time.Second).Unix())
	limiter.buckets.Store("stale-app", stale)

	active := &rateBucket{}
	active.lastSeenUnix.Store(now.Unix())
	limiter.buckets.Store("active-app", active)

	limiter.cleanupCounter.Store(rateLimiterCleanupEvery - 1)
	if !limiter.Allow("fresh-app", now) {
		t.Fatal("expected fresh request to pass rate limiter")
	}

	if _, ok := limiter.buckets.Load("stale-app"); ok {
		t.Fatal("expected stale app bucket to be evicted")
	}
	if _, ok := limiter.buckets.Load("active-app"); !ok {
		t.Fatal("expected active app bucket to be retained")
	}
	if _, ok := limiter.buckets.Load("fresh-app"); !ok {
		t.Fatal("expected fresh app bucket to be recorded")
	}
}

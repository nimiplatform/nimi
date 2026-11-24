package filedownload

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// ErrTransientAttemptsExhausted marks a network or body-stream failure that
// the download core classified as transient but could not recover within its
// bounded attempt budget. Callers may use this typed marker to offer a retry;
// diagnostic error text is never part of that decision.
var ErrTransientAttemptsExhausted = errors.New("filedownload: transient attempts exhausted")

// ErrRateLimited marks an upstream HTTP 429 rate-limit response. Callers
// should honor RetryAfter before retrying instead of looping immediately.
var ErrRateLimited = errors.New("filedownload: rate limited")

// RateLimitError preserves an upstream HTTP 429 status and any parsed reset
// window from Retry-After or IETF RateLimit headers.
type RateLimitError struct {
	StatusCode int
	RetryAfter time.Duration
}

func (e *RateLimitError) Error() string {
	if e == nil {
		return ErrRateLimited.Error()
	}
	if e.RetryAfter > 0 {
		return fmt.Sprintf("%s: status=%d retry_after=%s", ErrRateLimited.Error(), e.StatusCode, e.RetryAfter.Round(time.Second))
	}
	return fmt.Sprintf("%s: status=%d", ErrRateLimited.Error(), e.StatusCode)
}

func (e *RateLimitError) Unwrap() error {
	return ErrRateLimited
}

const maxParsedRetryAfter = 24 * time.Hour

// Bound delta-seconds before converting to nanoseconds so a long cooldown
// cannot overflow into a short (or missing) delay.
func retryAfterDelta(raw string) time.Duration {
	seconds, err := strconv.ParseUint(raw, 10, 64)
	if errors.Is(err, strconv.ErrRange) {
		return maxParsedRetryAfter
	}
	if err != nil {
		return 0
	}
	return time.Duration(min(seconds, uint64(maxParsedRetryAfter/time.Second))) * time.Second
}

// ParseRetryAfter extracts a bounded reset window from standard Retry-After
// (seconds or HTTP-date) and IETF RateLimit ("policy";r=0;t=<seconds>) headers.
func ParseRetryAfter(header http.Header, now time.Time) time.Duration {
	if header == nil {
		return 0
	}
	var best time.Duration
	consider := func(d time.Duration) {
		if d <= 0 {
			return
		}
		if d > maxParsedRetryAfter {
			d = maxParsedRetryAfter
		}
		if d > best {
			best = d
		}
	}
	if raw := strings.TrimSpace(header.Get("Retry-After")); raw != "" {
		if delta := retryAfterDelta(raw); delta > 0 {
			consider(delta)
		} else if until, err := http.ParseTime(raw); err == nil {
			consider(until.Sub(now))
		}
	}
	for _, value := range header.Values("RateLimit") {
		for _, item := range strings.Split(value, ",") {
			for _, part := range strings.Split(item, ";") {
				key, val, ok := strings.Cut(strings.TrimSpace(part), "=")
				if !ok {
					continue
				}
				if strings.EqualFold(strings.TrimSpace(key), "t") {
					consider(retryAfterDelta(strings.TrimSpace(val)))
				}
			}
		}
	}
	return best
}

package daemonctl

import (
	"context"
	"time"
)

func minDuration(left time.Duration, right time.Duration) time.Duration {
	if left <= 0 {
		return right
	}
	if left < right {
		return left
	}
	return right
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if trim := len(value); trim > 0 {
			for _, ch := range value {
				if ch != ' ' && ch != '\t' && ch != '\n' && ch != '\r' {
					return value
				}
			}
		}
	}
	return ""
}

func sleepContext(ctx context.Context, delay time.Duration, sleeper func(time.Duration)) error {
	if ctx == nil {
		sleeper(delay)
		return nil
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func minInt(left int, right int) int {
	if left < right {
		return left
	}
	return right
}

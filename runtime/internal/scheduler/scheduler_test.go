package scheduler

import (
	"context"
	"testing"
	"time"
)

func TestSchedulerPerAppConcurrencyIsolation(t *testing.T) {
	s := New(Config{
		GlobalConcurrency:   2,
		PerAppConcurrency:   1,
		StarvationThreshold: 50 * time.Millisecond,
	})

	ctx := context.Background()
	releaseA, _, err := s.Acquire(ctx, "app-a")
	if err != nil {
		t.Fatalf("acquire app-a: %v", err)
	}
	defer releaseA()

	releaseB, _, err := s.Acquire(ctx, "app-b")
	if err != nil {
		t.Fatalf("acquire app-b should not be blocked by app-a per-app limit: %v", err)
	}
	releaseB()
}

func TestSchedulerMarksStarvationWhenWaitExceedsThreshold(t *testing.T) {
	s := New(Config{
		GlobalConcurrency:   1,
		PerAppConcurrency:   1,
		StarvationThreshold: 10 * time.Millisecond,
	})
	ctx := context.Background()

	release, _, err := s.Acquire(ctx, "app-a")
	if err != nil {
		t.Fatalf("first acquire: %v", err)
	}

	resultCh := make(chan AcquireResult, 1)
	errCh := make(chan error, 1)
	go func() {
		releaseBlocked, result, acquireErr := s.Acquire(ctx, "app-b")
		if acquireErr != nil {
			errCh <- acquireErr
			return
		}
		releaseBlocked()
		resultCh <- result
	}()

	time.Sleep(20 * time.Millisecond)
	release()

	select {
	case acquireErr := <-errCh:
		t.Fatalf("blocked acquire failed: %v", acquireErr)
	case result := <-resultCh:
		if !result.Starved {
			t.Fatalf("expected starvation=true when wait exceeds threshold")
		}
		if result.Waited < 10*time.Millisecond {
			t.Fatalf("expected waited >= threshold, got=%s", result.Waited)
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("blocked acquire timeout")
	}
}

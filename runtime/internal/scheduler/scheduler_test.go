package scheduler

import (
	"context"
	"errors"
	"sync"
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

func TestSchedulerReleaseIsGoroutineSafe(t *testing.T) {
	s := New(Config{
		GlobalConcurrency: 1,
		PerAppConcurrency: 1,
	})

	release, _, err := s.Acquire(context.Background(), "app-a")
	if err != nil {
		t.Fatalf("acquire: %v", err)
	}

	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			release()
		}()
	}
	wg.Wait()

	releaseAgain, _, err := s.Acquire(context.Background(), "app-a")
	if err != nil {
		t.Fatalf("re-acquire after concurrent release: %v", err)
	}
	releaseAgain()
}

func TestSchedulerRemovesIdlePerAppSemaphore(t *testing.T) {
	s := New(Config{
		GlobalConcurrency: 1,
		PerAppConcurrency: 1,
	})

	release, _, err := s.Acquire(context.Background(), "app-a")
	if err != nil {
		t.Fatalf("acquire: %v", err)
	}
	release()

	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.perApp) != 0 {
		t.Fatalf("expected idle per-app semaphore cleanup, got=%d", len(s.perApp))
	}
}

func TestSchedulerAcquireWrapsContextError(t *testing.T) {
	s := New(Config{
		GlobalConcurrency: 1,
		PerAppConcurrency: 1,
	})

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, _, err := s.Acquire(ctx, "app-a")
	if err == nil {
		t.Fatal("expected wrapped context cancellation")
	}
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context.Canceled, got=%v", err)
	}
	if err.Error() != "scheduler acquire: context canceled" {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestSchedulerSameAppBlocksAtPerAppLimit(t *testing.T) {
	s := New(Config{
		GlobalConcurrency: 2,
		PerAppConcurrency: 1,
	})

	release, _, err := s.Acquire(context.Background(), "app-a")
	if err != nil {
		t.Fatalf("first acquire: %v", err)
	}
	defer release()

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()

	_, _, err = s.Acquire(ctx, "app-a")
	if err == nil {
		t.Fatal("expected same-app acquire to block until context deadline")
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected context deadline exceeded, got=%v", err)
	}
}

func TestSchedulerCancelDuringPerAppWaitReleasesGlobalSlot(t *testing.T) {
	s := New(Config{
		GlobalConcurrency: 2,
		PerAppConcurrency: 1,
	})

	releaseA, _, err := s.Acquire(context.Background(), "app-a")
	if err != nil {
		t.Fatalf("first acquire app-a: %v", err)
	}
	defer releaseA()

	releaseB, _, err := s.Acquire(context.Background(), "app-b")
	if err != nil {
		t.Fatalf("first acquire app-b: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	_, _, err = s.Acquire(ctx, "app-a")
	if err == nil {
		t.Fatal("expected blocked same-app acquire to time out")
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected context deadline exceeded, got=%v", err)
	}

	releaseB()

	releaseC, _, err := s.Acquire(context.Background(), "app-c")
	if err != nil {
		t.Fatalf("global slot should be released after per-app timeout: %v", err)
	}
	releaseC()
}

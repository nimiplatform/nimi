package engine

import (
	"sync/atomic"
	"testing"
	"time"
)

func TestWaitSupervisorExitProbeSucceedsWhenSlowProcessExitsWithinWindow(t *testing.T) {
	var alive atomic.Bool
	alive.Store(true)
	go func() {
		time.Sleep(35 * time.Millisecond)
		alive.Store(false)
	}()

	started := time.Now()
	if !waitSupervisorExitProbe(250*time.Millisecond, 5*time.Millisecond, func() bool { return !alive.Load() }) {
		t.Fatal("slow process exit inside the bounded window was reported as alive")
	}
	if elapsed := time.Since(started); elapsed < 25*time.Millisecond || elapsed >= 250*time.Millisecond {
		t.Fatalf("slow-exit wait duration = %s, want exit observation before deadline", elapsed)
	}
}

func TestWaitSupervisorExitProbeFailsAfterBoundedWindow(t *testing.T) {
	started := time.Now()
	if waitSupervisorExitProbe(45*time.Millisecond, 5*time.Millisecond, func() bool { return false }) {
		t.Fatal("process alive beyond the bounded window was reported as exited")
	}
	if elapsed := time.Since(started); elapsed < 35*time.Millisecond || elapsed > 250*time.Millisecond {
		t.Fatalf("timeout wait duration = %s, want bounded deadline", elapsed)
	}
}

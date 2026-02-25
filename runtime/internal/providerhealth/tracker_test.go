package providerhealth

import (
	"testing"
	"time"
)

func TestSubscribeReceivesStateTransitions(t *testing.T) {
	tracker := New()
	updates, cancel := tracker.Subscribe(4)
	defer cancel()

	tracker.Mark("cloud-litellm", true, "")

	select {
	case item := <-updates:
		if item.Name != "cloud-litellm" {
			t.Fatalf("unexpected provider name: %s", item.Name)
		}
		if item.State != StateHealthy {
			t.Fatalf("expected healthy state, got=%s", item.State)
		}
	case <-time.After(200 * time.Millisecond):
		t.Fatalf("expected first state update")
	}

	// Same healthy status should not emit extra events.
	tracker.Mark("cloud-litellm", true, "")
	select {
	case <-updates:
		t.Fatalf("unexpected update for unchanged healthy state")
	case <-time.After(80 * time.Millisecond):
	}

	tracker.Mark("cloud-litellm", false, "timeout")
	select {
	case item := <-updates:
		if item.State != StateUnhealthy {
			t.Fatalf("expected unhealthy state, got=%s", item.State)
		}
		if item.ConsecutiveFailures != 1 {
			t.Fatalf("expected failures=1, got=%d", item.ConsecutiveFailures)
		}
		if item.LastReason != "timeout" {
			t.Fatalf("expected reason timeout, got=%s", item.LastReason)
		}
	case <-time.After(200 * time.Millisecond):
		t.Fatalf("expected unhealthy update")
	}
}

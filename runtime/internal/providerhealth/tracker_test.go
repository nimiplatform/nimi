package providerhealth

import "testing"

func TestSubscribeReceivesStateTransitions(t *testing.T) {
	tracker := New()
	updates, cancel := tracker.Subscribe(4)
	defer cancel()

	if err := tracker.Mark("cloud-nimillm", true, ""); err != nil {
		t.Fatalf("Mark healthy: %v", err)
	}

	select {
	case item := <-updates:
		if item.Name != "cloud-nimillm" {
			t.Fatalf("unexpected provider name: %s", item.Name)
		}
		if item.State != StateHealthy {
			t.Fatalf("expected healthy state, got=%s", item.State)
		}
	default:
		t.Fatalf("expected first state update")
	}

	// Same healthy status should not emit extra events.
	if err := tracker.Mark("cloud-nimillm", true, ""); err != nil {
		t.Fatalf("Mark unchanged healthy: %v", err)
	}
	select {
	case <-updates:
		t.Fatalf("unexpected update for unchanged healthy state")
	default:
	}

	if err := tracker.Mark("cloud-nimillm", false, "timeout"); err != nil {
		t.Fatalf("Mark unhealthy: %v", err)
	}
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
	default:
		t.Fatalf("expected unhealthy update")
	}
}

func TestIsHealthyFailsClosedForUnknownProvider(t *testing.T) {
	tracker := New()
	if tracker.IsHealthy("missing-provider") {
		t.Fatalf("unknown provider should not be reported healthy")
	}
}

func TestMarkRejectsEmptyName(t *testing.T) {
	tracker := New()
	if err := tracker.Mark("   ", true, ""); err == nil {
		t.Fatalf("expected empty provider name error")
	}
}

func TestSubscribeTracksDroppedNotifications(t *testing.T) {
	tracker := New()
	updates, cancel := tracker.Subscribe(1)
	defer cancel()

	if err := tracker.Mark("cloud-nimillm", true, ""); err != nil {
		t.Fatalf("Mark healthy: %v", err)
	}
	if err := tracker.Mark("cloud-nimillm", false, "timeout"); err != nil {
		t.Fatalf("Mark unhealthy: %v", err)
	}

	if got := tracker.DroppedNotifications(); got == 0 {
		t.Fatalf("expected dropped notification count to increase")
	}
	if got := tracker.WatcherCount(); got != 1 {
		t.Fatalf("expected watcher count 1, got %d", got)
	}
	select {
	case <-updates:
	default:
		t.Fatalf("expected buffered update")
	}
}

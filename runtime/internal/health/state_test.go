package health

import (
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestNewStateInitialStatus(t *testing.T) {
	s := NewState()
	snap := s.Snapshot()
	if snap.Status != StatusStopped {
		t.Fatalf("initial status: got=%v want=STOPPED", snap.Status)
	}
	if snap.Reason != "not started" {
		t.Fatalf("initial reason: got=%q want=%q", snap.Reason, "not started")
	}
	if snap.SampledAt.IsZero() {
		t.Fatal("initial SampledAt must be set")
	}
}

func TestSetStatusTransitions(t *testing.T) {
	tests := []struct {
		name   string
		from   Status
		to     Status
		reason string
	}{
		{"STOPPED→STARTING", StatusStopped, StatusStarting, "booting"},
		{"STARTING→READY", StatusStarting, StatusReady, "ready"},
		{"READY→DEGRADED", StatusReady, StatusDegraded, "provider timeout"},
		{"READY→STOPPING", StatusReady, StatusStopping, "shutdown"},
		{"STOPPING→STOPPED", StatusStopping, StatusStopped, "terminated"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := NewState()
			s.SetStatus(tt.from, "setup")
			s.SetStatus(tt.to, tt.reason)
			snap := s.Snapshot()
			if snap.Status != tt.to {
				t.Fatalf("status: got=%v want=%v", snap.Status, tt.to)
			}
			if snap.Reason != tt.reason {
				t.Fatalf("reason: got=%q want=%q", snap.Reason, tt.reason)
			}
		})
	}
}

func TestSetActivity(t *testing.T) {
	s := NewState()
	s.SetActivity(5, 2, 3)
	snap := s.Snapshot()
	if snap.QueueDepth != 5 || snap.ActiveWorkflows != 2 || snap.ActiveInferenceJobs != 3 {
		t.Fatalf("activity: queue=%d wf=%d inf=%d", snap.QueueDepth, snap.ActiveWorkflows, snap.ActiveInferenceJobs)
	}

	s.SetActivity(-1, -2, -3)
	snap = s.Snapshot()
	if snap.QueueDepth != 0 || snap.ActiveWorkflows != 0 || snap.ActiveInferenceJobs != 0 {
		t.Fatalf("negative activity values should be clamped to zero: %+v", snap)
	}
}

func TestSetResource(t *testing.T) {
	s := NewState()
	s.SetResource(100, 200, 300)
	snap := s.Snapshot()
	if snap.CPUMilli != 100 || snap.MemoryBytes != 200 || snap.VRAMBytes != 300 {
		t.Fatalf("resource: cpu=%d mem=%d vram=%d", snap.CPUMilli, snap.MemoryBytes, snap.VRAMBytes)
	}

	s.SetResource(-100, -200, -300)
	snap = s.Snapshot()
	if snap.CPUMilli != 0 || snap.MemoryBytes != 0 || snap.VRAMBytes != 0 {
		t.Fatalf("negative resource values should be clamped to zero: %+v", snap)
	}
}

func TestStatusReady(t *testing.T) {
	if StatusReady.Ready() != true {
		t.Fatal("StatusReady.Ready() should be true")
	}
	if StatusStopped.Ready() != false {
		t.Fatal("StatusStopped.Ready() should be false")
	}
	if StatusDegraded.Ready() != false {
		t.Fatal("StatusDegraded.Ready() should be false")
	}
}

func TestStatusString(t *testing.T) {
	tests := []struct {
		status Status
		want   string
	}{
		{StatusStopped, "RUNTIME_HEALTH_STATUS_STOPPED"},
		{StatusStarting, "RUNTIME_HEALTH_STATUS_STARTING"},
		{StatusReady, "RUNTIME_HEALTH_STATUS_READY"},
		{StatusDegraded, "RUNTIME_HEALTH_STATUS_DEGRADED"},
		{StatusStopping, "RUNTIME_HEALTH_STATUS_STOPPING"},
		{StatusUnspecified, "RUNTIME_HEALTH_STATUS_UNSPECIFIED"},
		{Status(99), "RUNTIME_HEALTH_STATUS_UNSPECIFIED"},
	}
	for _, tt := range tests {
		if got := tt.status.String(); got != tt.want {
			t.Errorf("Status(%d).String() = %q, want %q", tt.status, got, tt.want)
		}
	}
}

func TestSubscribeReceivesInitialSnapshot(t *testing.T) {
	s := NewState()
	s.SetStatus(StatusReady, "ready")

	ch, cancel := s.Subscribe(4)
	defer cancel()

	select {
	case snap := <-ch:
		if snap.Status != StatusReady {
			t.Fatalf("initial snapshot status: got=%v want=READY", snap.Status)
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("no initial snapshot received")
	}
}

func TestSubscribeReceivesUpdates(t *testing.T) {
	s := NewState()
	ch, cancel := s.Subscribe(4)
	defer cancel()

	// Drain initial snapshot.
	<-ch

	s.SetStatus(StatusStarting, "booting")
	select {
	case snap := <-ch:
		if snap.Status != StatusStarting {
			t.Fatalf("update status: got=%v want=STARTING", snap.Status)
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("no update received")
	}
}

func TestSubscribeCancelStopsDelivery(t *testing.T) {
	s := NewState()
	ch, cancel := s.Subscribe(4)

	// Drain initial.
	<-ch

	cancel()
	// Channel should be closed after cancel.
	_, open := <-ch
	if open {
		t.Fatal("channel should be closed after cancel")
	}
}

func TestSubscribeSlowConsumerDropsOldest(t *testing.T) {
	s := NewState()
	// Buffer size 1 to trigger slow consumer path.
	ch, cancel := s.Subscribe(1)
	defer cancel()

	// Drain initial snapshot.
	<-ch

	// Send multiple updates quickly — slow consumer should get latest.
	for i := 0; i < 10; i++ {
		s.SetStatus(StatusDegraded, "pressure")
	}
	s.SetStatus(StatusReady, "recovered")

	var last Snapshot
	for {
		select {
		case snap := <-ch:
			last = snap
		default:
			goto done
		}
	}
done:
	if last.Status != StatusReady {
		t.Fatalf("slow consumer should receive latest: got=%v want=READY", last.Status)
	}
}

func TestStatusConstantsMatchProtoEnum(t *testing.T) {
	tests := []struct {
		name string
		got  Status
		want runtimev1.RuntimeHealthStatus
	}{
		{"UNSPECIFIED", StatusUnspecified, runtimev1.RuntimeHealthStatus_RUNTIME_HEALTH_STATUS_UNSPECIFIED},
		{"STOPPED", StatusStopped, runtimev1.RuntimeHealthStatus_RUNTIME_HEALTH_STATUS_STOPPED},
		{"STARTING", StatusStarting, runtimev1.RuntimeHealthStatus_RUNTIME_HEALTH_STATUS_STARTING},
		{"READY", StatusReady, runtimev1.RuntimeHealthStatus_RUNTIME_HEALTH_STATUS_READY},
		{"DEGRADED", StatusDegraded, runtimev1.RuntimeHealthStatus_RUNTIME_HEALTH_STATUS_DEGRADED},
		{"STOPPING", StatusStopping, runtimev1.RuntimeHealthStatus_RUNTIME_HEALTH_STATUS_STOPPING},
	}
	for _, tt := range tests {
		if int32(tt.got) != int32(tt.want) {
			t.Fatalf("%s status drifted: got=%d want=%d", tt.name, tt.got, tt.want)
		}
	}
}

func TestConcurrentAccess(t *testing.T) {
	s := NewState()
	var wg sync.WaitGroup

	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			s.SetStatus(StatusReady, "ready")
			s.SetActivity(1, 1, 1)
			s.SetResource(100, 200, 300)
			_ = s.Snapshot()
		}()
	}

	ch, cancel := s.Subscribe(4)
	defer cancel()
	wg.Wait()

	// Should not panic or race.
	_ = <-ch
}

func TestSubscribeSkipsZeroWatcherIDAfterWrap(t *testing.T) {
	s := NewState()
	s.nextID = ^uint64(0)

	ch, cancel := s.Subscribe(1)
	defer cancel()

	if _, exists := s.watchers[0]; exists {
		t.Fatal("watcher id 0 must remain unused after counter wrap")
	}
	_ = <-ch
}

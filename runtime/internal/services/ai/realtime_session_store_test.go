package ai

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestRealtimeSessionStoreReportsDroppedEvents(t *testing.T) {
	store := newRealtimeSessionStore()
	dropped := make([]*runtimev1.RealtimeEvent, 0, 1)
	store.setDropReporter(func(_ string, event *runtimev1.RealtimeEvent) {
		dropped = append(dropped, cloneRealtimeEvent(event))
	})

	record := store.create(&realtimeSessionRecord{
		sessionID: "rt-drop",
		traceID:   "trace-drop",
		events:    []*runtimev1.RealtimeEvent{},
	})
	if record == nil {
		t.Fatalf("expected session record")
	}
	_, ch, _, conflict := store.claimReader("rt-drop", 0)
	if conflict || ch == nil {
		t.Fatalf("expected reader claim without conflict")
	}
	defer store.releaseReader("rt-drop")

	for index := 0; index < 33; index += 1 {
		if _, ok := store.appendEvent("rt-drop", &runtimev1.RealtimeEvent{
			EventType: runtimev1.RealtimeEventType_REALTIME_EVENT_OPENED,
		}); !ok {
			t.Fatalf("expected append at index %d", index)
		}
	}

	if len(dropped) != 1 {
		t.Fatalf("expected exactly one dropped event report, got %d", len(dropped))
	}
	if got := dropped[0].GetSequence(); got != 33 {
		t.Fatalf("unexpected dropped event sequence: %d", got)
	}
}

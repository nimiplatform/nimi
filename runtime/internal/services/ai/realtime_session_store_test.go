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

func TestRealtimeSessionStoreCapsBacklog(t *testing.T) {
	store := newRealtimeSessionStore()
	record := store.create(&realtimeSessionRecord{
		sessionID: "rt-cap",
		traceID:   "trace-cap",
		events:    []*runtimev1.RealtimeEvent{},
	})
	if record == nil {
		t.Fatalf("expected session record")
	}

	totalEvents := maxRealtimeEventBacklog + 10
	for index := 0; index < totalEvents; index += 1 {
		event, ok := store.appendEvent("rt-cap", &runtimev1.RealtimeEvent{
			EventType: runtimev1.RealtimeEventType_REALTIME_EVENT_OPENED,
		})
		if !ok || event == nil {
			t.Fatalf("expected append at index %d", index)
		}
	}

	backlog, ch, _, conflict := store.claimReader("rt-cap", 0)
	if conflict || ch == nil {
		t.Fatalf("expected reader claim without conflict")
	}
	defer store.releaseReader("rt-cap")

	if len(backlog) != maxRealtimeEventBacklog {
		t.Fatalf("unexpected backlog length: got=%d want=%d", len(backlog), maxRealtimeEventBacklog)
	}
	if got, want := backlog[0].GetSequence(), uint64(totalEvents-maxRealtimeEventBacklog+1); got != want {
		t.Fatalf("unexpected first retained sequence: got=%d want=%d", got, want)
	}
	if got, want := backlog[len(backlog)-1].GetSequence(), uint64(totalEvents); got != want {
		t.Fatalf("unexpected last retained sequence: got=%d want=%d", got, want)
	}
}

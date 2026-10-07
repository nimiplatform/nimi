package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"testing"
)

func TestRealtimeSessionStoreKeepsIndependentSessionsAndRemovesExactlyOne(t *testing.T) {
	store := newRealtimeSessionStore()
	first := &realtimeSessionRecord{sessionID: "session-a"}
	second := &realtimeSessionRecord{sessionID: "session-b"}
	if !store.create(first) || !store.create(second) || store.create(&realtimeSessionRecord{sessionID: "session-a"}) {
		t.Fatal("session store did not enforce exact unique identity")
	}
	if got, ok := store.get("session-a"); !ok || got != first {
		t.Fatalf("first session = %+v found=%v", got, ok)
	}
	store.finish(first, &runtimev1.RealtimeControlStatus{RealtimeSessionId: "session-a", Generation: 1, Lifecycle: runtimev1.RealtimeLifecycle_REALTIME_LIFECYCLE_CLOSED})
	if _, ok := store.get("session-a"); ok {
		t.Fatal("removed session remains visible")
	}
	if got, ok := store.get("session-b"); !ok || got != second {
		t.Fatal("removing one session polluted another")
	}
}

func TestRealtimeSessionStoreReturnsSnapshotForShutdown(t *testing.T) {
	store := newRealtimeSessionStore()
	store.create(&realtimeSessionRecord{sessionID: "one"})
	store.create(&realtimeSessionRecord{sessionID: "two"})
	if got := store.all(); len(got) != 2 {
		t.Fatalf("shutdown snapshot length = %d", len(got))
	}
}

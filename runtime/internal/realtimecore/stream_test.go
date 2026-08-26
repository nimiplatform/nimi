package realtimecore

import (
	"errors"
	"testing"
)

func TestStreamIsolatesGenerationAndRejectsSlowConsumer(t *testing.T) {
	stream, err := NewStream[string](Config{
		RealtimeSessionID: "session-1",
		ChannelID:         "channel-1",
		AdapterKind:       "realm",
		Generation:        7,
		Capacity:          2,
		PressureAt:        1,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := stream.Publish(6, "stale"); !errors.Is(err, ErrStaleGeneration) {
		t.Fatalf("stale publish error = %v", err)
	}
	first, err := stream.Publish(7, "first")
	if err != nil || first.Backpressure != BackpressurePressured {
		t.Fatalf("first publish = %#v, %v", first, err)
	}
	if _, err := stream.Publish(7, "second"); err != nil {
		t.Fatal(err)
	}
	if result, err := stream.Publish(7, "overflow"); !errors.Is(err, ErrSlowConsumer) || result.Backpressure != BackpressureBlocked {
		t.Fatalf("overflow publish = %#v, %v", result, err)
	}
	if snapshot := stream.Snapshot(); snapshot.Lifecycle != LifecycleFailed || snapshot.TerminalReason != TerminalSlowConsumer {
		t.Fatalf("terminal snapshot = %#v", snapshot)
	}
	if err := stream.PublishTerminal(7, "slow-consumer-terminal", TerminalSlowConsumer); err != nil {
		t.Fatal(err)
	}
	reader, release, err := stream.ClaimReader()
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	values := make([]string, 0, 1)
	for value := range reader {
		values = append(values, value)
	}
	if len(values) != 1 || values[0] != "slow-consumer-terminal" {
		t.Fatalf("slow-consumer terminal delivery = %v", values)
	}
}

func TestStreamAllowsOnlyOneActiveReaderAndClosesIdempotently(t *testing.T) {
	stream, err := NewStream[int](Config{
		RealtimeSessionID: "session-1",
		ChannelID:         "channel-1",
		SubscriptionID:    "subscription-1",
		AdapterKind:       "realm",
		Generation:        1,
		Capacity:          4,
	})
	if err != nil {
		t.Fatal(err)
	}
	reader, release, err := stream.ClaimReader()
	if err != nil || reader == nil {
		t.Fatalf("claim reader = %v", err)
	}
	if _, _, err := stream.ClaimReader(); !errors.Is(err, ErrReaderConflict) {
		t.Fatalf("reader conflict = %v", err)
	}
	release()
	if _, _, err := stream.ClaimReader(); err != nil {
		t.Fatalf("reclaim reader = %v", err)
	}
	if err := stream.Close(1, TerminalRuntimeShutdown); err != nil {
		t.Fatal(err)
	}
	if err := stream.Close(1, TerminalRuntimeShutdown); err != nil {
		t.Fatal(err)
	}
	if snapshot := stream.Snapshot(); snapshot.Lifecycle != LifecycleClosed || snapshot.BufferedItems != 0 {
		t.Fatalf("closed snapshot = %#v", snapshot)
	}
}

func TestStreamPublishTerminalReleasesDataAndRetainsOnlyTerminal(t *testing.T) {
	stream, err := NewStream[string](Config{
		RealtimeSessionID: "session", ChannelID: "channel", AdapterKind: "test",
		Generation: 1, Capacity: 4, PressureAt: 3,
	})
	if err != nil {
		t.Fatal(err)
	}
	_, _ = stream.Publish(1, "business-data")
	if err := stream.PublishTerminal(1, "terminal-control", TerminalOwnerFailed); err != nil {
		t.Fatal(err)
	}
	reader, release, err := stream.ClaimReader()
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	values := make([]string, 0, 1)
	for value := range reader {
		values = append(values, value)
	}
	if len(values) != 1 || values[0] != "terminal-control" {
		t.Fatalf("terminal delivery = %v", values)
	}
}

package streamutil

import (
	"context"
	"sync"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type relayEvent struct {
	ID       int
	Terminal bool
}

func TestStreamBackpressureCloses(t *testing.T) {
	relay := NewRelay(RelayOptions[relayEvent]{
		Budget:              2,
		MaxConsecutiveDrops: 3,
		CloseErr:            status.Error(codes.ResourceExhausted, "slow consumer"),
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	gate := make(chan struct{})
	var mu sync.Mutex
	delivered := make([]relayEvent, 0, 4)
	done := make(chan error, 1)
	go func() {
		done <- relay.Run(ctx, func(event relayEvent) error {
			<-gate
			mu.Lock()
			delivered = append(delivered, event)
			mu.Unlock()
			return nil
		})
	}()

	for i := 0; i < 5; i++ {
		_ = relay.Enqueue(relayEvent{ID: i})
	}
	close(gate)

	select {
	case err := <-done:
		if status.Code(err) != codes.ResourceExhausted {
			t.Fatalf("expected resource exhausted, got %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("relay did not close on backpressure")
	}

	mu.Lock()
	defer mu.Unlock()
	if len(delivered) == 0 {
		t.Fatal("expected events to be delivered before closure")
	}
}

func TestStreamBackpressureRetainsTerminalEvent(t *testing.T) {
	relay := NewRelay(RelayOptions[relayEvent]{
		Budget:              2,
		MaxConsecutiveDrops: 3,
		CloseErr:            status.Error(codes.ResourceExhausted, "slow consumer"),
		IsTerminal: func(event relayEvent) bool {
			return event.Terminal
		},
	})

	if err := relay.Enqueue(relayEvent{ID: 1}); err != nil {
		t.Fatalf("enqueue 1: %v", err)
	}
	if err := relay.Enqueue(relayEvent{ID: 2}); err != nil {
		t.Fatalf("enqueue 2: %v", err)
	}
	if err := relay.Enqueue(relayEvent{ID: 3, Terminal: true}); err != nil {
		t.Fatalf("enqueue terminal: %v", err)
	}
	relay.Close()

	got := make([]relayEvent, 0, 2)
	err := relay.Run(context.Background(), func(event relayEvent) error {
		got = append(got, event)
		return nil
	})
	if err != nil {
		t.Fatalf("run relay: %v", err)
	}

	hasTerminal := false
	for _, event := range got {
		if event.Terminal {
			hasTerminal = true
			break
		}
	}
	if !hasTerminal {
		t.Fatal("expected terminal event to remain queued")
	}
}

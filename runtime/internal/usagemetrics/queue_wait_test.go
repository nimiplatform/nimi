package usagemetrics

import (
	"context"
	"testing"
)

func TestQueueWaitRecorderRoundtrip(t *testing.T) {
	ctx, recorder := WithQueueWaitRecorder(context.Background())
	if recorder == nil {
		t.Fatalf("recorder must not be nil")
	}
	if QueueWaitMS(ctx) != 0 {
		t.Fatalf("default queue wait should be zero")
	}

	SetQueueWaitMS(ctx, 42)
	if QueueWaitMS(ctx) != 42 {
		t.Fatalf("queue wait mismatch: got=%d want=42", QueueWaitMS(ctx))
	}

	md := QueueWaitTrailer(42)
	parsed, ok := ParseQueueWaitMD(md)
	if !ok {
		t.Fatalf("expected parse ok")
	}
	if parsed != 42 {
		t.Fatalf("parsed queue wait mismatch: got=%d want=42", parsed)
	}
}

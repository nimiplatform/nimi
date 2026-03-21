package usagemetrics

import (
	"context"
	"sync"
	"testing"

	"google.golang.org/grpc/metadata"
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

func TestQueueWaitRecorderEdgeCases(t *testing.T) {
	t.Run("negative values clamp to zero", func(t *testing.T) {
		ctx, _ := WithQueueWaitRecorder(context.Background())
		SetQueueWaitMS(ctx, -5)
		if got := QueueWaitMS(ctx); got != 0 {
			t.Fatalf("expected clamped queue wait, got=%d", got)
		}
	})

	t.Run("missing recorder is no-op", func(t *testing.T) {
		SetQueueWaitMS(context.Background(), 99)
		if got := QueueWaitMS(context.Background()); got != 0 {
			t.Fatalf("expected zero queue wait without recorder, got=%d", got)
		}
	})

	t.Run("parse malformed metadata", func(t *testing.T) {
		tests := []struct {
			name string
			md   metadata.MD
			want int64
			ok   bool
		}{
			{name: "nil", md: nil, want: 0, ok: false},
			{name: "empty", md: metadata.MD{}, want: 0, ok: false},
			{name: "blank", md: metadata.Pairs(queueWaitMetadataKey, " "), want: 0, ok: false},
			{name: "non-numeric", md: metadata.Pairs(queueWaitMetadataKey, "abc"), want: 0, ok: false},
			{name: "negative", md: metadata.Pairs(queueWaitMetadataKey, "-9"), want: 0, ok: true},
			{name: "multiple", md: metadata.MD{queueWaitMetadataKey: []string{"1", "7"}}, want: 7, ok: true},
		}
		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				got, ok := ParseQueueWaitMD(tt.md)
				if got != tt.want || ok != tt.ok {
					t.Fatalf("ParseQueueWaitMD() = (%d,%v), want (%d,%v)", got, ok, tt.want, tt.ok)
				}
			})
		}
	})
}

func TestQueueWaitRecorderConcurrentAccess(t *testing.T) {
	ctx, recorder := WithQueueWaitRecorder(context.Background())
	if recorder == nil {
		t.Fatal("recorder must not be nil")
	}

	var wg sync.WaitGroup
	for i := int64(0); i < 16; i++ {
		wg.Add(1)
		go func(value int64) {
			defer wg.Done()
			SetQueueWaitMS(ctx, value)
			_ = QueueWaitMS(ctx)
			_ = recorder.Value()
		}(i)
	}
	wg.Wait()
}

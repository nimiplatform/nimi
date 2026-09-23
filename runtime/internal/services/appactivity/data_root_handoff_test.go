package appactivity

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestRetentionStopsAtRootHandoffAndResumesOnlyAfterAbort(t *testing.T) {
	h := newHarness(t)
	if err := h.service.RunRetention(context.Background()); err != nil {
		t.Fatal(err)
	}
	// An already-running retention section must settle before handoff returns.
	h.service.retentionMu.Lock()
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	err := h.service.QuiesceDataRootContext(ctx)
	cancel()
	h.service.retentionMu.Unlock()
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("handoff crossed running retention instead of reaching its deadline: %v", err)
	}
	if err := h.service.RunRetention(context.Background()); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("retention after quiesce: %v", err)
	}
	h.service.ResumeDataRootAfterAbort()
	if err := h.service.RunRetention(context.Background()); err != nil {
		t.Fatalf("retention after abort: %v", err)
	}
	if err := h.service.QuiesceDataRootContext(context.Background()); err != nil {
		t.Fatalf("handoff after retention settled: %v", err)
	}
}

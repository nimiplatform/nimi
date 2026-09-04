package nimiappinstall

import (
	"context"
	"testing"
)

func TestInstallWorkerCancellationReasonIsFirstWriterWins(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	worker := &installWorker{cancel: cancel}
	worker.requestCancel("first-reason")
	worker.requestCancel("second-reason")
	if ctx.Err() != context.Canceled {
		t.Fatalf("worker context = %v", ctx.Err())
	}
	worker.mu.Lock()
	reason := worker.reason
	worker.mu.Unlock()
	if reason != "first-reason" {
		t.Fatalf("cancellation reason = %q", reason)
	}
}

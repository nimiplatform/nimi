package runtimeagent

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestDataRootHandoffRespectsContextWhileOwnerWorkDoesNotDrain(t *testing.T) {
	service := &Service{}
	service.chatAsyncWG.Add(1)
	defer service.chatAsyncWG.Done()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if err := service.QuiesceDataRootContext(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("root handoff wait error = %v, want deadline exceeded", err)
	}
}

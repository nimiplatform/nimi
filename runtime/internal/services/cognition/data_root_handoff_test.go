package cognition

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestDataRootHandoffRespectsContextWhileSourceWorkDoesNotDrain(t *testing.T) {
	service := &Service{}
	service.agentSourceWG.Add(1)
	defer service.agentSourceWG.Done()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if err := service.QuiesceDataRootContext(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("root handoff wait error = %v, want deadline exceeded", err)
	}
}

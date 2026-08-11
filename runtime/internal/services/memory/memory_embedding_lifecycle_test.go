package memory

import (
	"context"
	"errors"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
)

func TestMemoryEmbeddingLifecycleCloseCancelsInflightRejectsLateAdmissionAndIsIdempotent(t *testing.T) {
	svc, err := New(nil, config.Config{LocalStatePath: filepath.Join(t.TempDir(), "local-state.json")})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	finishExecutor := make(chan struct{})
	var finishOnce sync.Once
	t.Cleanup(func() {
		finishOnce.Do(func() { close(finishExecutor) })
		_ = svc.Close()
	})

	profile := &runtimev1.MemoryEmbeddingProfile{Dimension: 2}
	executorEntered := make(chan struct{})
	executorCanceled := make(chan struct{})
	var executorCalls atomic.Int32
	svc.SetRuntimeEmbeddingVectorExecutor(func(ctx context.Context, _ *runtimev1.MemoryEmbeddingProfile, inputs []string) ([][]float64, error) {
		call := executorCalls.Add(1)
		if call > 1 {
			vectors := make([][]float64, len(inputs))
			for index := range vectors {
				vectors[index] = []float64{1, 0}
			}
			return vectors, nil
		}
		close(executorEntered)
		select {
		case <-ctx.Done():
			close(executorCanceled)
			<-finishExecutor
			return nil, ctx.Err()
		case <-finishExecutor:
			return [][]float64{{1, 0}}, nil
		}
	})

	embeddingResult := make(chan error, 1)
	go func() {
		_, callErr := svc.embeddingVectors(context.Background(), profile, []string{"first"})
		embeddingResult <- callErr
	}()
	select {
	case <-executorEntered:
	case <-time.After(time.Second):
		t.Fatal("embedding executor did not start")
	}

	closeResults := make(chan error, 2)
	go func() { closeResults <- svc.Close() }()
	go func() { closeResults <- svc.Close() }()
	select {
	case <-executorCanceled:
	case <-time.After(time.Second):
		finishOnce.Do(func() { close(finishExecutor) })
		t.Fatal("Close did not cancel the in-flight embedding executor")
	}
	select {
	case closeErr := <-closeResults:
		finishOnce.Do(func() { close(finishExecutor) })
		t.Fatalf("Close returned before the admitted executor finished: %v", closeErr)
	case <-time.After(50 * time.Millisecond):
	}

	_, lateErr := svc.embeddingVectors(context.Background(), profile, []string{"late"})
	if !errors.Is(lateErr, context.Canceled) {
		t.Fatalf("late embedding admission error = %v, want context.Canceled", lateErr)
	}
	if calls := executorCalls.Load(); calls != 1 {
		t.Fatalf("embedding executor calls = %d, want late admission rejected before executor", calls)
	}

	finishOnce.Do(func() { close(finishExecutor) })
	if callErr := <-embeddingResult; !errors.Is(callErr, context.Canceled) {
		t.Fatalf("in-flight embedding error = %v, want context.Canceled", callErr)
	}
	for index := 0; index < 2; index++ {
		select {
		case closeErr := <-closeResults:
			if closeErr != nil {
				t.Fatalf("Close[%d]: %v", index, closeErr)
			}
		case <-time.After(time.Second):
			t.Fatalf("Close[%d] did not complete", index)
		}
	}
	if closeErr := svc.Close(); closeErr != nil {
		t.Fatalf("Close(repeated): %v", closeErr)
	}
}

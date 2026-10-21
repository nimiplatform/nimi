package cognitionmemory

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
)

func TestIndexOnlyRecallDoesNotStartModelWorkAndKeepsOwnerBoundaries(t *testing.T) {
	f := newEmbeddingRecoveryFixture(t, "recall-budget")
	modelCalls := 0
	facade := f.facade(nil)
	facade.capabilities = func(context.Context, Binding) (memoryv1.CapabilitySnapshot, memoryv1.EmbeddingPort, error) {
		modelCalls++
		return memoryv1.CapabilitySnapshot{}, nil, errors.New("embedding is cold")
	}
	ctx, cancel := context.WithTimeout(f.ctx, 750*time.Millisecond)
	defer cancel()
	intent := RecallIntent{NoModelWork: true, LocalAgentRef: f.binding.LocalAgentRef, Query: "jasmine", Limit: 4}
	got, err := facade.Recall(ctx, intent)
	if err != nil || got.Outcome != memoryv1.OutcomeReady || len(got.Hits) != 1 || modelCalls != 0 {
		t.Fatalf("index-only Recall: %+v, err=%v, model calls=%d", got, err, modelCalls)
	}
	qualified, err := facade.QualifyReadSet(f.ctx, f.binding.LocalAgentRef, got.ReadSet)
	if err != nil || !qualified[got.Hits[0].MemoryRef] {
		t.Fatalf("Recall bypassed qualification: %+v %v", qualified, err)
	}

	// Ordinary Recall still invokes its selected capability provider. A failed
	// operation is never retried as FTS under the same operation identity.
	intent.NoModelWork = false
	if result, err := facade.Recall(f.ctx, intent); err == nil || len(result.Hits) != 0 || modelCalls != 1 {
		t.Fatalf("model failure silently switched pipelines: %+v %v calls=%d", result, err, modelCalls)
	}
	intent.NoModelWork = true
	canceled, stop := context.WithCancel(f.ctx)
	stop()
	if result, err := facade.Recall(canceled, intent); err == nil || len(result.Hits) != 0 {
		t.Fatalf("canceled Recall returned content: %+v %v", result, err)
	}
	facade.authorize = func(context.Context, Binding) error { return errors.New("binding revoked") }
	if result, err := facade.Recall(f.ctx, intent); err == nil || len(result.Hits) != 0 {
		t.Fatalf("index-only Recall bypassed authorization: %+v %v", result, err)
	}
}

package ai

import (
	"math"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestQwen3EmbeddingRequiresUnitVectorsBeforeSuccess(t *testing.T) {
	valid := []*runtimev1.EmbeddingVector{{Values: []float64{0.6, 0.8}}, {Values: []float64{1, 0}}}
	if !qwen3EmbeddingVectorsNormalized(valid) {
		t.Fatal("normalized Qwen3 vectors rejected")
	}
	for _, vectors := range [][]*runtimev1.EmbeddingVector{
		{{Values: []float64{0, 0}}},
		{{Values: []float64{0.6, 0.79}}},
		{{Values: []float64{math.NaN(), 1}}},
		{{Values: []float64{math.Inf(1), 0}}},
	} {
		if qwen3EmbeddingVectorsNormalized(vectors) {
			t.Fatalf("non-normalized Qwen3 vector admitted: %+v", vectors)
		}
	}
}

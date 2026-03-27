package localservice

import "testing"

func TestRequiresNPUNormalizesInput(t *testing.T) {
	if !requiresNPU(" NPU-runtime ") {
		t.Fatal("expected requiresNPU to match uppercase normalized input")
	}
	if requiresNPU("llama") {
		t.Fatal("expected non-NPU engine to remain false")
	}
}

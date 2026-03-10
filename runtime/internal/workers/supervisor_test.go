package workers

import (
	"testing"
	"time"
)

func TestNormalizeWorkerName(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"ai", "ai"},
		{"model", "model"},
		{"workflow", "workflow"},
		{"local", "local"},
		{"invalid", ""},
		{"", ""},
	}
	for _, tt := range tests {
		if got := normalizeWorkerName(tt.input); got != tt.want {
			t.Errorf("normalizeWorkerName(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestMarkStateCallsHandler(t *testing.T) {
	var calledName string
	var calledRunning bool

	sv := New(nil, "", func(name string, running bool, err error) {
		calledName = name
		calledRunning = running
	})

	sv.markState("ai", true, nil)
	if calledName != "ai" || !calledRunning {
		t.Fatalf("handler: name=%q running=%v", calledName, calledRunning)
	}
}

func TestMarkStateIgnoresInvalidName(t *testing.T) {
	called := false
	sv := New(nil, "", func(name string, running bool, err error) {
		called = true
	})
	sv.markState("invalid", true, nil)
	if called {
		t.Fatal("handler should not be called for invalid worker name")
	}
}

func TestAllRunning(t *testing.T) {
	sv := New(nil, "", nil)
	sv.markState("ai", true, nil)
	sv.markState("model", true, nil)

	if !sv.AllRunning([]string{"ai", "model"}) {
		t.Fatal("should be all running")
	}
	if sv.AllRunning([]string{"ai", "model", "workflow"}) {
		t.Fatal("workflow is not running")
	}
}

func TestAllRunningEmptyNames(t *testing.T) {
	sv := New(nil, "", nil)
	if !sv.AllRunning(nil) {
		t.Fatal("empty names should return true")
	}
}

func TestBackoffWithJitter(t *testing.T) {
	base := 2 * time.Second
	for i := 0; i < 20; i++ {
		d := backoffWithJitter(base)
		if d < base || d > base+500*time.Millisecond {
			t.Fatalf("backoff out of range: %v", d)
		}
	}
}

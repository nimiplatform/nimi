package workeripc

import (
	"strings"
	"testing"
)

func TestSocketPathValidRoles(t *testing.T) {
	roles := []string{"ai", "model", "workflow", "local"}
	for _, role := range roles {
		path, err := SocketPath(role)
		if err != nil {
			t.Fatalf("SocketPath(%q): %v", role, err)
		}
		if !strings.HasSuffix(path, role+socketExtension) {
			t.Fatalf("SocketPath(%q) = %q, should end with %s", role, path, role+socketExtension)
		}
	}
}

func TestSocketPathInvalidRole(t *testing.T) {
	_, err := SocketPath("invalid")
	if err == nil {
		t.Fatal("should fail on invalid role")
	}
}

func TestDialTargetValidRole(t *testing.T) {
	target, err := DialTarget("ai")
	if err != nil {
		t.Fatalf("DialTarget: %v", err)
	}
	if !strings.HasPrefix(target, "unix://") {
		t.Fatalf("DialTarget should start with unix://: got=%q", target)
	}
	if !strings.Contains(target, "ai.sock") {
		t.Fatalf("DialTarget should contain ai.sock: got=%q", target)
	}
}

func TestDialTargetInvalidRole(t *testing.T) {
	_, err := DialTarget("invalid")
	if err == nil {
		t.Fatal("should fail on invalid role")
	}
}

func TestNormalizeRole(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"ai", "ai"},
		{"model", "model"},
		{"workflow", "workflow"},
		{"local", "local"},
		{"AI", "ai"},
		{" ai ", "ai"},
		{"invalid", ""},
		{"", ""},
	}
	for _, tt := range tests {
		if got := normalizeRole(tt.input); got != tt.want {
			t.Errorf("normalizeRole(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestWorkerDir(t *testing.T) {
	dir := workerDir()
	if dir == "" {
		t.Fatal("workerDir should not be empty")
	}
}

func TestPrepareSocketValidRole(t *testing.T) {
	path, err := PrepareSocket("ai")
	if err != nil {
		t.Fatalf("PrepareSocket: %v", err)
	}
	if !strings.Contains(path, "ai.sock") {
		t.Fatalf("PrepareSocket should return path with ai.sock: got=%q", path)
	}
}

func TestPrepareSocketInvalidRole(t *testing.T) {
	_, err := PrepareSocket("invalid")
	if err == nil {
		t.Fatal("should fail on invalid role")
	}
}

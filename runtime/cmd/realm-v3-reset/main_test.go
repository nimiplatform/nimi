package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestRunRequiresExplicitDataRoot(t *testing.T) {
	t.Parallel()
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	if code := run([]string{"--dry-run"}, &stdout, &stderr); code != 2 {
		t.Fatalf("run code = %d, want 2", code)
	}
	if stdout.Len() != 0 || !strings.Contains(stderr.String(), "requires --data-root") {
		t.Fatalf("unexpected output stdout=%q stderr=%q", stdout.String(), stderr.String())
	}
}

func TestRunRejectsPositionalArguments(t *testing.T) {
	t.Parallel()
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	if code := run([]string{"--data-root", "/tmp/nimi-reset-test", "extra"}, &stdout, &stderr); code != 2 {
		t.Fatalf("run code = %d, want 2", code)
	}
	if !strings.Contains(stderr.String(), "does not accept positional arguments") {
		t.Fatalf("unexpected stderr=%q", stderr.String())
	}
}

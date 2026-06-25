package main

import (
	"strings"
	"testing"
)

func TestResolveBinaryRejectsDisallowedName(t *testing.T) {
	if _, err := resolveBinary("python3"); err == nil {
		t.Fatal("expected disallowed binary error")
	}
}

func TestLimitedBufferTruncatesOutput(t *testing.T) {
	buffer := &limitedBuffer{limit: 8}
	if _, err := buffer.Write([]byte("1234567890")); err != nil {
		t.Fatalf("Write: %v", err)
	}
	got := buffer.String()
	if !strings.Contains(got, "...(truncated)") {
		t.Fatalf("expected truncated suffix, got %q", got)
	}
	if !strings.HasPrefix(got, "12345678") {
		t.Fatalf("expected preserved prefix, got %q", got)
	}
}

func TestGoTestCollectionArgsRunsPackagesSerially(t *testing.T) {
	args := goTestCollectionArgs()
	if !containsArg(args, "-p=1") {
		t.Fatalf("expected runtime-compliance test collection to run packages serially, got %v", args)
	}
	if !containsArg(args, "-parallel=1") {
		t.Fatalf("expected runtime-compliance test collection to run parallel tests serially, got %v", args)
	}
}

func containsArg(args []string, target string) bool {
	for _, arg := range args {
		if arg == target {
			return true
		}
	}
	return false
}

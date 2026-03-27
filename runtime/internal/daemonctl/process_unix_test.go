//go:build !windows

package daemonctl

import (
	"os"
	"testing"
)

func TestProcessMatchesExecutable(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatalf("resolve executable: %v", err)
	}
	if !processMatchesExecutable(os.Getpid(), executable) {
		t.Fatal("expected current process executable to match")
	}
	if processMatchesExecutable(os.Getpid(), executable+".mismatch") {
		t.Fatal("expected mismatched executable to fail")
	}
}

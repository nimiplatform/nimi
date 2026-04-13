//go:build windows

package daemonctl

import (
	"os"
	"testing"
)

func TestDefaultProcessAliveReportsCurrentProcess(t *testing.T) {
	if !defaultProcessAlive(os.Getpid()) {
		t.Fatal("expected current process to be reported as alive")
	}
}

func TestDefaultProcessAliveRejectsInvalidPID(t *testing.T) {
	if defaultProcessAlive(-1) {
		t.Fatal("expected invalid pid to be reported as not alive")
	}
}

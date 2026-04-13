//go:build windows

package main

import (
	"os"
	"testing"
)

func TestConfigWriteLockProcessAliveReportsCurrentProcess(t *testing.T) {
	if !configWriteLockProcessAlive(os.Getpid()) {
		t.Fatal("expected current process to be reported as alive")
	}
}

func TestConfigWriteLockProcessAliveRejectsInvalidPID(t *testing.T) {
	if configWriteLockProcessAlive(-1) {
		t.Fatal("expected invalid pid to be reported as not alive")
	}
}

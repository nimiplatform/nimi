//go:build !windows && !darwin

package main

import (
	"context"
	"fmt"
	"net"
	"os"
	"os/exec"
)

func validateSourceSupervisorPrincipal() error {
	return fmt.Errorf("source Runtime supervisor is unavailable on this platform")
}

func acquireSourceRuntimeOwnerLock(_ string) (net.Listener, error) {
	return nil, fmt.Errorf("source Runtime supervisor is unavailable on this platform")
}

func dialSourceRuntimeOwner(_ context.Context, _ string) (net.Conn, error) {
	return nil, errSourceRuntimeNotRunning
}

func requestRuntimeStop(process *os.Process) error {
	return process.Kill()
}

func configureRuntimeCommand(_ *exec.Cmd) {}

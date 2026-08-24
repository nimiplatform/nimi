//go:build !windows && !darwin

package main

import (
	"fmt"
	"io"
	"os"
	"os/exec"
)

func validateSourceSupervisorPrincipal() error {
	return fmt.Errorf("source Runtime supervisor is unavailable on this platform")
}

func acquireSourceRuntimeOwnerLock(_ string) (io.Closer, error) {
	return nil, fmt.Errorf("source Runtime supervisor is unavailable on this platform")
}

func requestRuntimeStop(process *os.Process) error {
	return process.Kill()
}

func configureRuntimeCommand(_ *exec.Cmd) {}

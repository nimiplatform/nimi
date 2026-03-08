//go:build windows

package engine

import (
	"os"
	"os/exec"
	"syscall"
)

func setSupervisorProcessGroup(_ *exec.Cmd) {}

func signalSupervisorProcess(pid int, sig syscall.Signal) error {
	process, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	if sig == syscall.SIGKILL {
		return process.Kill()
	}
	return process.Signal(sig)
}

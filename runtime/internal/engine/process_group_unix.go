//go:build !windows

package engine

import (
	"os/exec"
	"syscall"
)

func setSupervisorProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func signalSupervisorProcess(pid int, sig syscall.Signal) error {
	return syscall.Kill(-pid, sig)
}

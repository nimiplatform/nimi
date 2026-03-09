//go:build !windows

package daemonctl

import (
	"os/exec"
	"syscall"
)

func detachCommand(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func defaultProcessAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	err := syscall.Kill(pid, syscall.Signal(0))
	return err == nil || err == syscall.EPERM
}

func defaultStopProcess(pid int, force bool) error {
	if pid <= 0 {
		return nil
	}
	sig := syscall.SIGTERM
	if force {
		sig = syscall.SIGKILL
	}
	if err := syscall.Kill(-pid, sig); err == syscall.ESRCH {
		return nil
	} else if err == syscall.EINVAL || err == syscall.EPERM {
		return syscall.Kill(pid, sig)
	} else {
		return err
	}
}

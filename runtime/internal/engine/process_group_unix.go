//go:build !windows

package engine

import (
	"os/exec"
	"syscall"
)

type supervisorProcessLifecycle struct {
	processGroupID int
}

func setSupervisorProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func signalSupervisorProcess(pid int, sig syscall.Signal) error {
	return syscall.Kill(-pid, sig)
}

func signalSupervisorProcessDirect(pid int, sig syscall.Signal) error {
	return syscall.Kill(pid, sig)
}

func bindSupervisorProcessLifecycle(cmd *exec.Cmd) (*supervisorProcessLifecycle, error) {
	if cmd == nil || cmd.Process == nil || cmd.Process.Pid <= 0 {
		return nil, nil
	}
	return &supervisorProcessLifecycle{processGroupID: cmd.Process.Pid}, nil
}

func supervisorProcessLifecycleSupportsGracefulTermination(_ *supervisorProcessLifecycle) bool {
	return true
}

func signalSupervisorProcessLifecycle(lifecycle *supervisorProcessLifecycle, sig syscall.Signal) error {
	if lifecycle == nil || lifecycle.processGroupID <= 0 {
		return nil
	}
	err := syscall.Kill(-lifecycle.processGroupID, sig)
	if err == syscall.ESRCH {
		return nil
	}
	return err
}

func supervisorProcessLifecycleExited(lifecycle *supervisorProcessLifecycle) (bool, error) {
	if lifecycle == nil || lifecycle.processGroupID <= 0 {
		return true, nil
	}
	err := syscall.Kill(-lifecycle.processGroupID, 0)
	switch err {
	case nil, syscall.EPERM:
		return false, nil
	case syscall.ESRCH:
		return true, nil
	default:
		return false, err
	}
}

func releaseSupervisorProcessLifecycle(_ *supervisorProcessLifecycle) error {
	return nil
}

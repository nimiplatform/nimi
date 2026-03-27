//go:build !windows

package daemonctl

import (
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
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

func defaultStopProcess(pid int, expectedExecutable string, force bool) error {
	if pid <= 0 {
		return nil
	}
	sig := syscall.SIGTERM
	if force {
		sig = syscall.SIGKILL
	}
	killGroup := processMatchesExecutable(pid, expectedExecutable)
	if killGroup {
		err := syscall.Kill(-pid, sig)
		if err == nil || err == syscall.ESRCH {
			return nil
		}
		if err != syscall.EINVAL && err != syscall.EPERM {
			return err
		}
	}

	err := syscall.Kill(pid, sig)
	if err == syscall.ESRCH {
		return nil
	}
	return err
}

func processMatchesExecutable(pid int, expectedExecutable string) bool {
	expectedExecutable = strings.TrimSpace(expectedExecutable)
	if pid <= 0 || expectedExecutable == "" {
		return false
	}

	output, err := exec.Command("ps", "-p", strconvPID(pid), "-o", "command=").Output()
	if err != nil {
		return false
	}
	commandLine := strings.TrimSpace(string(output))
	if commandLine == "" {
		return false
	}
	fields := strings.Fields(commandLine)
	if len(fields) == 0 {
		return false
	}
	actualExecutable := strings.TrimSpace(fields[0])
	if actualExecutable == "" {
		return false
	}
	if actualExecutable == expectedExecutable {
		return true
	}
	return filepath.Base(actualExecutable) == filepath.Base(expectedExecutable)
}

func strconvPID(pid int) string {
	return strconv.Itoa(pid)
}

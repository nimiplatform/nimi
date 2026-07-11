//go:build !windows

package daemonctl

import (
	"fmt"
	"syscall"
)

func defaultProcessAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	err := syscall.Kill(pid, syscall.Signal(0))
	return err == nil || err == syscall.EPERM
}

func defaultStopProcess(int, string, bool) error {
	return fmt.Errorf("direct Runtime process termination is forbidden; use the protected Runtime service")
}

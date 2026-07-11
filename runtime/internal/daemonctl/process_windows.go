//go:build windows

package daemonctl

import (
	"fmt"

	"golang.org/x/sys/windows"
)

const windowsProcessStillActive = 259

func defaultProcessAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	handle, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		return false
	}
	defer func() {
		_ = windows.CloseHandle(handle)
	}()

	var exitCode uint32
	if err := windows.GetExitCodeProcess(handle, &exitCode); err != nil {
		return false
	}
	return exitCode == windowsProcessStillActive
}

func defaultStopProcess(int, string, bool) error {
	return fmt.Errorf("direct Runtime process termination is forbidden on Windows; use the protected NimiRuntime service")
}

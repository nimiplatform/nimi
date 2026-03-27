//go:build windows

package entrypoint

import (
	"errors"

	"golang.org/x/sys/windows"
)

const windowsStillActiveExitCode = 259

func runtimeProcessAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	process, err := windows.OpenProcess(windows.SYNCHRONIZE|windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		if errors.Is(err, windows.ERROR_ACCESS_DENIED) {
			return true
		}
		return false
	}
	defer windows.CloseHandle(process)

	var exitCode uint32
	if err := windows.GetExitCodeProcess(process, &exitCode); err != nil {
		return false
	}
	return exitCode == windowsStillActiveExitCode
}

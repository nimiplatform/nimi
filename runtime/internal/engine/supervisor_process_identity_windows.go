//go:build windows

package engine

import (
	"fmt"
	"strings"

	"golang.org/x/sys/windows"
)

const windowsStillActive = 259

func supervisorProcessAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	handle, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		return false
	}
	defer windows.CloseHandle(handle)

	var code uint32
	if err := windows.GetExitCodeProcess(handle, &code); err != nil {
		return false
	}
	return code == windowsStillActive
}

func supervisorProcessMatchesExpectedPath(pid int, expectedPath string) (bool, bool) {
	expected := canonicalSupervisorProcessPath(expectedPath)
	if expected == "" || pid <= 0 {
		return false, false
	}

	handle, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		return false, false
	}
	defer windows.CloseHandle(handle)

	buffer := make([]uint16, windows.MAX_PATH)
	size := uint32(len(buffer))
	if err := windows.QueryFullProcessImageName(handle, 0, &buffer[0], &size); err != nil {
		return false, false
	}
	actual := canonicalSupervisorProcessPath(windows.UTF16ToString(buffer[:size]))
	if actual == "" {
		return false, false
	}
	return strings.EqualFold(actual, expected), true
}

func supervisorProcessIdentityValidationDetail(pid int, expectedPath string) string {
	return fmt.Sprintf("pid=%d expected=%s", pid, canonicalSupervisorProcessPath(expectedPath))
}

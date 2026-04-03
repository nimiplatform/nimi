//go:build windows

package engine

import "golang.org/x/sys/windows"

func resolveSupervisorExpectedExecutablePath(pid int, fallbackPath string) string {
	if pid > 0 {
		handle, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
		if err == nil {
			defer windows.CloseHandle(handle)
			buffer := make([]uint16, windows.MAX_PATH)
			size := uint32(len(buffer))
			if err := windows.QueryFullProcessImageName(handle, 0, &buffer[0], &size); err == nil {
				if actual := canonicalSupervisorProcessPath(windows.UTF16ToString(buffer[:size])); actual != "" {
					return actual
				}
			}
		}
	}
	return canonicalSupervisorProcessPath(fallbackPath)
}

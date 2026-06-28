//go:build windows

package daemonctl

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"

	"golang.org/x/sys/windows"
)

const windowsProcessStillActive = 259

func detachCommand(cmd *exec.Cmd) {
	// Give the background daemon its own HIDDEN console rather than detaching
	// it from any console (DETACHED_PROCESS). A detached daemon has no console,
	// so every console descendant it spawns - local engines and their Python /
	// stable-diffusion.cpp workers - allocates a fresh visible console that
	// Windows surfaces as a flashing Terminal tab. With a hidden console here,
	// all descendants inherit it and none allocate a visible window.
	// CREATE_NEW_CONSOLE keeps the daemon independent of the launching terminal
	// so it still survives that terminal closing.
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: windows.CREATE_NEW_PROCESS_GROUP | windows.CREATE_NEW_CONSOLE,
	}
}

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

func defaultStopProcess(pid int, expectedExecutable string, force bool) error {
	if pid <= 0 {
		return nil
	}
	matches, verified, actualExecutable := processMatchesExecutable(pid, expectedExecutable)
	if !verified {
		if strings.TrimSpace(expectedExecutable) == "" {
			return fmt.Errorf("refusing to stop process %d without expected executable identity", pid)
		}
		return fmt.Errorf("refusing to stop process %d because executable identity could not be verified against %q", pid, expectedExecutable)
	}
	if !matches {
		return fmt.Errorf("refusing to stop process %d because executable %q does not match %q", pid, actualExecutable, expectedExecutable)
	}
	if !force {
		return fmt.Errorf("runtime process %d requires --force on Windows because graceful process-group termination is unavailable", pid)
	}
	process, err := os.FindProcess(pid)
	if err != nil {
		return nil
	}
	return process.Kill()
}

func processMatchesExecutable(pid int, expectedExecutable string) (bool, bool, string) {
	expected := canonicalExecutablePath(expectedExecutable)
	if pid <= 0 || expected == "" {
		return false, false, ""
	}

	handle, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		return false, false, ""
	}
	defer func() {
		_ = windows.CloseHandle(handle)
	}()

	buffer := make([]uint16, windows.MAX_PATH)
	size := uint32(len(buffer))
	if err := windows.QueryFullProcessImageName(handle, 0, &buffer[0], &size); err != nil {
		return false, false, ""
	}
	actual := canonicalExecutablePath(windows.UTF16ToString(buffer[:size]))
	if actual == "" {
		return false, false, ""
	}
	return windowsExecutableIdentityMatches(actual, expected), true, actual
}

func windowsExecutableIdentityMatches(actual string, expected string) bool {
	if strings.EqualFold(actual, expected) {
		return true
	}
	return strings.EqualFold(actual, canonicalExecutablePath(expected+"~"))
}

func canonicalExecutablePath(path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return ""
	}
	return filepath.Clean(path)
}

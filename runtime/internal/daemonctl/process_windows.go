//go:build windows

package daemonctl

import (
	"os"
	"os/exec"
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
	defer windows.CloseHandle(handle)

	var exitCode uint32
	if err := windows.GetExitCodeProcess(handle, &exitCode); err != nil {
		return false
	}
	return exitCode == windowsProcessStillActive
}

func defaultStopProcess(pid int, _ string, _ bool) error {
	if pid <= 0 {
		return nil
	}
	process, err := os.FindProcess(pid)
	if err != nil {
		return nil
	}
	return process.Kill()
}

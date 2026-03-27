//go:build linux

package engine

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

func supervisorProcessAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	return syscall.Kill(pid, syscall.Signal(0)) == nil
}

func supervisorProcessMatchesExpectedPath(pid int, expectedPath string) (bool, bool) {
	expected := canonicalSupervisorProcessPath(expectedPath)
	if expected == "" || pid <= 0 {
		return false, false
	}

	validated := false

	exePath, err := os.Readlink(filepath.Join("/proc", strconv.Itoa(pid), "exe"))
	if err == nil {
		validated = true
		if canonicalSupervisorProcessPath(exePath) == expected {
			return true, true
		}
	}

	cmdlineBytes, err := os.ReadFile(filepath.Join("/proc", strconv.Itoa(pid), "cmdline"))
	if err == nil {
		validated = true
		for _, part := range strings.Split(string(cmdlineBytes), "\x00") {
			if canonicalSupervisorProcessPath(part) == expected {
				return true, true
			}
		}
	}

	return false, validated
}

func supervisorProcessIdentityValidationDetail(pid int, expectedPath string) string {
	return fmt.Sprintf("pid=%d expected=%s", pid, canonicalSupervisorProcessPath(expectedPath))
}

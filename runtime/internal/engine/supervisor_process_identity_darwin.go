//go:build darwin

package engine

import (
	"fmt"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

func supervisorProcessAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	if syscall.Kill(pid, syscall.Signal(0)) != nil {
		return false
	}
	output, err := exec.Command("ps", "-p", strconv.Itoa(pid), "-o", "stat=").Output()
	if err != nil {
		return true
	}
	stat := strings.TrimSpace(string(output))
	return !strings.Contains(stat, "Z")
}

func supervisorProcessMatchesExpectedPath(pid int, expectedPath string) (bool, bool) {
	expected := canonicalSupervisorProcessPath(expectedPath)
	if expected == "" || pid <= 0 {
		return false, false
	}

	output, err := exec.Command("ps", "-p", strconv.Itoa(pid), "-o", "command=").Output()
	if err != nil {
		return false, false
	}
	commandLine := strings.TrimSpace(string(output))
	if commandLine == "" {
		return false, false
	}
	for _, part := range strings.Fields(commandLine) {
		if canonicalSupervisorProcessPath(part) == expected {
			return true, true
		}
	}
	return false, true
}

func supervisorProcessIdentityValidationDetail(pid int, expectedPath string) string {
	return fmt.Sprintf("pid=%d expected=%s", pid, canonicalSupervisorProcessPath(expectedPath))
}

func observedSupervisorExecutablePath(pid int) string {
	if pid <= 0 {
		return ""
	}
	output, err := exec.Command("ps", "-p", strconv.Itoa(pid), "-o", "command=").Output()
	if err != nil {
		return ""
	}
	commandLine := strings.TrimSpace(string(output))
	if commandLine == "" {
		return ""
	}
	parts := strings.Fields(commandLine)
	if len(parts) == 0 {
		return ""
	}
	return canonicalSupervisorProcessPath(parts[0])
}

func shouldRetryObservedExecutablePath(actualPath string, fallbackPath string) bool {
	actualBase := strings.ToLower(filepath.Base(strings.TrimSpace(actualPath)))
	if actualBase == "" {
		return false
	}
	switch strings.ToLower(filepath.Ext(strings.TrimSpace(fallbackPath))) {
	case ".sh", ".bash", ".zsh":
	default:
		return false
	}
	switch actualBase {
	case "sh", "bash", "zsh", "dash", "env":
		return true
	default:
		return false
	}
}

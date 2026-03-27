//go:build darwin

package engine

import (
	"fmt"
	"os/exec"
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

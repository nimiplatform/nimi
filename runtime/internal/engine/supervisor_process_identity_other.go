//go:build !linux && !darwin && !windows

package engine

import "fmt"

func supervisorProcessAlive(pid int) bool {
	return pid > 0
}

func supervisorProcessMatchesExpectedPath(pid int, expectedPath string) (bool, bool) {
	return false, false
}

func supervisorProcessIdentityValidationDetail(pid int, expectedPath string) string {
	return fmt.Sprintf("pid=%d expected=%s", pid, canonicalSupervisorProcessPath(expectedPath))
}

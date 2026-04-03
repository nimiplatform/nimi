//go:build darwin

package engine

import (
	"time"
)

func resolveSupervisorExpectedExecutablePath(pid int, fallbackPath string) string {
	if pid > 0 {
		deadline := time.Now().Add(250 * time.Millisecond)
		for {
			if actual := observedSupervisorExecutablePath(pid); actual != "" {
				if !shouldRetryObservedExecutablePath(actual, fallbackPath) || time.Now().After(deadline) {
					return actual
				}
			}
			if time.Now().After(deadline) {
				break
			}
			time.Sleep(25 * time.Millisecond)
		}
	}
	return canonicalSupervisorProcessPath(fallbackPath)
}

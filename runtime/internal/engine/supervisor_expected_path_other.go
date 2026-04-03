//go:build !linux && !darwin && !windows

package engine

func resolveSupervisorExpectedExecutablePath(_ int, fallbackPath string) string {
	return canonicalSupervisorProcessPath(fallbackPath)
}

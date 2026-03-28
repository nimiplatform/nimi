package daemon

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
)

var (
	engineCrashAttemptPattern    = regexp.MustCompile(`attempt=(\d+)/(\d+)`)
	engineCrashExitStatusPattern = regexp.MustCompile(`exit status (\d+)`)
	runtimeEnvMu                 sync.RWMutex
)

func resolveManagedLlamaModelsConfigPath() string {
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return ""
	}
	return filepath.Join(home, ".nimi", "runtime", "llama-models.yaml")
}

func parseEngineCrashDetail(detail string) (attempt int, maxAttempt int, exitCode int) {
	exitCode = -1
	matches := engineCrashAttemptPattern.FindStringSubmatch(strings.TrimSpace(detail))
	if len(matches) == 3 {
		if value, err := strconv.Atoi(matches[1]); err == nil {
			attempt = value
		}
		if value, err := strconv.Atoi(matches[2]); err == nil {
			maxAttempt = value
		}
	}
	exitMatches := engineCrashExitStatusPattern.FindStringSubmatch(strings.TrimSpace(detail))
	if len(exitMatches) == 2 {
		if value, err := strconv.Atoi(exitMatches[1]); err == nil {
			exitCode = value
		}
	}
	return attempt, maxAttempt, exitCode
}

func runtimeSetenv(key string, value string) error {
	runtimeEnvMu.Lock()
	defer runtimeEnvMu.Unlock()
	return os.Setenv(key, value)
}

func runtimeGetenv(key string) string {
	runtimeEnvMu.RLock()
	defer runtimeEnvMu.RUnlock()
	return os.Getenv(key)
}

func engineUnhealthyReasonMatches(reason string, engineName string) bool {
	normalizedEngine := strings.TrimSpace(strings.ToLower(engineName))
	if normalizedEngine == "" {
		return false
	}
	expectedPrefix := fmt.Sprintf("engine:%s unhealthy (", normalizedEngine)
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(reason)), expectedPrefix)
}

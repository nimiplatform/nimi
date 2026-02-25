package workers

import (
	"os"
	"path/filepath"
	"strings"
)

// Enabled reports whether runtime worker supervisor/proxy mode is active.
func Enabled() bool {
	if value := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_ENABLE_WORKERS")); value != "" {
		lower := strings.ToLower(value)
		return lower == "1" || lower == "true" || lower == "yes" || lower == "on"
	}
	exe, err := os.Executable()
	if err != nil {
		return true
	}
	return !strings.HasSuffix(filepath.Base(exe), ".test")
}

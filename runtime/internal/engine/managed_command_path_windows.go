package engine

import (
	"path/filepath"
	"strings"
)

const windowsLegacyMaxPath = 260

func managedCommandExecutablePath(path string) string {
	cleaned := filepath.Clean(strings.TrimSpace(path))
	if cleaned == "." || !filepath.IsAbs(cleaned) || len(cleaned) < windowsLegacyMaxPath {
		return path
	}
	if strings.HasPrefix(cleaned, `\\?\`) {
		return cleaned
	}
	if strings.HasPrefix(cleaned, `\\`) {
		return `\\?\UNC\` + strings.TrimPrefix(cleaned, `\\`)
	}
	return `\\?\` + cleaned
}

package engine

import (
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows"
)

const windowsLegacyMaxPath = 260

func managedCommandEnvironmentValue(value string) string {
	return managedCommandPreferredPath(value)
}

func managedCommandPreferredPath(value string) string {
	cleaned := filepath.Clean(strings.TrimSpace(value))
	if cleaned == "." || !filepath.IsAbs(cleaned) || strings.HasPrefix(cleaned, `\\?\`) {
		return value
	}
	if shortPath, ok := windowsShortCommandPath(cleaned); ok && len(shortPath) < len(cleaned) {
		return shortPath
	}
	return managedCommandExecutablePath(value)
}

func managedCommandArguments(arguments []string) []string {
	normalized := make([]string, len(arguments))
	for index, argument := range arguments {
		normalized[index] = managedCommandExecutablePath(argument)
	}
	return normalized
}

func managedCommandExecutablePath(path string) string {
	cleaned := filepath.Clean(strings.TrimSpace(path))
	if cleaned == "." || !filepath.IsAbs(cleaned) || len(cleaned) < windowsLegacyMaxPath {
		return path
	}
	if strings.HasPrefix(cleaned, `\\?\`) {
		return cleaned
	}
	if shortPath, ok := windowsShortCommandPath(cleaned); ok && len(shortPath) < windowsLegacyMaxPath {
		return shortPath
	}
	if strings.HasPrefix(cleaned, `\\`) {
		return `\\?\UNC\` + strings.TrimPrefix(cleaned, `\\`)
	}
	return `\\?\` + cleaned
}

func windowsShortCommandPath(path string) (string, bool) {
	candidate := filepath.Clean(path)
	var suffix []string
	for {
		if shortPath, ok := windowsExistingShortPath(candidate); ok {
			for index := len(suffix) - 1; index >= 0; index-- {
				shortPath = filepath.Join(shortPath, suffix[index])
			}
			return shortPath, true
		}
		parent := filepath.Dir(candidate)
		if parent == candidate {
			return "", false
		}
		suffix = append(suffix, filepath.Base(candidate))
		candidate = parent
	}
}

func windowsExistingShortPath(path string) (string, bool) {
	longPath, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return "", false
	}
	required, err := windows.GetShortPathName(longPath, nil, 0)
	if err != nil || required == 0 {
		return "", false
	}
	buffer := make([]uint16, required)
	written, err := windows.GetShortPathName(longPath, &buffer[0], uint32(len(buffer)))
	if err != nil || written == 0 || written >= uint32(len(buffer)) {
		return "", false
	}
	shortPath := strings.TrimSpace(windows.UTF16ToString(buffer[:written]))
	return shortPath, shortPath != ""
}

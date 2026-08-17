package main

import (
	"os"
	"path/filepath"
	"strings"
)

func onboardingRuntimeUnavailableHint() string {
	return "Run 'nimi start' for background mode, or 'nimi serve' in another terminal."
}

func fileExists(path string) bool {
	if strings.TrimSpace(path) == "" {
		return false
	}
	_, err := os.Stat(path)
	return err == nil
}

func findSDKPackagePath(cwd string) string {
	if strings.TrimSpace(cwd) == "" {
		return ""
	}
	return filepath.Join(cwd, "node_modules", "@nimiplatform", "sdk", "package.json")
}

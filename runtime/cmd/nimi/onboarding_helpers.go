package main

import (
	"os"
	"path/filepath"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const (
	onboardingAppID         = "nimi.cli"
	onboardingSubjectUserID = "local-user"
)

func onboardingRunUsage() string {
	return `nimi run "What is Nimi?"`
}

func onboardingRuntimeUnavailableHint() string {
	return "Run 'nimi start' for background mode, or 'nimi serve' in another terminal."
}

func routePolicyLabel(route runtimev1.RoutePolicy) string {
	switch route {
	case runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL:
		return "local"
	case runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD:
		return "cloud"
	default:
		return "unspecified"
	}
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

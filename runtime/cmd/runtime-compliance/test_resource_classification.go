package main

import (
	"sort"
	"strings"
)

const runtimeModulePrefix = "github.com/nimiplatform/nimi/runtime/"

// classifyRuntimeTestResources records the audited resource shape behind the
// timing report. It is descriptive only: full-gate serialization may not be
// relaxed from this metadata without separate isolation and stability proof.
func classifyRuntimeTestResources(packagePath string, testName string) []string {
	relative := strings.TrimPrefix(strings.TrimSpace(packagePath), runtimeModulePrefix)
	if testName != "" {
		return classifyRuntimeTest(relative, testName)
	}
	classes := map[string][]string{
		"cmd/nimi":                          {"process-port", "fixed-service", "filesystem", "network"},
		"cmd/runtime-compliance":            {"process-port", "filesystem"},
		"internal/authn":                    {"filesystem"},
		"internal/daemon":                   {"process-port", "fixed-service", "filesystem", "network"},
		"internal/daemonctl":                {"process-port", "fixed-service"},
		"internal/engine":                   {"process-port", "fixed-service", "filesystem"},
		"internal/entrypoint":               {"process-port", "fixed-service", "filesystem"},
		"internal/filedownload":             {"filesystem", "network", "materialization"},
		"internal/grpcserver":               {"process-port", "fixed-service", "network"},
		"internal/nimillm":                  {"network"},
		"internal/protectedlocal":           {"process-port", "filesystem"},
		"internal/runtimepersistence":       {"filesystem"},
		"internal/services/account":         {"process-port", "fixed-service", "filesystem"},
		"internal/services/ai":              {"network"},
		"internal/services/app":             {"filesystem"},
		"internal/services/auth":            {"filesystem", "network"},
		"internal/services/cognition":       {"filesystem", "materialization"},
		"internal/services/connector":       {"filesystem", "network"},
		"internal/services/localservice":    {"process-port", "fixed-service", "filesystem", "network", "materialization"},
		"internal/services/memory":          {"filesystem"},
		"internal/services/runtimeagent":    {"filesystem", "materialization"},
		"internal/services/runtimeartifact": {"filesystem", "materialization"},
	}
	if classified, ok := classes[relative]; ok {
		return append([]string(nil), classified...)
	}
	return []string{"pure-unit"}
}

func classifyRuntimeTest(relativePackage string, testName string) []string {
	lower := strings.ToLower(testName)
	classes := make(map[string]struct{})
	switch relativePackage {
	case "internal/nimillm", "internal/services/ai", "internal/services/connector":
		classes["network"] = struct{}{}
	case "internal/services/localservice":
		classes["filesystem"] = struct{}{}
		if containsAny(lower, "material", "install", "import", "download", "bundle", "asset", "profile") {
			classes["materialization"] = struct{}{}
		}
		if containsAny(lower, "managed", "backend", "engine", "service", "startlocal", "port") {
			classes["fixed-service"] = struct{}{}
		}
		if containsAny(lower, "process", "engine", "startlocal", "port") {
			classes["process-port"] = struct{}{}
		}
		if containsAny(lower, "download", "endpoint", "health") {
			classes["network"] = struct{}{}
		}
	case "internal/services/runtimeagent", "internal/services/cognition":
		classes["filesystem"] = struct{}{}
		if containsAny(lower, "material", "persist", "source", "memory") {
			classes["materialization"] = struct{}{}
		}
	case "internal/daemon", "internal/daemonctl", "internal/engine", "internal/entrypoint", "internal/grpcserver", "internal/protectedlocal", "cmd/nimi", "cmd/runtime-compliance":
		classes["process-port"] = struct{}{}
		classes["fixed-service"] = struct{}{}
	default:
		return classifyRuntimeTestResources(runtimeModulePrefix+relativePackage, "")
	}
	if len(classes) == 0 {
		classes["pure-unit"] = struct{}{}
	}
	result := make([]string, 0, len(classes))
	for class := range classes {
		result = append(result, class)
	}
	sort.Strings(result)
	return result
}

func containsAny(value string, tokens ...string) bool {
	for _, token := range tokens {
		if strings.Contains(value, token) {
			return true
		}
	}
	return false
}

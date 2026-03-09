package main

import (
	"slices"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/config"
)

// restartRequiredFieldsChanged compares fields classified as restart-only in
// K-DAEMON-009. Changes to these fields require daemon restart to take effect.
func restartRequiredFieldsChanged(before, after config.FileConfig) bool {
	if strings.TrimSpace(before.GRPCAddr) != strings.TrimSpace(after.GRPCAddr) {
		return true
	}
	if strings.TrimSpace(before.HTTPAddr) != strings.TrimSpace(after.HTTPAddr) {
		return true
	}
	if strings.TrimSpace(before.LocalStatePath) != strings.TrimSpace(after.LocalStatePath) {
		return true
	}
	if strings.TrimSpace(before.LocalModelsPath) != strings.TrimSpace(after.LocalModelsPath) {
		return true
	}
	if strings.TrimSpace(before.DefaultLocalTextModel) != strings.TrimSpace(after.DefaultLocalTextModel) {
		return true
	}
	if strings.TrimSpace(before.DefaultCloudProvider) != strings.TrimSpace(after.DefaultCloudProvider) {
		return true
	}
	if intPtrValue(before.ShutdownTimeoutSeconds) != intPtrValue(after.ShutdownTimeoutSeconds) {
		return true
	}
	if boolPtrValue(before.WorkerMode) != boolPtrValue(after.WorkerMode) {
		return true
	}
	if authJWTFieldValue(before, func(jwtCfg *config.FileConfigJWT) string { return jwtCfg.Issuer }) != authJWTFieldValue(after, func(jwtCfg *config.FileConfigJWT) string { return jwtCfg.Issuer }) {
		return true
	}
	if authJWTFieldValue(before, func(jwtCfg *config.FileConfigJWT) string { return jwtCfg.Audience }) != authJWTFieldValue(after, func(jwtCfg *config.FileConfigJWT) string { return jwtCfg.Audience }) {
		return true
	}
	if authJWTFieldValue(before, func(jwtCfg *config.FileConfigJWT) string { return jwtCfg.JWKSURL }) != authJWTFieldValue(after, func(jwtCfg *config.FileConfigJWT) string { return jwtCfg.JWKSURL }) {
		return true
	}
	if !runtimeProvidersEqual(before.Providers, after.Providers) {
		return true
	}
	if !fileConfigEnginesEqual(before.Engines, after.Engines) {
		return true
	}
	return false
}

func authJWTFieldValue(fileCfg config.FileConfig, selector func(*config.FileConfigJWT) string) string {
	if fileCfg.Auth == nil || fileCfg.Auth.JWT == nil {
		return ""
	}
	return strings.TrimSpace(selector(fileCfg.Auth.JWT))
}

func intPtrValue(p *int) int {
	if p == nil {
		return 0
	}
	return *p
}

func boolPtrValue(p *bool) bool {
	if p == nil {
		return false
	}
	return *p
}

func intPtrEqual(left *int, right *int) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

func boolPtrEqual(left *bool, right *bool) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

func runtimeProvidersEqual(before, after map[string]config.RuntimeFileTarget) bool {
	if len(before) != len(after) {
		return false
	}
	for providerName, beforeTarget := range before {
		afterTarget, ok := after[providerName]
		if !ok {
			return false
		}
		if strings.TrimSpace(beforeTarget.BaseURL) != strings.TrimSpace(afterTarget.BaseURL) {
			return false
		}
		if strings.TrimSpace(beforeTarget.APIKeyEnv) != strings.TrimSpace(afterTarget.APIKeyEnv) {
			return false
		}
		if strings.TrimSpace(beforeTarget.APIKey) != strings.TrimSpace(afterTarget.APIKey) {
			return false
		}
		if strings.TrimSpace(beforeTarget.DefaultModel) != strings.TrimSpace(afterTarget.DefaultModel) {
			return false
		}
	}
	return true
}

func fileConfigEnginesEqual(before, after *config.FileConfigEngines) bool {
	if before == nil || after == nil {
		return before == nil && after == nil
	}
	return fileConfigEngineEqual(before.LocalAI, after.LocalAI) &&
		fileConfigEngineEqual(before.Nexa, after.Nexa)
}

func fileConfigEngineEqual(before, after *config.FileConfigEngine) bool {
	if before == nil || after == nil {
		return before == nil && after == nil
	}
	if !boolPtrEqual(before.Enabled, after.Enabled) {
		return false
	}
	if !intPtrEqual(before.Port, after.Port) {
		return false
	}
	if strings.TrimSpace(before.Version) != strings.TrimSpace(after.Version) {
		return false
	}
	return fileConfigLocalAIImageBackendEqual(before.ImageBackend, after.ImageBackend)
}

func fileConfigLocalAIImageBackendEqual(before, after *config.FileConfigLocalAIImageBackend) bool {
	if before == nil || after == nil {
		return before == nil && after == nil
	}
	if strings.TrimSpace(before.Mode) != strings.TrimSpace(after.Mode) {
		return false
	}
	if strings.TrimSpace(before.BackendName) != strings.TrimSpace(after.BackendName) {
		return false
	}
	if strings.TrimSpace(before.Address) != strings.TrimSpace(after.Address) {
		return false
	}
	if strings.TrimSpace(before.Command) != strings.TrimSpace(after.Command) {
		return false
	}
	if strings.TrimSpace(before.WorkingDir) != strings.TrimSpace(after.WorkingDir) {
		return false
	}
	if !slices.Equal(before.Args, after.Args) {
		return false
	}
	if len(before.Env) != len(after.Env) {
		return false
	}
	for key, beforeValue := range before.Env {
		if after.Env[key] != beforeValue {
			return false
		}
	}
	return true
}

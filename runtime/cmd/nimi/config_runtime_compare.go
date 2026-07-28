package main

import (
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
	if strings.TrimSpace(before.DataRootRef) != strings.TrimSpace(after.DataRootRef) {
		return true
	}
	if strings.TrimSpace(before.AppIdentityProjectionPath) != strings.TrimSpace(after.AppIdentityProjectionPath) {
		return true
	}
	if !fileConfigManagedRootsEqual(before.ManagedRoots, after.ManagedRoots) {
		return true
	}
	if !fileConfigLocalServiceEqual(before.LocalService, after.LocalService) {
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
	if authJWTFieldValue(before, func(jwtCfg *config.FileConfigJWT) string { return jwtCfg.Issuer }) != authJWTFieldValue(after, func(jwtCfg *config.FileConfigJWT) string { return jwtCfg.Issuer }) {
		return true
	}
	if authJWTFieldValue(before, func(jwtCfg *config.FileConfigJWT) string { return jwtCfg.Audience }) != authJWTFieldValue(after, func(jwtCfg *config.FileConfigJWT) string { return jwtCfg.Audience }) {
		return true
	}
	if authJWTFieldValue(before, func(jwtCfg *config.FileConfigJWT) string { return jwtCfg.JWKSURL }) != authJWTFieldValue(after, func(jwtCfg *config.FileConfigJWT) string { return jwtCfg.JWKSURL }) {
		return true
	}
	if authJWTFieldValue(before, func(jwtCfg *config.FileConfigJWT) string { return jwtCfg.RevocationURL }) != authJWTFieldValue(after, func(jwtCfg *config.FileConfigJWT) string { return jwtCfg.RevocationURL }) {
		return true
	}
	if authAccountFieldValue(before, func(accountCfg *config.FileConfigAccount) string { return accountCfg.RealmBaseURL }) != authAccountFieldValue(after, func(accountCfg *config.FileConfigAccount) string { return accountCfg.RealmBaseURL }) {
		return true
	}
	if authAccountFieldValue(before, func(accountCfg *config.FileConfigAccount) string { return accountCfg.AuthorizationURL }) != authAccountFieldValue(after, func(accountCfg *config.FileConfigAccount) string { return accountCfg.AuthorizationURL }) {
		return true
	}
	if authAccountFieldValue(before, func(accountCfg *config.FileConfigAccount) string { return accountCfg.TokenURL }) != authAccountFieldValue(after, func(accountCfg *config.FileConfigAccount) string { return accountCfg.TokenURL }) {
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

func fileConfigManagedRootsEqual(left *config.FileConfigManagedRoots, right *config.FileConfigManagedRoots) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return strings.TrimSpace(left.Models) == strings.TrimSpace(right.Models) &&
		strings.TrimSpace(left.Dependencies) == strings.TrimSpace(right.Dependencies) &&
		strings.TrimSpace(left.Environments) == strings.TrimSpace(right.Environments) &&
		strings.TrimSpace(left.Apps) == strings.TrimSpace(right.Apps) &&
		strings.TrimSpace(left.Accounts) == strings.TrimSpace(right.Accounts) &&
		strings.TrimSpace(left.Logs) == strings.TrimSpace(right.Logs) &&
		strings.TrimSpace(left.Audit) == strings.TrimSpace(right.Audit)
}

func fileConfigLocalServiceEqual(left *config.FileConfigLocalService, right *config.FileConfigLocalService) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	if !boolPtrEqual(left.Enabled, right.Enabled) {
		return false
	}
	return strings.TrimSpace(left.Mode) == strings.TrimSpace(right.Mode)
}

func authJWTFieldValue(fileCfg config.FileConfig, selector func(*config.FileConfigJWT) string) string {
	if fileCfg.Auth == nil || fileCfg.Auth.JWT == nil {
		return ""
	}
	return strings.TrimSpace(selector(fileCfg.Auth.JWT))
}

func authAccountFieldValue(fileCfg config.FileConfig, selector func(*config.FileConfigAccount) string) string {
	if fileCfg.Auth == nil || fileCfg.Auth.Account == nil {
		return ""
	}
	return strings.TrimSpace(selector(fileCfg.Auth.Account))
}

func intPtrValue(p *int) int {
	if p == nil {
		return 0
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
	return fileConfigEngineEqual(before.Llama, after.Llama) &&
		fileConfigEngineEqual(before.Media, after.Media)
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
	return true
}

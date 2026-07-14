package main

import (
	"fmt"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/config"
)

func ensureAuthJWTConfig(fileCfg *config.FileConfig) *config.FileConfigJWT {
	if fileCfg == nil {
		return &config.FileConfigJWT{}
	}
	if fileCfg.Auth == nil {
		fileCfg.Auth = &config.FileConfigAuth{}
	} else {
		authCopy := *fileCfg.Auth
		fileCfg.Auth = &authCopy
	}
	if fileCfg.Auth.JWT == nil {
		fileCfg.Auth.JWT = &config.FileConfigJWT{}
	} else {
		jwtCopy := *fileCfg.Auth.JWT
		fileCfg.Auth.JWT = &jwtCopy
	}
	return fileCfg.Auth.JWT
}

func ensureAuthAccountConfig(fileCfg *config.FileConfig) *config.FileConfigAccount {
	if fileCfg == nil {
		return &config.FileConfigAccount{}
	}
	if fileCfg.Auth == nil {
		fileCfg.Auth = &config.FileConfigAuth{}
	} else {
		authCopy := *fileCfg.Auth
		fileCfg.Auth = &authCopy
	}
	if fileCfg.Auth.Account == nil {
		fileCfg.Auth.Account = &config.FileConfigAccount{}
	} else {
		accountCopy := *fileCfg.Auth.Account
		fileCfg.Auth.Account = &accountCopy
	}
	return fileCfg.Auth.Account
}

func ensureManagedRootsConfig(fileCfg *config.FileConfig) *config.FileConfigManagedRoots {
	if fileCfg == nil {
		return &config.FileConfigManagedRoots{}
	}
	if fileCfg.ManagedRoots == nil {
		fileCfg.ManagedRoots = &config.FileConfigManagedRoots{}
	} else {
		managedRootsCopy := *fileCfg.ManagedRoots
		fileCfg.ManagedRoots = &managedRootsCopy
	}
	return fileCfg.ManagedRoots
}

func pruneEmptyManagedRootsConfig(fileCfg *config.FileConfig) {
	if fileCfg == nil || fileCfg.ManagedRoots == nil {
		return
	}
	if strings.TrimSpace(fileCfg.ManagedRoots.Models) == "" &&
		strings.TrimSpace(fileCfg.ManagedRoots.Dependencies) == "" &&
		strings.TrimSpace(fileCfg.ManagedRoots.Environments) == "" &&
		strings.TrimSpace(fileCfg.ManagedRoots.Logs) == "" &&
		strings.TrimSpace(fileCfg.ManagedRoots.Audit) == "" {
		fileCfg.ManagedRoots = nil
	}
}

func pruneEmptyAuthConfig(fileCfg *config.FileConfig) {
	if fileCfg == nil || fileCfg.Auth == nil {
		return
	}
	if fileCfg.Auth.JWT != nil {
		if strings.TrimSpace(fileCfg.Auth.JWT.Issuer) == "" &&
			strings.TrimSpace(fileCfg.Auth.JWT.Audience) == "" &&
			strings.TrimSpace(fileCfg.Auth.JWT.JWKSURL) == "" &&
			strings.TrimSpace(fileCfg.Auth.JWT.RevocationURL) == "" {
			fileCfg.Auth.JWT = nil
		}
	}
	if fileCfg.Auth.Account != nil {
		if strings.TrimSpace(fileCfg.Auth.Account.RealmBaseURL) == "" &&
			strings.TrimSpace(fileCfg.Auth.Account.AuthorizationURL) == "" &&
			strings.TrimSpace(fileCfg.Auth.Account.TokenURL) == "" {
			fileCfg.Auth.Account = nil
		}
	}
	if fileCfg.Auth.JWT == nil && fileCfg.Auth.Account == nil {
		fileCfg.Auth = nil
	}
}

func ensureLocalServiceConfig(fileCfg *config.FileConfig) *config.FileConfigLocalService {
	if fileCfg == nil {
		return &config.FileConfigLocalService{}
	}
	if fileCfg.LocalService == nil {
		fileCfg.LocalService = &config.FileConfigLocalService{}
	} else {
		localServiceCopy := *fileCfg.LocalService
		fileCfg.LocalService = &localServiceCopy
	}
	return fileCfg.LocalService
}

func ensureEngineConfig(fileCfg *config.FileConfig, engineName string) *config.FileConfigEngine {
	if fileCfg == nil {
		return &config.FileConfigEngine{}
	}
	if fileCfg.Engines == nil {
		fileCfg.Engines = &config.FileConfigEngines{}
	}
	switch strings.TrimSpace(strings.ToLower(engineName)) {
	case "llama":
		if fileCfg.Engines.Llama == nil {
			fileCfg.Engines.Llama = &config.FileConfigEngine{}
		}
		return fileCfg.Engines.Llama
	case "media":
		if fileCfg.Engines.Media == nil {
			fileCfg.Engines.Media = &config.FileConfigEngine{}
		}
		return fileCfg.Engines.Media
	default:
		return &config.FileConfigEngine{}
	}
}

func pruneEmptyEnginesConfig(fileCfg *config.FileConfig) {
	if fileCfg == nil || fileCfg.Engines == nil {
		return
	}
	if isEmptyFileConfigEngine(fileCfg.Engines.Llama) {
		fileCfg.Engines.Llama = nil
	}
	if isEmptyFileConfigEngine(fileCfg.Engines.Media) {
		fileCfg.Engines.Media = nil
	}
	if fileCfg.Engines.Llama == nil && fileCfg.Engines.Media == nil {
		fileCfg.Engines = nil
	}
}

func isEmptyFileConfigEngine(engineCfg *config.FileConfigEngine) bool {
	if engineCfg == nil {
		return true
	}
	return engineCfg.Enabled == nil &&
		strings.TrimSpace(engineCfg.Version) == "" &&
		engineCfg.Port == nil
}

func cloneFileConfigEngine(engineCfg *config.FileConfigEngine) *config.FileConfigEngine {
	if engineCfg == nil {
		return nil
	}
	cloned := &config.FileConfigEngine{
		Version: strings.TrimSpace(engineCfg.Version),
	}
	if engineCfg.Enabled != nil {
		enabled := *engineCfg.Enabled
		cloned.Enabled = &enabled
	}
	if engineCfg.Port != nil {
		port := *engineCfg.Port
		cloned.Port = &port
	}
	return cloned
}

func parseBooleanConfigValue(raw string) (bool, error) {
	switch strings.TrimSpace(strings.ToLower(raw)) {
	case "true", "1", "yes":
		return true, nil
	case "false", "0", "no":
		return false, nil
	default:
		return false, fmt.Errorf("invalid boolean value %q", raw)
	}
}

func isSecretPolicyViolation(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "cannot set both apikey and apikeyenv")
}

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

func pruneEmptyAuthConfig(fileCfg *config.FileConfig) {
	if fileCfg == nil || fileCfg.Auth == nil {
		return
	}
	if fileCfg.Auth.JWT != nil {
		if strings.TrimSpace(fileCfg.Auth.JWT.Issuer) == "" &&
			strings.TrimSpace(fileCfg.Auth.JWT.Audience) == "" &&
			strings.TrimSpace(fileCfg.Auth.JWT.JWKSURL) == "" {
			fileCfg.Auth.JWT = nil
		}
	}
	if fileCfg.Auth.JWT == nil {
		fileCfg.Auth = nil
	}
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

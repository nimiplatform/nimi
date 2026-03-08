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
	case "localai":
		if fileCfg.Engines.LocalAI == nil {
			fileCfg.Engines.LocalAI = &config.FileConfigEngine{}
		}
		return fileCfg.Engines.LocalAI
	case "nexa":
		if fileCfg.Engines.Nexa == nil {
			fileCfg.Engines.Nexa = &config.FileConfigEngine{}
		}
		return fileCfg.Engines.Nexa
	default:
		return &config.FileConfigEngine{}
	}
}

func ensureLocalAIImageBackendConfig(fileCfg *config.FileConfig) *config.FileConfigLocalAIImageBackend {
	engineCfg := ensureEngineConfig(fileCfg, "localai")
	if engineCfg.ImageBackend == nil {
		engineCfg.ImageBackend = &config.FileConfigLocalAIImageBackend{}
	}
	return engineCfg.ImageBackend
}

func pruneEmptyEnginesConfig(fileCfg *config.FileConfig) {
	if fileCfg == nil || fileCfg.Engines == nil {
		return
	}
	if fileCfg.Engines.LocalAI != nil && isEmptyLocalAIImageBackendConfig(fileCfg.Engines.LocalAI.ImageBackend) {
		fileCfg.Engines.LocalAI.ImageBackend = nil
	}
	if isEmptyFileConfigEngine(fileCfg.Engines.LocalAI) {
		fileCfg.Engines.LocalAI = nil
	}
	if isEmptyFileConfigEngine(fileCfg.Engines.Nexa) {
		fileCfg.Engines.Nexa = nil
	}
	if fileCfg.Engines.LocalAI == nil && fileCfg.Engines.Nexa == nil {
		fileCfg.Engines = nil
	}
}

func isEmptyFileConfigEngine(engineCfg *config.FileConfigEngine) bool {
	if engineCfg == nil {
		return true
	}
	return engineCfg.Enabled == nil &&
		strings.TrimSpace(engineCfg.Version) == "" &&
		engineCfg.Port == nil &&
		isEmptyLocalAIImageBackendConfig(engineCfg.ImageBackend)
}

func isEmptyLocalAIImageBackendConfig(cfg *config.FileConfigLocalAIImageBackend) bool {
	if cfg == nil {
		return true
	}
	return strings.TrimSpace(cfg.Mode) == "" &&
		strings.TrimSpace(cfg.BackendName) == "" &&
		strings.TrimSpace(cfg.Address) == "" &&
		strings.TrimSpace(cfg.Command) == "" &&
		len(cfg.Args) == 0 &&
		len(cfg.Env) == 0 &&
		strings.TrimSpace(cfg.WorkingDir) == ""
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
	cloned.ImageBackend = cloneFileConfigLocalAIImageBackend(engineCfg.ImageBackend)
	return cloned
}

func cloneFileConfigLocalAIImageBackend(cfg *config.FileConfigLocalAIImageBackend) *config.FileConfigLocalAIImageBackend {
	if cfg == nil {
		return nil
	}
	cloned := &config.FileConfigLocalAIImageBackend{
		Mode:        strings.TrimSpace(cfg.Mode),
		BackendName: strings.TrimSpace(cfg.BackendName),
		Address:     strings.TrimSpace(cfg.Address),
		Command:     strings.TrimSpace(cfg.Command),
		Args:        append([]string(nil), cfg.Args...),
		WorkingDir:  strings.TrimSpace(cfg.WorkingDir),
	}
	if len(cfg.Env) > 0 {
		cloned.Env = make(map[string]string, len(cfg.Env))
		for key, value := range cfg.Env {
			cloned.Env[key] = value
		}
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
	return strings.Contains(message, "apikey is forbidden")
}

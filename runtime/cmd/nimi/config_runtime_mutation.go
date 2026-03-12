package main

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/config"
)

func parseConfigSetAssignment(raw string) (string, string, error) {
	assignment := strings.TrimSpace(raw)
	parts := strings.SplitN(assignment, "=", 2)
	if len(parts) != 2 {
		return "", "", fmt.Errorf("invalid assignment %q", raw)
	}
	key := strings.TrimSpace(parts[0])
	value := strings.TrimSpace(parts[1])
	if key == "" {
		return "", "", fmt.Errorf("assignment key cannot be empty")
	}
	return key, value, nil
}

func applyConfigSetOperation(cfg *config.FileConfig, key string, value string) error {
	if cfg == nil {
		return fmt.Errorf("nil config")
	}
	normalizedKey := strings.TrimSpace(key)
	switch normalizedKey {
	case "schemaVersion":
		parsed, err := strconv.Atoi(strings.TrimSpace(value))
		if err != nil {
			return fmt.Errorf("schemaVersion must be integer: %w", err)
		}
		cfg.SchemaVersion = parsed
		return nil
	case "grpcAddr":
		cfg.GRPCAddr = value
		return nil
	case "httpAddr":
		cfg.HTTPAddr = value
		return nil
	case "shutdownTimeoutSeconds":
		parsed, err := strconv.Atoi(strings.TrimSpace(value))
		if err != nil {
			return fmt.Errorf("shutdownTimeoutSeconds must be integer: %w", err)
		}
		cfg.ShutdownTimeoutSeconds = &parsed
		return nil
	case "localStatePath":
		cfg.LocalStatePath = value
		return nil
	case "localModelsPath":
		cfg.LocalModelsPath = value
		return nil
	case "defaultLocalTextModel":
		cfg.DefaultLocalTextModel = strings.TrimSpace(value)
		return nil
	case "defaultCloudProvider":
		cfg.DefaultCloudProvider = strings.TrimSpace(value)
		return nil
	case "aiHealthIntervalSeconds":
		parsed, err := strconv.Atoi(strings.TrimSpace(value))
		if err != nil {
			return fmt.Errorf("aiHealthIntervalSeconds must be integer: %w", err)
		}
		cfg.AIHealthIntervalSeconds = &parsed
		return nil
	case "aiHttpTimeoutSeconds":
		parsed, err := strconv.Atoi(strings.TrimSpace(value))
		if err != nil {
			return fmt.Errorf("aiHttpTimeoutSeconds must be integer: %w", err)
		}
		cfg.AIHTTPTimeoutSeconds = &parsed
		return nil
	case "globalConcurrencyLimit":
		parsed, err := strconv.Atoi(strings.TrimSpace(value))
		if err != nil {
			return fmt.Errorf("globalConcurrencyLimit must be integer: %w", err)
		}
		cfg.GlobalConcurrencyLimit = &parsed
		return nil
	case "perAppConcurrencyLimit":
		parsed, err := strconv.Atoi(strings.TrimSpace(value))
		if err != nil {
			return fmt.Errorf("perAppConcurrencyLimit must be integer: %w", err)
		}
		cfg.PerAppConcurrencyLimit = &parsed
		return nil
	case "idempotencyCapacity":
		parsed, err := strconv.Atoi(strings.TrimSpace(value))
		if err != nil {
			return fmt.Errorf("idempotencyCapacity must be integer: %w", err)
		}
		cfg.IdempotencyCapacity = &parsed
		return nil
	case "maxDelegationDepth":
		parsed, err := strconv.Atoi(strings.TrimSpace(value))
		if err != nil {
			return fmt.Errorf("maxDelegationDepth must be integer: %w", err)
		}
		cfg.MaxDelegationDepth = &parsed
		return nil
	case "auditRingBufferSize":
		parsed, err := strconv.Atoi(strings.TrimSpace(value))
		if err != nil {
			return fmt.Errorf("auditRingBufferSize must be integer: %w", err)
		}
		cfg.AuditRingBufferSize = &parsed
		return nil
	case "usageStatsBufferSize":
		parsed, err := strconv.Atoi(strings.TrimSpace(value))
		if err != nil {
			return fmt.Errorf("usageStatsBufferSize must be integer: %w", err)
		}
		cfg.UsageStatsBufferSize = &parsed
		return nil
	case "localAuditCapacity":
		parsed, err := strconv.Atoi(strings.TrimSpace(value))
		if err != nil {
			return fmt.Errorf("localAuditCapacity must be integer: %w", err)
		}
		cfg.LocalAuditCapacity = &parsed
		return nil
	case "sessionTtlMinSeconds":
		parsed, err := strconv.Atoi(strings.TrimSpace(value))
		if err != nil {
			return fmt.Errorf("sessionTtlMinSeconds must be integer: %w", err)
		}
		cfg.SessionTTLMinSeconds = &parsed
		return nil
	case "sessionTtlMaxSeconds":
		parsed, err := strconv.Atoi(strings.TrimSpace(value))
		if err != nil {
			return fmt.Errorf("sessionTtlMaxSeconds must be integer: %w", err)
		}
		cfg.SessionTTLMaxSeconds = &parsed
		return nil
	case "auth.jwt.issuer":
		ensureAuthJWTConfig(cfg).Issuer = value
		return nil
	case "auth.jwt.audience":
		ensureAuthJWTConfig(cfg).Audience = value
		return nil
	case "auth.jwt.jwksUrl":
		ensureAuthJWTConfig(cfg).JWKSURL = value
		return nil
	case "engines.localai.enabled":
		parsed, err := parseBooleanConfigValue(value)
		if err != nil {
			return fmt.Errorf("engines.localai.enabled must be boolean: %w", err)
		}
		ensureEngineConfig(cfg, "localai").Enabled = &parsed
		return nil
	case "engines.localai.version":
		ensureEngineConfig(cfg, "localai").Version = value
		return nil
	case "engines.localai.port":
		parsed, err := strconv.Atoi(strings.TrimSpace(value))
		if err != nil {
			return fmt.Errorf("engines.localai.port must be integer: %w", err)
		}
		ensureEngineConfig(cfg, "localai").Port = &parsed
		return nil
	case "engines.localai.imageBackend.mode":
		ensureLocalAIImageBackendConfig(cfg).Mode = strings.TrimSpace(value)
		return nil
	case "engines.localai.imageBackend.backendName":
		ensureLocalAIImageBackendConfig(cfg).BackendName = strings.TrimSpace(value)
		return nil
	case "engines.localai.imageBackend.address":
		ensureLocalAIImageBackendConfig(cfg).Address = strings.TrimSpace(value)
		return nil
	case "engines.localai.imageBackend.command":
		ensureLocalAIImageBackendConfig(cfg).Command = strings.TrimSpace(value)
		return nil
	case "engines.localai.imageBackend.workingDir":
		ensureLocalAIImageBackendConfig(cfg).WorkingDir = strings.TrimSpace(value)
		return nil
	case "engines.localai.imageBackend.args":
		var parsed []string
		if err := json.Unmarshal([]byte(strings.TrimSpace(value)), &parsed); err != nil {
			return fmt.Errorf("engines.localai.imageBackend.args must be JSON string array: %w", err)
		}
		ensureLocalAIImageBackendConfig(cfg).Args = append([]string(nil), parsed...)
		return nil
	case "engines.localai.imageBackend.env":
		parsed := make(map[string]string)
		if err := json.Unmarshal([]byte(strings.TrimSpace(value)), &parsed); err != nil {
			return fmt.Errorf("engines.localai.imageBackend.env must be JSON string map: %w", err)
		}
		ensureLocalAIImageBackendConfig(cfg).Env = parsed
		return nil
	case "engines.nexa.enabled":
		parsed, err := parseBooleanConfigValue(value)
		if err != nil {
			return fmt.Errorf("engines.nexa.enabled must be boolean: %w", err)
		}
		ensureEngineConfig(cfg, "nexa").Enabled = &parsed
		return nil
	case "engines.nexa.version":
		ensureEngineConfig(cfg, "nexa").Version = value
		return nil
	case "engines.nexa.port":
		parsed, err := strconv.Atoi(strings.TrimSpace(value))
		if err != nil {
			return fmt.Errorf("engines.nexa.port must be integer: %w", err)
		}
		ensureEngineConfig(cfg, "nexa").Port = &parsed
		return nil
	}

	parts := strings.Split(normalizedKey, ".")
	if len(parts) != 3 || parts[0] != "providers" {
		return fmt.Errorf("unsupported config key %q", key)
	}
	providerName := strings.TrimSpace(parts[1])
	providerField := strings.TrimSpace(parts[2])
	if providerName == "" {
		return fmt.Errorf("provider name cannot be empty")
	}
	if cfg.Providers == nil {
		cfg.Providers = map[string]config.RuntimeFileTarget{}
	}
	target := cfg.Providers[providerName]
	switch providerField {
	case "baseUrl":
		target.BaseURL = value
	case "apiKeyEnv":
		target.APIKeyEnv = value
	case "apiKey":
		target.APIKey = value
	case "defaultModel":
		target.DefaultModel = value
	default:
		return fmt.Errorf("unsupported provider config key %q", key)
	}
	cfg.Providers[providerName] = target
	return nil
}

func applyConfigUnsetOperation(cfg *config.FileConfig, key string) error {
	if cfg == nil {
		return fmt.Errorf("nil config")
	}
	defaultCfg := config.DefaultFileConfig()
	normalizedKey := strings.TrimSpace(key)
	switch normalizedKey {
	case "schemaVersion":
		return fmt.Errorf("schemaVersion cannot be unset")
	case "grpcAddr":
		cfg.GRPCAddr = defaultCfg.GRPCAddr
		return nil
	case "httpAddr":
		cfg.HTTPAddr = defaultCfg.HTTPAddr
		return nil
	case "shutdownTimeoutSeconds":
		cfg.ShutdownTimeoutSeconds = defaultCfg.ShutdownTimeoutSeconds
		return nil
	case "localStatePath":
		cfg.LocalStatePath = defaultCfg.LocalStatePath
		return nil
	case "localModelsPath":
		cfg.LocalModelsPath = defaultCfg.LocalModelsPath
		return nil
	case "defaultLocalTextModel":
		cfg.DefaultLocalTextModel = strings.TrimSpace(defaultCfg.DefaultLocalTextModel)
		return nil
	case "defaultCloudProvider":
		cfg.DefaultCloudProvider = strings.TrimSpace(defaultCfg.DefaultCloudProvider)
		return nil
	case "aiHealthIntervalSeconds":
		cfg.AIHealthIntervalSeconds = defaultCfg.AIHealthIntervalSeconds
		return nil
	case "aiHttpTimeoutSeconds":
		cfg.AIHTTPTimeoutSeconds = defaultCfg.AIHTTPTimeoutSeconds
		return nil
	case "globalConcurrencyLimit":
		cfg.GlobalConcurrencyLimit = defaultCfg.GlobalConcurrencyLimit
		return nil
	case "perAppConcurrencyLimit":
		cfg.PerAppConcurrencyLimit = defaultCfg.PerAppConcurrencyLimit
		return nil
	case "idempotencyCapacity":
		cfg.IdempotencyCapacity = defaultCfg.IdempotencyCapacity
		return nil
	case "maxDelegationDepth":
		cfg.MaxDelegationDepth = defaultCfg.MaxDelegationDepth
		return nil
	case "auditRingBufferSize":
		cfg.AuditRingBufferSize = defaultCfg.AuditRingBufferSize
		return nil
	case "usageStatsBufferSize":
		cfg.UsageStatsBufferSize = defaultCfg.UsageStatsBufferSize
		return nil
	case "localAuditCapacity":
		cfg.LocalAuditCapacity = defaultCfg.LocalAuditCapacity
		return nil
	case "sessionTtlMinSeconds":
		cfg.SessionTTLMinSeconds = defaultCfg.SessionTTLMinSeconds
		return nil
	case "sessionTtlMaxSeconds":
		cfg.SessionTTLMaxSeconds = defaultCfg.SessionTTLMaxSeconds
		return nil
	case "auth.jwt.issuer":
		ensureAuthJWTConfig(cfg).Issuer = ""
		pruneEmptyAuthConfig(cfg)
		return nil
	case "auth.jwt.audience":
		ensureAuthJWTConfig(cfg).Audience = ""
		pruneEmptyAuthConfig(cfg)
		return nil
	case "auth.jwt.jwksUrl":
		ensureAuthJWTConfig(cfg).JWKSURL = ""
		pruneEmptyAuthConfig(cfg)
		return nil
	case "engines.localai.enabled":
		ensureEngineConfig(cfg, "localai").Enabled = nil
		pruneEmptyEnginesConfig(cfg)
		return nil
	case "engines.localai.version":
		ensureEngineConfig(cfg, "localai").Version = ""
		pruneEmptyEnginesConfig(cfg)
		return nil
	case "engines.localai.port":
		ensureEngineConfig(cfg, "localai").Port = nil
		pruneEmptyEnginesConfig(cfg)
		return nil
	case "engines.localai.imageBackend.mode":
		ensureLocalAIImageBackendConfig(cfg).Mode = ""
		pruneEmptyEnginesConfig(cfg)
		return nil
	case "engines.localai.imageBackend.backendName":
		ensureLocalAIImageBackendConfig(cfg).BackendName = ""
		pruneEmptyEnginesConfig(cfg)
		return nil
	case "engines.localai.imageBackend.address":
		ensureLocalAIImageBackendConfig(cfg).Address = ""
		pruneEmptyEnginesConfig(cfg)
		return nil
	case "engines.localai.imageBackend.command":
		ensureLocalAIImageBackendConfig(cfg).Command = ""
		pruneEmptyEnginesConfig(cfg)
		return nil
	case "engines.localai.imageBackend.workingDir":
		ensureLocalAIImageBackendConfig(cfg).WorkingDir = ""
		pruneEmptyEnginesConfig(cfg)
		return nil
	case "engines.localai.imageBackend.args":
		ensureLocalAIImageBackendConfig(cfg).Args = nil
		pruneEmptyEnginesConfig(cfg)
		return nil
	case "engines.localai.imageBackend.env":
		ensureLocalAIImageBackendConfig(cfg).Env = nil
		pruneEmptyEnginesConfig(cfg)
		return nil
	case "engines.nexa.enabled":
		ensureEngineConfig(cfg, "nexa").Enabled = nil
		pruneEmptyEnginesConfig(cfg)
		return nil
	case "engines.nexa.version":
		ensureEngineConfig(cfg, "nexa").Version = ""
		pruneEmptyEnginesConfig(cfg)
		return nil
	case "engines.nexa.port":
		ensureEngineConfig(cfg, "nexa").Port = nil
		pruneEmptyEnginesConfig(cfg)
		return nil
	}

	parts := strings.Split(normalizedKey, ".")
	if len(parts) < 2 || parts[0] != "providers" {
		return fmt.Errorf("unsupported unset key %q", key)
	}
	providerName := strings.TrimSpace(parts[1])
	if providerName == "" {
		return fmt.Errorf("provider name cannot be empty")
	}
	if cfg.Providers == nil {
		cfg.Providers = map[string]config.RuntimeFileTarget{}
	}

	if len(parts) == 2 {
		delete(cfg.Providers, providerName)
		return nil
	}
	if len(parts) != 3 {
		return fmt.Errorf("unsupported unset key %q", key)
	}
	target := cfg.Providers[providerName]
	switch strings.TrimSpace(parts[2]) {
	case "baseUrl":
		target.BaseURL = ""
	case "apiKeyEnv":
		target.APIKeyEnv = ""
	case "apiKey":
		target.APIKey = ""
	case "defaultModel":
		target.DefaultModel = ""
	default:
		return fmt.Errorf("unsupported unset key %q", key)
	}
	cfg.Providers[providerName] = target
	return nil
}

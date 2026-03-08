package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/config"
)

func mergeFileConfigWithDefaults(raw config.FileConfig) config.FileConfig {
	merged := config.DefaultFileConfig()
	if raw.SchemaVersion != 0 {
		merged.SchemaVersion = raw.SchemaVersion
	}
	if v := strings.TrimSpace(raw.GRPCAddr); v != "" {
		merged.GRPCAddr = v
	}
	if v := strings.TrimSpace(raw.HTTPAddr); v != "" {
		merged.HTTPAddr = v
	}
	if raw.ShutdownTimeoutSeconds != nil {
		merged.ShutdownTimeoutSeconds = raw.ShutdownTimeoutSeconds
	}
	if v := strings.TrimSpace(raw.LocalStatePath); v != "" {
		merged.LocalStatePath = v
	}
	if v := strings.TrimSpace(raw.LocalModelsPath); v != "" {
		merged.LocalModelsPath = v
	}
	if raw.WorkerMode != nil {
		merged.WorkerMode = raw.WorkerMode
	}
	if raw.AIHealthIntervalSeconds != nil {
		merged.AIHealthIntervalSeconds = raw.AIHealthIntervalSeconds
	}
	if raw.AIHTTPTimeoutSeconds != nil {
		merged.AIHTTPTimeoutSeconds = raw.AIHTTPTimeoutSeconds
	}
	if raw.GlobalConcurrencyLimit != nil {
		merged.GlobalConcurrencyLimit = raw.GlobalConcurrencyLimit
	}
	if raw.PerAppConcurrencyLimit != nil {
		merged.PerAppConcurrencyLimit = raw.PerAppConcurrencyLimit
	}
	if raw.IdempotencyCapacity != nil {
		merged.IdempotencyCapacity = raw.IdempotencyCapacity
	}
	if raw.MaxDelegationDepth != nil {
		merged.MaxDelegationDepth = raw.MaxDelegationDepth
	}
	if raw.AuditRingBufferSize != nil {
		merged.AuditRingBufferSize = raw.AuditRingBufferSize
	}
	if raw.UsageStatsBufferSize != nil {
		merged.UsageStatsBufferSize = raw.UsageStatsBufferSize
	}
	if raw.LocalAuditCapacity != nil {
		merged.LocalAuditCapacity = raw.LocalAuditCapacity
	}
	if raw.SessionTTLMinSeconds != nil {
		merged.SessionTTLMinSeconds = raw.SessionTTLMinSeconds
	}
	if raw.SessionTTLMaxSeconds != nil {
		merged.SessionTTLMaxSeconds = raw.SessionTTLMaxSeconds
	}
	if raw.Auth != nil && raw.Auth.JWT != nil {
		merged.Auth = &config.FileConfigAuth{
			JWT: &config.FileConfigJWT{
				Issuer:   strings.TrimSpace(raw.Auth.JWT.Issuer),
				Audience: strings.TrimSpace(raw.Auth.JWT.Audience),
				JWKSURL:  strings.TrimSpace(raw.Auth.JWT.JWKSURL),
			},
		}
	}
	if raw.Providers != nil {
		mergedProviders := map[string]config.RuntimeFileTarget{}
		for k, v := range raw.Providers {
			mergedProviders[k] = v
		}
		merged.Providers = mergedProviders
	}
	if raw.Engines != nil {
		merged.Engines = &config.FileConfigEngines{
			LocalAI: cloneFileConfigEngine(raw.Engines.LocalAI),
			Nexa:    cloneFileConfigEngine(raw.Engines.Nexa),
		}
		pruneEmptyEnginesConfig(&merged)
	}
	return merged
}

func cloneFileConfig(fileCfg config.FileConfig) config.FileConfig {
	cloned := fileCfg
	if fileCfg.Auth != nil {
		authCopy := *fileCfg.Auth
		cloned.Auth = &authCopy
		if fileCfg.Auth.JWT != nil {
			jwtCopy := *fileCfg.Auth.JWT
			cloned.Auth.JWT = &jwtCopy
		}
	}
	if fileCfg.Providers != nil {
		clonedProviders := make(map[string]config.RuntimeFileTarget, len(fileCfg.Providers))
		for k, v := range fileCfg.Providers {
			clonedProviders[k] = v
		}
		cloned.Providers = clonedProviders
	}
	if fileCfg.Engines != nil {
		cloned.Engines = &config.FileConfigEngines{
			LocalAI: cloneFileConfigEngine(fileCfg.Engines.LocalAI),
			Nexa:    cloneFileConfigEngine(fileCfg.Engines.Nexa),
		}
	}
	return cloned
}

func validateMergedRuntimeFields(fileCfg config.FileConfig) error {
	if err := config.ValidateFileConfig(fileCfg); err != nil {
		return err
	}

	if _, _, err := net.SplitHostPort(strings.TrimSpace(fileCfg.GRPCAddr)); err != nil {
		return fmt.Errorf("grpcAddr invalid: %w", err)
	}
	if _, _, err := net.SplitHostPort(strings.TrimSpace(fileCfg.HTTPAddr)); err != nil {
		return fmt.Errorf("httpAddr invalid: %w", err)
	}
	if fileCfg.ShutdownTimeoutSeconds != nil && *fileCfg.ShutdownTimeoutSeconds <= 0 {
		return fmt.Errorf("shutdownTimeoutSeconds must be > 0")
	}
	if fileCfg.Auth != nil && fileCfg.Auth.JWT != nil {
		jwksURL := strings.TrimSpace(fileCfg.Auth.JWT.JWKSURL)
		if jwksURL != "" {
			parsed, err := url.Parse(jwksURL)
			if err != nil {
				return fmt.Errorf("auth.jwt.jwksUrl invalid: %w", err)
			}
			if parsed.Scheme != "http" && parsed.Scheme != "https" {
				return fmt.Errorf("auth.jwt.jwksUrl must use http/https scheme")
			}
			if strings.TrimSpace(parsed.Host) == "" {
				return fmt.Errorf("auth.jwt.jwksUrl must include host")
			}
		}
	}
	return nil
}

func readConfigInput(fromStdin bool, filePath string) ([]byte, error) {
	if fromStdin {
		return io.ReadAll(os.Stdin)
	}
	if strings.TrimSpace(filePath) == "" {
		return nil, nil
	}
	return os.ReadFile(strings.TrimSpace(filePath))
}

func parseConfigInputJSON(raw []byte) (config.FileConfig, error) {
	if len(strings.TrimSpace(string(raw))) == 0 {
		return config.FileConfig{}, newConfigCommandError(configReasonParseFailed, "input payload cannot be empty", fmt.Errorf("empty config payload"))
	}
	var parsed config.FileConfig
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&parsed); err != nil {
		return config.FileConfig{}, newConfigCommandError(configReasonParseFailed, "provide valid JSON payload", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return config.FileConfig{}, newConfigCommandError(configReasonParseFailed, "provide valid JSON payload", err)
	}
	merged := mergeFileConfigWithDefaults(parsed)
	if err := validateMergedRuntimeFields(merged); err != nil {
		if isSecretPolicyViolation(err) {
			return config.FileConfig{}, newConfigCommandError(configReasonSecretPolicyViolation, "replace apiKey with apiKeyEnv", err)
		}
		return config.FileConfig{}, newConfigCommandError(configReasonSchemaInvalid, "run `nimi config validate`", err)
	}
	return merged, nil
}

func loadConfigForMutation(path string) (config.FileConfig, error) {
	raw, err := config.LoadFileConfig(path)
	if err != nil {
		return config.FileConfig{}, classifyConfigLoadError(err)
	}
	return mergeFileConfigWithDefaults(raw), nil
}

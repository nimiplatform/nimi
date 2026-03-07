package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"github.com/nimiplatform/nimi/runtime/internal/config"
)

const (
	configReasonParseFailed           = "CONFIG_PARSE_FAILED"
	configReasonSchemaInvalid         = "CONFIG_SCHEMA_INVALID"
	configReasonWriteLocked           = "CONFIG_WRITE_LOCKED"
	configReasonSecretPolicyViolation = "CONFIG_SECRET_POLICY_VIOLATION"
	configReasonRestartRequired       = "CONFIG_RESTART_REQUIRED"
	configReasonApplied               = "CONFIG_APPLIED"
)

type configCommandError struct {
	reasonCode string
	actionHint string
	cause      error
}

var (
	configWriteLockHookMu sync.RWMutex
	configWriteLockHook   func(lockPath string)
)

func (e *configCommandError) Error() string {
	if e == nil {
		return ""
	}
	if e.cause == nil {
		if strings.TrimSpace(e.actionHint) == "" {
			return e.reasonCode
		}
		return fmt.Sprintf("%s: actionHint=%s", e.reasonCode, e.actionHint)
	}
	if strings.TrimSpace(e.actionHint) == "" {
		return fmt.Sprintf("%s: %v", e.reasonCode, e.cause)
	}
	return fmt.Sprintf("%s: %v (actionHint=%s)", e.reasonCode, e.cause, e.actionHint)
}

func (e *configCommandError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.cause
}

func newConfigCommandError(reasonCode string, actionHint string, cause error) error {
	return &configCommandError{
		reasonCode: strings.TrimSpace(reasonCode),
		actionHint: strings.TrimSpace(actionHint),
		cause:      cause,
	}
}

func runRuntimeConfig(args []string) error {
	if len(args) == 0 {
		printRuntimeConfigUsage()
		return flag.ErrHelp
	}

	switch args[0] {
	case "init":
		return runRuntimeConfigInit(args[1:])
	case "get":
		return runRuntimeConfigGet(args[1:])
	case "set":
		return runRuntimeConfigSet(args[1:])
	case "validate":
		return runRuntimeConfigValidate(args[1:])
	default:
		printRuntimeConfigUsage()
		return flag.ErrHelp
	}
}

func runRuntimeConfigInit(args []string) error {
	fs := flag.NewFlagSet("nimi config init", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	jsonOutput := fs.Bool("json", false, "output json")
	force := fs.Bool("force", false, "overwrite existing config")
	if err := fs.Parse(args); err != nil {
		return err
	}

	path := strings.TrimSpace(config.RuntimeConfigPath())
	if path == "" {
		return newConfigCommandError(configReasonSchemaInvalid, "set HOME or NIMI_RUNTIME_CONFIG_PATH", fmt.Errorf("runtime config path is empty"))
	}

	_, statErr := os.Stat(path)
	exists := statErr == nil
	if statErr != nil && !errors.Is(statErr, os.ErrNotExist) {
		return newConfigCommandError(configReasonSchemaInvalid, "check runtime config path permissions", statErr)
	}

	created := false
	overwritten := false
	if !exists || *force {
		unlock, err := acquireConfigWriteLock(path)
		if err != nil {
			return err
		}
		defer unlock()

		if err := config.WriteFileConfig(path, config.DefaultFileConfig()); err != nil {
			if isSecretPolicyViolation(err) {
				return newConfigCommandError(configReasonSecretPolicyViolation, "remove plaintext apiKey and use apiKeyEnv", err)
			}
			return newConfigCommandError(configReasonSchemaInvalid, "run `nimi config validate`", err)
		}

		created = !exists
		overwritten = exists && *force
	}

	payload := map[string]any{
		"path":        path,
		"created":     created,
		"overwritten": overwritten,
	}
	return printConfigPayload(payload, *jsonOutput)
}

func runRuntimeConfigGet(args []string) error {
	fs := flag.NewFlagSet("nimi config get", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	jsonOutput := fs.Bool("json", false, "output json")
	if err := fs.Parse(args); err != nil {
		return err
	}

	path := strings.TrimSpace(config.RuntimeConfigPath())
	if strings.TrimSpace(path) == "" {
		return newConfigCommandError(configReasonSchemaInvalid, "set HOME or NIMI_RUNTIME_CONFIG_PATH", fmt.Errorf("runtime config path is empty"))
	}

	fileCfg, err := config.LoadFileConfig(path)
	if err != nil {
		return classifyConfigLoadError(err)
	}
	merged := mergeFileConfigWithDefaults(fileCfg)

	payload := map[string]any{
		"path":   path,
		"config": merged,
	}
	return printConfigPayload(payload, *jsonOutput)
}

func runRuntimeConfigValidate(args []string) error {
	fs := flag.NewFlagSet("nimi config validate", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	jsonOutput := fs.Bool("json", false, "output json")
	if err := fs.Parse(args); err != nil {
		return err
	}

	path := strings.TrimSpace(config.RuntimeConfigPath())
	if strings.TrimSpace(path) == "" {
		return newConfigCommandError(configReasonSchemaInvalid, "set HOME or NIMI_RUNTIME_CONFIG_PATH", fmt.Errorf("runtime config path is empty"))
	}

	fileCfg, err := config.LoadFileConfig(path)
	if err != nil {
		return classifyConfigLoadError(err)
	}
	merged := mergeFileConfigWithDefaults(fileCfg)

	if err := validateMergedRuntimeFields(merged); err != nil {
		if isSecretPolicyViolation(err) {
			return newConfigCommandError(configReasonSecretPolicyViolation, "remove plaintext apiKey and use apiKeyEnv", err)
		}
		return newConfigCommandError(configReasonSchemaInvalid, "run `nimi config init --force` or fix invalid fields", err)
	}

	payload := map[string]any{
		"valid": true,
		"path":  path,
	}
	return printConfigPayload(payload, *jsonOutput)
}

func runRuntimeConfigSet(args []string) error {
	fs := flag.NewFlagSet("nimi config set", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	jsonOutput := fs.Bool("json", false, "output json")
	fromStdin := fs.Bool("stdin", false, "read full config json payload from stdin")
	inputFile := fs.String("file", "", "read full config json payload from file")
	var setOps multiStringFlag
	var unsetOps multiStringFlag
	fs.Var(&setOps, "set", "set value, format: key=value")
	fs.Var(&unsetOps, "unset", "unset key")
	if err := fs.Parse(args); err != nil {
		return err
	}

	hasMutations := len(setOps.Values()) > 0 || len(unsetOps.Values()) > 0
	if !*fromStdin && strings.TrimSpace(*inputFile) == "" && !hasMutations {
		return newConfigCommandError(configReasonParseFailed, "pass --stdin, --file, --set, or --unset", fmt.Errorf("no mutation input provided"))
	}
	if *fromStdin && strings.TrimSpace(*inputFile) != "" {
		return newConfigCommandError(configReasonParseFailed, "use either --stdin or --file", fmt.Errorf("--stdin and --file cannot be used together"))
	}

	path := strings.TrimSpace(config.RuntimeConfigPath())
	if path == "" {
		return newConfigCommandError(configReasonSchemaInvalid, "set HOME or NIMI_RUNTIME_CONFIG_PATH", fmt.Errorf("runtime config path is empty"))
	}

	unlock, err := acquireConfigWriteLock(path)
	if err != nil {
		return err
	}
	defer unlock()

	mutated, err := loadConfigForMutation(path)
	if err != nil {
		return err
	}
	previous := cloneFileConfig(mutated)

	if *fromStdin || strings.TrimSpace(*inputFile) != "" {
		payloadBytes, readErr := readConfigInput(*fromStdin, strings.TrimSpace(*inputFile))
		if readErr != nil {
			return newConfigCommandError(configReasonParseFailed, "provide valid json input payload", readErr)
		}
		parsedCfg, parseErr := parseConfigInputJSON(payloadBytes)
		if parseErr != nil {
			return parseErr
		}
		mutated = parsedCfg
	}

	for _, raw := range setOps.Values() {
		key, value, parseErr := parseConfigSetAssignment(raw)
		if parseErr != nil {
			return newConfigCommandError(configReasonParseFailed, "use --set key=value", parseErr)
		}
		if err := applyConfigSetOperation(&mutated, key, value); err != nil {
			if isSecretPolicyViolation(err) {
				return newConfigCommandError(configReasonSecretPolicyViolation, "replace apiKey with apiKeyEnv", err)
			}
			return newConfigCommandError(configReasonSchemaInvalid, "run `nimi config validate`", err)
		}
	}

	for _, raw := range unsetOps.Values() {
		if err := applyConfigUnsetOperation(&mutated, raw); err != nil {
			return newConfigCommandError(configReasonSchemaInvalid, "run `nimi config validate`", err)
		}
	}

	if mutated.SchemaVersion == 0 {
		mutated.SchemaVersion = config.DefaultSchemaVersion
	}

	if err := config.ValidateFileConfig(mutated); err != nil {
		if isSecretPolicyViolation(err) {
			return newConfigCommandError(configReasonSecretPolicyViolation, "replace apiKey with apiKeyEnv", err)
		}
		return newConfigCommandError(configReasonSchemaInvalid, "run `nimi config validate`", err)
	}
	if err := validateMergedRuntimeFields(mutated); err != nil {
		return newConfigCommandError(configReasonSchemaInvalid, "run `nimi config validate`", err)
	}
	if err := config.WriteFileConfig(path, mutated); err != nil {
		if isSecretPolicyViolation(err) {
			return newConfigCommandError(configReasonSecretPolicyViolation, "replace apiKey with apiKeyEnv", err)
		}
		return newConfigCommandError(configReasonSchemaInvalid, "retry after fixing config payload", err)
	}

	reasonCode := configReasonApplied
	actionHint := ""
	if restartRequiredFieldsChanged(previous, mutated) {
		reasonCode = configReasonRestartRequired
		actionHint = "restart runtime to apply config changes"
	}

	payload := map[string]any{
		"path":       path,
		"reasonCode": reasonCode,
		"actionHint": actionHint,
		"config":     mutated,
	}
	return printConfigPayload(payload, *jsonOutput)
}

func classifyConfigLoadError(err error) error {
	if err == nil {
		return nil
	}
	if isSecretPolicyViolation(err) {
		return newConfigCommandError(configReasonSecretPolicyViolation, "replace apiKey with apiKeyEnv", err)
	}
	if strings.Contains(strings.ToLower(err.Error()), "parse runtime config file") {
		return newConfigCommandError(configReasonParseFailed, "run `nimi config validate`", err)
	}
	return newConfigCommandError(configReasonSchemaInvalid, "run `nimi config validate`", err)
}

func printConfigPayload(payload any, jsonOutput bool) error {
	var (
		raw []byte
		err error
	)
	if jsonOutput {
		raw, err = json.MarshalIndent(payload, "", "  ")
	} else {
		raw, err = json.Marshal(payload)
	}
	if err != nil {
		return err
	}
	fmt.Println(string(raw))
	return nil
}

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
	if v := strings.TrimSpace(raw.LocalRuntimeStatePath); v != "" {
		merged.LocalRuntimeStatePath = v
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
	case "localRuntimeStatePath":
		cfg.LocalRuntimeStatePath = value
		return nil
	case "localModelsPath":
		cfg.LocalModelsPath = value
		return nil
	case "workerMode":
		v := strings.ToLower(strings.TrimSpace(value)) == "true"
		cfg.WorkerMode = &v
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
		return fmt.Errorf("provider %q apiKey is forbidden; use apiKeyEnv", providerName)
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
	case "localRuntimeStatePath":
		cfg.LocalRuntimeStatePath = defaultCfg.LocalRuntimeStatePath
		return nil
	case "localModelsPath":
		cfg.LocalModelsPath = defaultCfg.LocalModelsPath
		return nil
	case "workerMode":
		cfg.WorkerMode = defaultCfg.WorkerMode
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
	default:
		return fmt.Errorf("unsupported unset key %q", key)
	}
	cfg.Providers[providerName] = target
	return nil
}

func acquireConfigWriteLock(configPath string) (func(), error) {
	lockPath := strings.TrimSpace(configPath) + ".lock"
	if err := os.MkdirAll(filepath.Dir(lockPath), 0o755); err != nil {
		return nil, newConfigCommandError(configReasonWriteLocked, "ensure config directory is writable", err)
	}
	file, err := os.OpenFile(lockPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		if errors.Is(err, os.ErrExist) {
			return nil, newConfigCommandError(configReasonWriteLocked, "retry after other config write completes", err)
		}
		return nil, newConfigCommandError(configReasonWriteLocked, "ensure config lock can be created", err)
	}
	invokeConfigWriteLockHook(lockPath)

	released := false
	release := func() {
		if released {
			return
		}
		released = true
		_ = file.Close()
		_ = os.Remove(lockPath)
	}
	return release, nil
}

func setConfigWriteLockHookForTest(hook func(lockPath string)) func() {
	configWriteLockHookMu.Lock()
	prev := configWriteLockHook
	configWriteLockHook = hook
	configWriteLockHookMu.Unlock()
	return func() {
		configWriteLockHookMu.Lock()
		configWriteLockHook = prev
		configWriteLockHookMu.Unlock()
	}
}

func invokeConfigWriteLockHook(lockPath string) {
	configWriteLockHookMu.RLock()
	hook := configWriteLockHook
	configWriteLockHookMu.RUnlock()
	if hook != nil {
		hook(lockPath)
	}
}

// restartRequiredFieldsChanged compares fields classified as restart-only in
// K-DAEMON-009. Changes to these fields require daemon restart to take effect.
func restartRequiredFieldsChanged(before, after config.FileConfig) bool {
	if strings.TrimSpace(before.GRPCAddr) != strings.TrimSpace(after.GRPCAddr) {
		return true
	}
	if strings.TrimSpace(before.HTTPAddr) != strings.TrimSpace(after.HTTPAddr) {
		return true
	}
	if strings.TrimSpace(before.LocalRuntimeStatePath) != strings.TrimSpace(after.LocalRuntimeStatePath) {
		return true
	}
	if strings.TrimSpace(before.LocalModelsPath) != strings.TrimSpace(after.LocalModelsPath) {
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

func pruneEmptyEnginesConfig(fileCfg *config.FileConfig) {
	if fileCfg == nil || fileCfg.Engines == nil {
		return
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
	return strings.TrimSpace(before.Version) == strings.TrimSpace(after.Version)
}

func isSecretPolicyViolation(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "apikey is forbidden")
}

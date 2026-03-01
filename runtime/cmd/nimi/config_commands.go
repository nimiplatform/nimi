package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/config"
)

const (
	configReasonParseFailed           = "CONFIG_PARSE_FAILED"
	configReasonSchemaInvalid         = "CONFIG_SCHEMA_INVALID"
	configReasonMigrationFailed       = "CONFIG_MIGRATION_FAILED"
	configReasonWriteLocked           = "CONFIG_WRITE_LOCKED"
	configReasonSecretPolicyViolation = "CONFIG_SECRET_POLICY_VIOLATION"
	configReasonRestartRequired       = "CONFIG_RESTART_REQUIRED"
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
	case "migrate":
		return runRuntimeConfigMigrate(args[1:])
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

	if _, _, err := config.MigrateLegacyConfig(); err != nil {
		return newConfigCommandError(configReasonMigrationFailed, "run `nimi config migrate`", err)
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

	path, err := config.ResolveRuntimeConfigPathForLoad()
	if err != nil {
		return newConfigCommandError(configReasonMigrationFailed, "run `nimi config migrate`", err)
	}
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

	path, err := config.ResolveRuntimeConfigPathForLoad()
	if err != nil {
		return newConfigCommandError(configReasonMigrationFailed, "run `nimi config migrate`", err)
	}
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

func runRuntimeConfigMigrate(args []string) error {
	fs := flag.NewFlagSet("nimi config migrate", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	jsonOutput := fs.Bool("json", false, "output json")
	if err := fs.Parse(args); err != nil {
		return err
	}

	migrated, path, err := config.MigrateLegacyConfig()
	if err != nil {
		return newConfigCommandError(configReasonMigrationFailed, "ensure legacy config is readable and retry", err)
	}
	payload := map[string]any{
		"migrated": migrated,
		"path":     path,
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

	if _, _, err := config.MigrateLegacyConfig(); err != nil {
		return newConfigCommandError(configReasonMigrationFailed, "run `nimi config migrate`", err)
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

	payload := map[string]any{
		"path":       path,
		"reasonCode": configReasonRestartRequired,
		"actionHint": "restart runtime to apply config changes",
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
	// Merge from flat or legacy nested keys.
	if v := raw.EffectiveGRPCAddr(); v != "" {
		merged.GRPCAddr = v
		merged.Runtime.GRPCAddr = v
	}
	if v := raw.EffectiveHTTPAddr(); v != "" {
		merged.HTTPAddr = v
		merged.Runtime.HTTPAddr = v
	}
	if v := raw.EffectiveShutdownTimeout(); v != "" {
		merged.ShutdownTimeout = v
		merged.Runtime.ShutdownTimeout = v
	}
	if v := raw.EffectiveLocalRuntimeStatePath(); v != "" {
		merged.LocalRuntimeStatePath = v
		merged.Runtime.LocalRuntimeStatePath = v
	}

	if v := raw.EffectiveAIHTTPTimeout(); v != "" {
		merged.AI.HTTPTimeout = v
	}
	if v := raw.EffectiveAIHealthInterval(); v != "" {
		merged.AI.HealthInterval = v
	}
	providers := raw.EffectiveProviders()
	mergedProviders := map[string]config.RuntimeFileTarget{}
	for k, v := range providers {
		mergedProviders[k] = v
	}
	merged.AI.Providers = mergedProviders
	return merged
}

func validateMergedRuntimeFields(fileCfg config.FileConfig) error {
	if err := config.ValidateFileConfig(fileCfg); err != nil {
		return err
	}

	if _, _, err := net.SplitHostPort(strings.TrimSpace(fileCfg.Runtime.GRPCAddr)); err != nil {
		return fmt.Errorf("runtime.grpcAddr invalid: %w", err)
	}
	if _, _, err := net.SplitHostPort(strings.TrimSpace(fileCfg.Runtime.HTTPAddr)); err != nil {
		return fmt.Errorf("runtime.httpAddr invalid: %w", err)
	}
	if _, err := time.ParseDuration(strings.TrimSpace(fileCfg.Runtime.ShutdownTimeout)); err != nil {
		return fmt.Errorf("runtime.shutdownTimeout invalid: %w", err)
	}
	if strings.TrimSpace(fileCfg.AI.HTTPTimeout) != "" {
		if _, err := time.ParseDuration(strings.TrimSpace(fileCfg.AI.HTTPTimeout)); err != nil {
			return fmt.Errorf("ai.httpTimeout invalid: %w", err)
		}
	}
	if strings.TrimSpace(fileCfg.AI.HealthInterval) != "" {
		if _, err := time.ParseDuration(strings.TrimSpace(fileCfg.AI.HealthInterval)); err != nil {
			return fmt.Errorf("ai.healthInterval invalid: %w", err)
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
	if err := json.Unmarshal(raw, &parsed); err != nil {
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
	case "runtime.grpcAddr":
		cfg.Runtime.GRPCAddr = value
		return nil
	case "runtime.httpAddr":
		cfg.Runtime.HTTPAddr = value
		return nil
	case "runtime.shutdownTimeout":
		cfg.Runtime.ShutdownTimeout = value
		return nil
	case "runtime.localRuntimeStatePath":
		cfg.Runtime.LocalRuntimeStatePath = value
		return nil
	case "ai.httpTimeout":
		cfg.AI.HTTPTimeout = value
		return nil
	case "ai.healthInterval":
		cfg.AI.HealthInterval = value
		return nil
	}

	parts := strings.Split(normalizedKey, ".")
	if len(parts) != 4 || parts[0] != "ai" || parts[1] != "providers" {
		return fmt.Errorf("unsupported config key %q", key)
	}
	providerName := strings.TrimSpace(parts[2])
	providerField := strings.TrimSpace(parts[3])
	if providerName == "" {
		return fmt.Errorf("provider name cannot be empty")
	}
	if cfg.AI.Providers == nil {
		cfg.AI.Providers = map[string]config.RuntimeFileTarget{}
	}
	target := cfg.AI.Providers[providerName]
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
	cfg.AI.Providers[providerName] = target
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
	case "runtime.grpcAddr":
		cfg.Runtime.GRPCAddr = defaultCfg.Runtime.GRPCAddr
		return nil
	case "runtime.httpAddr":
		cfg.Runtime.HTTPAddr = defaultCfg.Runtime.HTTPAddr
		return nil
	case "runtime.shutdownTimeout":
		cfg.Runtime.ShutdownTimeout = defaultCfg.Runtime.ShutdownTimeout
		return nil
	case "runtime.localRuntimeStatePath":
		cfg.Runtime.LocalRuntimeStatePath = defaultCfg.Runtime.LocalRuntimeStatePath
		return nil
	case "ai.httpTimeout":
		cfg.AI.HTTPTimeout = defaultCfg.AI.HTTPTimeout
		return nil
	case "ai.healthInterval":
		cfg.AI.HealthInterval = defaultCfg.AI.HealthInterval
		return nil
	}

	parts := strings.Split(normalizedKey, ".")
	if len(parts) < 3 || parts[0] != "ai" || parts[1] != "providers" {
		return fmt.Errorf("unsupported unset key %q", key)
	}
	providerName := strings.TrimSpace(parts[2])
	if providerName == "" {
		return fmt.Errorf("provider name cannot be empty")
	}
	if cfg.AI.Providers == nil {
		cfg.AI.Providers = map[string]config.RuntimeFileTarget{}
	}

	if len(parts) == 3 {
		delete(cfg.AI.Providers, providerName)
		return nil
	}
	if len(parts) != 4 {
		return fmt.Errorf("unsupported unset key %q", key)
	}
	target := cfg.AI.Providers[providerName]
	switch strings.TrimSpace(parts[3]) {
	case "baseUrl":
		target.BaseURL = ""
	case "apiKeyEnv":
		target.APIKeyEnv = ""
	case "apiKey":
		target.APIKey = ""
	default:
		return fmt.Errorf("unsupported unset key %q", key)
	}
	cfg.AI.Providers[providerName] = target
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

func isSecretPolicyViolation(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "apikey is forbidden")
}

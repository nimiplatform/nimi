package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
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
				return newConfigCommandError(configReasonSecretPolicyViolation, "use either apiKey or apiKeyEnv", err)
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
	if path == "" {
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
	if path == "" {
		return newConfigCommandError(configReasonSchemaInvalid, "set HOME or NIMI_RUNTIME_CONFIG_PATH", fmt.Errorf("runtime config path is empty"))
	}

	fileCfg, err := config.LoadFileConfig(path)
	if err != nil {
		return classifyConfigLoadError(err)
	}
	merged := mergeFileConfigWithDefaults(fileCfg)

	if err := validateMergedRuntimeFields(merged); err != nil {
		if isSecretPolicyViolation(err) {
			return newConfigCommandError(configReasonSecretPolicyViolation, "use either apiKey or apiKeyEnv", err)
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
				return newConfigCommandError(configReasonSecretPolicyViolation, "use either apiKey or apiKeyEnv", err)
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
			return newConfigCommandError(configReasonSecretPolicyViolation, "use either apiKey or apiKeyEnv", err)
		}
		return newConfigCommandError(configReasonSchemaInvalid, "run `nimi config validate`", err)
	}
	if err := validateMergedRuntimeFields(mutated); err != nil {
		return newConfigCommandError(configReasonSchemaInvalid, "run `nimi config validate`", err)
	}
	if err := config.WriteFileConfig(path, mutated); err != nil {
		if isSecretPolicyViolation(err) {
			return newConfigCommandError(configReasonSecretPolicyViolation, "use either apiKey or apiKeyEnv", err)
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
		return newConfigCommandError(configReasonSecretPolicyViolation, "use either apiKey or apiKeyEnv", err)
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

package main

import (
	"encoding/json"
	"errors"
	"flag"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/config"
)

func TestRunRuntimeConfigInitGetValidate(t *testing.T) {
	homeDir := t.TempDir()
	setCmdTestHome(t, homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", "")
	clearRuntimeConfigCommandEnv(t)

	initOutput, err := captureStdoutFromRun(func() error {
		return runRuntimeConfig([]string{"init", "--json"})
	})
	if err != nil {
		t.Fatalf("runRuntimeConfig init: %v", err)
	}
	initPayload := parseJSONMap(t, initOutput)
	configPath := asString(initPayload["path"])
	if configPath != cmdTestPortableConfigPath(homeDir) {
		t.Fatalf("config path mismatch: got=%q", configPath)
	}
	if _, statErr := os.Stat(configPath); statErr != nil {
		t.Fatalf("config file missing after init: %v", statErr)
	}

	getOutput, err := captureStdoutFromRun(func() error {
		return runRuntimeConfig([]string{"get", "--json"})
	})
	if err != nil {
		t.Fatalf("runRuntimeConfig get: %v", err)
	}
	getPayload := parseJSONMap(t, getOutput)
	cfg, ok := getPayload["config"].(map[string]any)
	if !ok {
		t.Fatalf("config payload missing: %s", getOutput)
	}
	if int(asFloat(cfg["schemaVersion"])) != 1 {
		t.Fatalf("schema version mismatch: %#v", cfg["schemaVersion"])
	}

	validateOutput, err := captureStdoutFromRun(func() error {
		return runRuntimeConfig([]string{"validate", "--json"})
	})
	if err != nil {
		t.Fatalf("runRuntimeConfig validate: %v", err)
	}
	validatePayload := parseJSONMap(t, validateOutput)
	if validatePayload["valid"] != true {
		t.Fatalf("validate payload mismatch: %s", validateOutput)
	}
}

func TestRunRuntimeConfigUnavailableWithoutExplicitPortablePath(t *testing.T) {
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", "")

	err := runRuntimeConfig([]string{"get", "--json"})
	if err == nil || !strings.Contains(err.Error(), "portable Runtime config is unavailable") {
		t.Fatalf("config get error = %v, want explicit portable-config requirement", err)
	}
}

func TestRunRuntimeConfigSetRejectsProviderCustodyMutation(t *testing.T) {
	homeDir := t.TempDir()
	setCmdTestHome(t, homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", "")
	clearRuntimeConfigCommandEnv(t)

	if err := runRuntimeConfig([]string{"init", "--json"}); err != nil {
		t.Fatalf("init config: %v", err)
	}

	err := runRuntimeConfig([]string{
		"set",
		"--set", "providers.gemini.apiKeyEnv=NIMI_RUNTIME_CLOUD_GEMINI_API_KEY",
		"--json",
	})
	if err == nil || !strings.Contains(err.Error(), configReasonSchemaInvalid) || !strings.Contains(err.Error(), "unsupported config key") {
		t.Fatalf("provider key mutation error = %v", err)
	}

	cfgPath := cmdTestPortableConfigPath(homeDir)
	cfg, loadErr := config.LoadFileConfig(cfgPath)
	if loadErr != nil {
		t.Fatalf("LoadFileConfig: %v", loadErr)
	}
	if len(cfg.Providers) != 0 {
		t.Fatalf("rejected provider key mutation persisted: %#v", cfg.Providers)
	}

	inputPath := filepath.Join(t.TempDir(), "provider-config.json")
	input := `{"schemaVersion":1,"providers":{"gemini":{"apiKey":"plaintext"}}}`
	if writeErr := os.WriteFile(inputPath, []byte(input), 0o600); writeErr != nil {
		t.Fatal(writeErr)
	}
	err = runRuntimeConfig([]string{"set", "--file", inputPath, "--json"})
	if err == nil || !strings.Contains(err.Error(), configReasonSchemaInvalid) || !strings.Contains(err.Error(), "protected Connector") {
		t.Fatalf("full provider custody mutation error = %v", err)
	}

	cfg, loadErr = config.LoadFileConfig(cfgPath)
	if loadErr != nil {
		t.Fatalf("LoadFileConfig reload: %v", loadErr)
	}
	if len(cfg.Providers) != 0 {
		t.Fatalf("rejected full provider mutation persisted: %#v", cfg.Providers)
	}
}

func TestRunRuntimeConfigSetEngineFieldsRequiresRestart(t *testing.T) {
	homeDir := t.TempDir()
	setCmdTestHome(t, homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", "")
	clearRuntimeConfigCommandEnv(t)

	if err := runRuntimeConfig([]string{"init", "--json"}); err != nil {
		t.Fatalf("init config: %v", err)
	}

	setOutput, err := captureStdoutFromRun(func() error {
		return runRuntimeConfig([]string{
			"set",
			"--set", "engines.llama.enabled=true",
			"--set", "engines.llama.port=2234",
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeConfig set engines.llama.*: %v", err)
	}
	setPayload := parseJSONMap(t, setOutput)
	if asString(setPayload["reasonCode"]) != configReasonRestartRequired {
		t.Fatalf("set reasonCode mismatch: %s", setOutput)
	}

	cfgPath := cmdTestPortableConfigPath(homeDir)
	cfg, loadErr := config.LoadFileConfig(cfgPath)
	if loadErr != nil {
		t.Fatalf("LoadFileConfig: %v", loadErr)
	}
	if cfg.Engines == nil || cfg.Engines.Llama == nil || cfg.Engines.Llama.Enabled == nil {
		t.Fatalf("engines.llama.enabled should be persisted: %#v", cfg.Engines)
	}
	if !*cfg.Engines.Llama.Enabled {
		t.Fatalf("engines.llama.enabled value mismatch: got=%v", *cfg.Engines.Llama.Enabled)
	}
	if cfg.Engines.Llama.Port == nil || *cfg.Engines.Llama.Port != 2234 {
		t.Fatalf("engines.llama.port value mismatch: %#v", cfg.Engines.Llama.Port)
	}
}

func TestRunRuntimeConfigRejectsProductControlOwnedDataRootFields(t *testing.T) {
	homeDir := t.TempDir()
	setCmdTestHome(t, homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", "")
	clearRuntimeConfigCommandEnv(t)

	if err := runRuntimeConfig([]string{"init", "--json"}); err != nil {
		t.Fatalf("init config: %v", err)
	}

	fields := []string{
		"dataRootRef",
		"localModelsPath",
		"managedRoots.models",
		"managedRoots.dependencies",
		"managedRoots.environments",
		"managedRoots.apps",
		"managedRoots.accounts",
		"managedRoots.logs",
		"managedRoots.audit",
	}
	for _, field := range fields {
		t.Run("set "+field, func(t *testing.T) {
			err := runRuntimeConfig([]string{"set", "--set", field + "=C:\\user-selected-second-root", "--json"})
			if err == nil || !strings.Contains(err.Error(), "Product Control") {
				t.Fatalf("set %s error = %v", field, err)
			}
		})
		t.Run("unset "+field, func(t *testing.T) {
			err := runRuntimeConfig([]string{"set", "--unset", field, "--json"})
			if err == nil || !strings.Contains(err.Error(), "Product Control") {
				t.Fatalf("unset %s error = %v", field, err)
			}
		})
	}

	cfgPath := cmdTestPortableConfigPath(homeDir)
	cfg, loadErr := config.LoadFileConfig(cfgPath)
	if loadErr != nil {
		t.Fatalf("LoadFileConfig: %v", loadErr)
	}
	if cfg.DataRootRef != "" {
		t.Fatalf("rejected dataRootRef mutation persisted: got=%q", cfg.DataRootRef)
	}
	if cfg.ManagedRoots != nil &&
		(strings.TrimSpace(cfg.ManagedRoots.Models) != "" ||
			strings.TrimSpace(cfg.ManagedRoots.Dependencies) != "" ||
			strings.TrimSpace(cfg.ManagedRoots.Environments) != "" ||
			strings.TrimSpace(cfg.ManagedRoots.Apps) != "" ||
			strings.TrimSpace(cfg.ManagedRoots.Accounts) != "" ||
			strings.TrimSpace(cfg.ManagedRoots.Logs) != "" ||
			strings.TrimSpace(cfg.ManagedRoots.Audit) != "") {
		t.Fatalf("rejected managedRoots mutation persisted: %#v", cfg.ManagedRoots)
	}
}

func TestRunRuntimeConfigRejectsFullDocumentDataRootMutation(t *testing.T) {
	homeDir := t.TempDir()
	setCmdTestHome(t, homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", "")
	clearRuntimeConfigCommandEnv(t)

	if err := runRuntimeConfig([]string{"init", "--json"}); err != nil {
		t.Fatalf("init config: %v", err)
	}
	inputPath := filepath.Join(t.TempDir(), "mutated-config.json")
	input := `{
  "schemaVersion": 1,
  "dataRootRef": "C:\\caller-selected-root",
  "managedRoots": {
    "models": "C:\\caller-selected-root\\models",
    "dependencies": "C:\\caller-selected-root\\dependencies",
    "environments": "C:\\caller-selected-root\\environments",
    "apps": "C:\\caller-selected-root\\apps",
    "accounts": "C:\\caller-selected-root\\accounts",
    "logs": "C:\\caller-selected-root\\logs",
    "audit": "C:\\caller-selected-root\\audit"
  }
}`
	if err := os.WriteFile(inputPath, []byte(input), 0o600); err != nil {
		t.Fatal(err)
	}
	err := runRuntimeConfig([]string{"set", "--file", inputPath, "--json"})
	if err == nil || !strings.Contains(err.Error(), "Product Control-owned") {
		t.Fatalf("full-document data-root mutation error = %v", err)
	}
	cfg, loadErr := config.LoadFileConfig(cmdTestPortableConfigPath(homeDir))
	if loadErr != nil {
		t.Fatal(loadErr)
	}
	if cfg.DataRootRef != "" {
		t.Fatalf("rejected full-document dataRootRef persisted: %q", cfg.DataRootRef)
	}
}

func TestRunRuntimeConfigSetLocalModelsPathRejected(t *testing.T) {
	homeDir := t.TempDir()
	setCmdTestHome(t, homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", "")
	clearRuntimeConfigCommandEnv(t)

	if err := runRuntimeConfig([]string{"init", "--json"}); err != nil {
		t.Fatalf("init config: %v", err)
	}

	err := runRuntimeConfig([]string{
		"set",
		"--set", "localModelsPath=~/runtime/models",
		"--json",
	})
	if err == nil {
		t.Fatalf("expected localModelsPath rejection")
	}
	if !strings.Contains(err.Error(), "localModelsPath is Product Control-derived") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestRunRuntimeConfigSetAuthJWTFieldsRequireRestart(t *testing.T) {
	homeDir := t.TempDir()
	setCmdTestHome(t, homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", "")
	clearRuntimeConfigCommandEnv(t)

	if err := runRuntimeConfig([]string{"init", "--json"}); err != nil {
		t.Fatalf("init config: %v", err)
	}

	setOutput, err := captureStdoutFromRun(func() error {
		return runRuntimeConfig([]string{
			"set",
			"--set", "auth.jwt.jwksUrl=https://realm.nimi.ai/api/auth/jwks",
			"--set", "auth.jwt.revocationUrl=https://realm.nimi.ai/api/auth/sessions/introspect",
			"--set", "auth.jwt.issuer=https://realm.nimi.ai",
			"--set", "auth.jwt.audience=nimi-runtime",
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeConfig set auth.jwt.*: %v", err)
	}
	setPayload := parseJSONMap(t, setOutput)
	if asString(setPayload["reasonCode"]) != configReasonRestartRequired {
		t.Fatalf("set reasonCode mismatch: %s", setOutput)
	}

	cfgPath := cmdTestPortableConfigPath(homeDir)
	cfg, loadErr := config.LoadFileConfig(cfgPath)
	if loadErr != nil {
		t.Fatalf("LoadFileConfig: %v", loadErr)
	}
	if cfg.Auth == nil || cfg.Auth.JWT == nil {
		t.Fatalf("auth.jwt config should exist after set: %#v", cfg.Auth)
	}
	if cfg.Auth.JWT.JWKSURL != "https://realm.nimi.ai/api/auth/jwks" {
		t.Fatalf("jwksUrl mismatch: %q", cfg.Auth.JWT.JWKSURL)
	}
	if cfg.Auth.JWT.RevocationURL != "https://realm.nimi.ai/api/auth/sessions/introspect" {
		t.Fatalf("revocationUrl mismatch: %q", cfg.Auth.JWT.RevocationURL)
	}
	if cfg.Auth.JWT.Issuer != "https://realm.nimi.ai" {
		t.Fatalf("issuer mismatch: %q", cfg.Auth.JWT.Issuer)
	}
	if cfg.Auth.JWT.Audience != "nimi-runtime" {
		t.Fatalf("audience mismatch: %q", cfg.Auth.JWT.Audience)
	}
}

func TestRunRuntimeConfigUnsetAuthJWTFieldsPrunesObject(t *testing.T) {
	homeDir := t.TempDir()
	setCmdTestHome(t, homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", "")
	clearRuntimeConfigCommandEnv(t)

	if err := runRuntimeConfig([]string{"init", "--json"}); err != nil {
		t.Fatalf("init config: %v", err)
	}

	if err := runRuntimeConfig([]string{
		"set",
		"--set", "auth.jwt.jwksUrl=https://realm.nimi.ai/api/auth/jwks",
		"--set", "auth.jwt.revocationUrl=https://realm.nimi.ai/api/auth/sessions/introspect",
		"--set", "auth.jwt.issuer=https://realm.nimi.ai",
		"--set", "auth.jwt.audience=nimi-runtime",
		"--json",
	}); err != nil {
		t.Fatalf("set auth.jwt.*: %v", err)
	}

	unsetOutput, err := captureStdoutFromRun(func() error {
		return runRuntimeConfig([]string{
			"set",
			"--unset", "auth.jwt.jwksUrl",
			"--unset", "auth.jwt.revocationUrl",
			"--unset", "auth.jwt.issuer",
			"--unset", "auth.jwt.audience",
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("unset auth.jwt.*: %v", err)
	}
	unsetPayload := parseJSONMap(t, unsetOutput)
	if asString(unsetPayload["reasonCode"]) != configReasonRestartRequired {
		t.Fatalf("unset reasonCode mismatch: %s", unsetOutput)
	}

	cfgPath := cmdTestPortableConfigPath(homeDir)
	cfg, loadErr := config.LoadFileConfig(cfgPath)
	if loadErr != nil {
		t.Fatalf("LoadFileConfig: %v", loadErr)
	}
	if cfg.Auth != nil {
		t.Fatalf("auth block should be pruned when all jwt fields unset: %#v", cfg.Auth)
	}
}

func TestRunRuntimeConfigSetRejectsRetiredDeveloperRegistrationKey(t *testing.T) {
	homeDir := t.TempDir()
	setCmdTestHome(t, homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", "")
	clearRuntimeConfigCommandEnv(t)

	if err := runRuntimeConfig([]string{"init", "--json"}); err != nil {
		t.Fatalf("init config: %v", err)
	}

	_, err := captureStdoutFromRun(func() error {
		return runRuntimeConfig([]string{
			"set",
			"--set", "auth.developerRegistration.enabled=true",
			"--json",
		})
	})
	if err == nil || !strings.Contains(err.Error(), "unsupported config key") {
		t.Fatalf("retired developer-registration key must be rejected, got %v", err)
	}
}

func TestRunRuntimeConfigSetRejectsInvalidJwksURL(t *testing.T) {
	homeDir := t.TempDir()
	setCmdTestHome(t, homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", "")
	clearRuntimeConfigCommandEnv(t)

	if err := runRuntimeConfig([]string{"init", "--json"}); err != nil {
		t.Fatalf("init config: %v", err)
	}

	err := runRuntimeConfig([]string{
		"set",
		"--set", "auth.jwt.jwksUrl=ftp://realm.nimi.ai/jwks.json",
		"--json",
	})
	if err == nil {
		t.Fatalf("expected schema invalid error for bad jwksUrl")
	}
	if !strings.Contains(err.Error(), configReasonSchemaInvalid) {
		t.Fatalf("expected %s, got %v", configReasonSchemaInvalid, err)
	}
}

func TestRunRuntimeConfigSetAcceptsLoopbackHTTPJWKSURL(t *testing.T) {
	homeDir := t.TempDir()
	setCmdTestHome(t, homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", "")
	clearRuntimeConfigCommandEnv(t)

	if err := runRuntimeConfig([]string{"init", "--json"}); err != nil {
		t.Fatalf("init config: %v", err)
	}

	if err := runRuntimeConfig([]string{
		"set",
		"--set", "auth.jwt.jwksUrl=http://localhost:3002/api/auth/jwks",
		"--set", "auth.jwt.revocationUrl=http://localhost:3002/api/auth/sessions/introspect",
		"--set", "auth.jwt.issuer=http://localhost:3002",
		"--set", "auth.jwt.audience=nimi-runtime",
		"--json",
	}); err != nil {
		t.Fatalf("expected loopback http jwks url to be accepted, got: %v", err)
	}

	cfgPath := cmdTestPortableConfigPath(homeDir)
	cfg, loadErr := config.LoadFileConfig(cfgPath)
	if loadErr != nil {
		t.Fatalf("LoadFileConfig: %v", loadErr)
	}
	if cfg.Auth == nil || cfg.Auth.JWT == nil {
		t.Fatalf("auth.jwt config should exist after set: %#v", cfg.Auth)
	}
	if cfg.Auth.JWT.JWKSURL != "http://localhost:3002/api/auth/jwks" {
		t.Fatalf("jwksUrl mismatch: %q", cfg.Auth.JWT.JWKSURL)
	}
	if cfg.Auth.JWT.RevocationURL != "http://localhost:3002/api/auth/sessions/introspect" {
		t.Fatalf("revocationUrl mismatch: %q", cfg.Auth.JWT.RevocationURL)
	}
}

func TestRunRuntimeConfigRejectsMigrateSubcommand(t *testing.T) {
	homeDir := t.TempDir()
	setCmdTestHome(t, homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", "")
	clearRuntimeConfigCommandEnv(t)

	err := runRuntimeConfig([]string{"migrate", "--json"})
	if !errors.Is(err, flag.ErrHelp) {
		t.Fatalf("migrate should be rejected as unsupported subcommand, got: %v", err)
	}
}

func TestRunRuntimeConfigSetReturnsWriteLocked(t *testing.T) {
	homeDir := t.TempDir()
	setCmdTestHome(t, homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", "")
	clearRuntimeConfigCommandEnv(t)

	if err := runRuntimeConfig([]string{"init", "--json"}); err != nil {
		t.Fatalf("init config: %v", err)
	}

	cfgPath := cmdTestPortableConfigPath(homeDir)
	lockPath := cfgPath + ".lock"
	if err := os.WriteFile(lockPath, []byte("lock"), 0o600); err != nil {
		t.Fatalf("write lock file: %v", err)
	}

	err := runRuntimeConfig([]string{
		"set",
		"--set", "grpcAddr=127.0.0.1:50099",
	})
	if err == nil {
		t.Fatalf("expected write lock error")
	}
	if !strings.Contains(err.Error(), configReasonWriteLocked) {
		t.Fatalf("expected %s, got %v", configReasonWriteLocked, err)
	}
}

func TestRunRuntimeConfigSetConcurrentWriteConflict(t *testing.T) {
	homeDir := t.TempDir()
	setCmdTestHome(t, homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", "")
	clearRuntimeConfigCommandEnv(t)

	if err := runRuntimeConfig([]string{"init", "--json"}); err != nil {
		t.Fatalf("init config: %v", err)
	}

	lockAcquired := make(chan struct{})
	releaseLock := make(chan struct{})
	var blockOnce sync.Once
	restoreHook := setConfigWriteLockHookForTest(func(_ string) {
		blockOnce.Do(func() {
			close(lockAcquired)
			<-releaseLock
		})
	})
	defer restoreHook()

	firstErrCh := make(chan error, 1)
	go func() {
		firstErrCh <- runRuntimeConfig([]string{
			"set",
			"--set", "grpcAddr=127.0.0.1:50101",
			"--json",
		})
	}()

	<-lockAcquired

	secondErr := runRuntimeConfig([]string{
		"set",
		"--set", "grpcAddr=127.0.0.1:50102",
		"--json",
	})
	if secondErr == nil {
		t.Fatalf("expected concurrent write lock error")
	}
	if !strings.Contains(secondErr.Error(), configReasonWriteLocked) {
		t.Fatalf("expected %s, got %v", configReasonWriteLocked, secondErr)
	}

	close(releaseLock)

	firstErr := <-firstErrCh
	if firstErr != nil {
		t.Fatalf("first set should succeed, got: %v", firstErr)
	}

	cfgPath := cmdTestPortableConfigPath(homeDir)
	fileCfg, err := config.LoadFileConfig(cfgPath)
	if err != nil {
		t.Fatalf("LoadFileConfig after concurrent set: %v", err)
	}
	if fileCfg.SchemaVersion != config.DefaultSchemaVersion {
		t.Fatalf("schema version mismatch: got=%d want=%d", fileCfg.SchemaVersion, config.DefaultSchemaVersion)
	}
	if fileCfg.GRPCAddr != "127.0.0.1:50101" {
		t.Fatalf("grpc addr mismatch after concurrent set: %q", fileCfg.GRPCAddr)
	}
}

func TestAcquireConfigWriteLockRemovesStalePIDLock(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "config.json")
	lockPath := configPath + ".lock"
	staleLock := configWriteLockMetadata{
		PID:       99999999,
		CreatedAt: time.Now().Add(-configWriteLockStaleAfter).UTC().Format(time.RFC3339Nano),
	}
	raw, err := json.Marshal(staleLock)
	if err != nil {
		t.Fatalf("marshal stale lock: %v", err)
	}
	if err := os.WriteFile(lockPath, raw, 0o600); err != nil {
		t.Fatalf("write stale lock: %v", err)
	}

	release, err := acquireConfigWriteLock(configPath)
	if err != nil {
		t.Fatalf("acquireConfigWriteLock: %v", err)
	}
	defer release()

	metadata, _, err := readConfigWriteLockMetadata(lockPath)
	if err != nil {
		t.Fatalf("readConfigWriteLockMetadata: %v", err)
	}
	if metadata == nil || metadata.PID != os.Getpid() {
		t.Fatalf("lock metadata mismatch: %#v", metadata)
	}
}

func TestRunRuntimeConfigValidateFailsOnInvalidSchema(t *testing.T) {
	homeDir := t.TempDir()
	setCmdTestHome(t, homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", "")
	clearRuntimeConfigCommandEnv(t)

	cfgPath := cmdTestPortableConfigPath(homeDir)
	if err := os.MkdirAll(filepath.Dir(cfgPath), 0o755); err != nil {
		t.Fatalf("mkdir config dir: %v", err)
	}
	invalid := `{
  "schemaVersion": 2,
  "providers": {
    "gemini": {
      "apiKeyEnv": "NIMI_RUNTIME_CLOUD_GEMINI_API_KEY"
    }
  }
}`
	if err := os.WriteFile(cfgPath, []byte(invalid), 0o600); err != nil {
		t.Fatalf("write invalid config: %v", err)
	}

	err := runRuntimeConfig([]string{"validate", "--json"})
	if err == nil {
		t.Fatalf("expected schema invalid error")
	}
	if !strings.Contains(err.Error(), configReasonSchemaInvalid) {
		t.Fatalf("expected %s, got %v", configReasonSchemaInvalid, err)
	}
}

func parseJSONMap(t *testing.T, raw string) map[string]any {
	t.Helper()
	parsed := map[string]any{}
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		t.Fatalf("parse json output: %v output=%q", err, raw)
	}
	return parsed
}

func clearRuntimeConfigCommandEnv(t *testing.T) {
	t.Helper()
	keys := []string{
		"NIMI_RUNTIME_GRPC_ADDR",
		"NIMI_RUNTIME_HTTP_ADDR",
		"NIMI_RUNTIME_SHUTDOWN_TIMEOUT",
		"NIMI_RUNTIME_LOCAL_STATE_PATH",
		"NIMI_RUNTIME_LOCAL_MODELS_PATH",
		"NIMI_RUNTIME_AI_HTTP_TIMEOUT",
		"NIMI_RUNTIME_AI_HEALTH_INTERVAL",
		"NIMI_RUNTIME_LOCAL_AI_BASE_URL",
		"NIMI_RUNTIME_LOCAL_AI_API_KEY",
		"NIMI_RUNTIME_LOCAL_NEXA_BASE_URL",
		"NIMI_RUNTIME_LOCAL_NEXA_API_KEY",
		"NIMI_RUNTIME_LOCAL_NIMI_MEDIA_BASE_URL",
		"NIMI_RUNTIME_LOCAL_NIMI_MEDIA_API_KEY",
		"NIMI_RUNTIME_CLOUD_NIMILLM_BASE_URL",
		"NIMI_RUNTIME_CLOUD_NIMILLM_API_KEY",
		"NIMI_RUNTIME_CLOUD_OPENAI_BASE_URL",
		"NIMI_RUNTIME_CLOUD_OPENAI_API_KEY",
		"NIMI_RUNTIME_CLOUD_ANTHROPIC_BASE_URL",
		"NIMI_RUNTIME_CLOUD_ANTHROPIC_API_KEY",
		"NIMI_RUNTIME_CLOUD_DASHSCOPE_BASE_URL",
		"NIMI_RUNTIME_CLOUD_DASHSCOPE_API_KEY",
		"NIMI_RUNTIME_CLOUD_VOLCENGINE_BASE_URL",
		"NIMI_RUNTIME_CLOUD_VOLCENGINE_API_KEY",
		"NIMI_RUNTIME_CLOUD_VOLCENGINE_OPENSPEECH_BASE_URL",
		"NIMI_RUNTIME_CLOUD_VOLCENGINE_OPENSPEECH_API_KEY",
		"NIMI_RUNTIME_CLOUD_GEMINI_BASE_URL",
		"NIMI_RUNTIME_CLOUD_GEMINI_API_KEY",
		"NIMI_RUNTIME_CLOUD_MINIMAX_BASE_URL",
		"NIMI_RUNTIME_CLOUD_MINIMAX_API_KEY",
		"NIMI_RUNTIME_CLOUD_MIMO_BASE_URL",
		"NIMI_RUNTIME_CLOUD_MIMO_API_KEY",
		"NIMI_RUNTIME_CLOUD_KIMI_BASE_URL",
		"NIMI_RUNTIME_CLOUD_KIMI_API_KEY",
		"NIMI_RUNTIME_CLOUD_GLM_BASE_URL",
		"NIMI_RUNTIME_CLOUD_GLM_API_KEY",
		"NIMI_RUNTIME_CLOUD_DEEPSEEK_BASE_URL",
		"NIMI_RUNTIME_CLOUD_DEEPSEEK_API_KEY",
		"NIMI_RUNTIME_CLOUD_OPENROUTER_BASE_URL",
		"NIMI_RUNTIME_CLOUD_OPENROUTER_API_KEY",
		"NIMI_RUNTIME_CLOUD_OPENAI_COMPATIBLE_BASE_URL",
		"NIMI_RUNTIME_CLOUD_OPENAI_COMPATIBLE_API_KEY",
		"NIMI_RUNTIME_AUTH_JWT_ISSUER",
		"NIMI_RUNTIME_AUTH_JWT_AUDIENCE",
		"NIMI_RUNTIME_AUTH_JWT_JWKS_URL",
		"NIMI_RUNTIME_AUTH_JWT_REVOCATION_URL",
		"NIMI_RUNTIME_ENGINE_LOCALAI_ENABLED",
		"NIMI_RUNTIME_ENGINE_LOCALAI_VERSION",
		"NIMI_RUNTIME_ENGINE_LOCALAI_PORT",
		"NIMI_RUNTIME_ENGINE_LOCALAI_IMAGE_BACKEND_MODE",
		"NIMI_RUNTIME_ENGINE_LOCALAI_IMAGE_BACKEND_NAME",
		"NIMI_RUNTIME_ENGINE_LOCALAI_IMAGE_BACKEND_ADDRESS",
		"NIMI_RUNTIME_ENGINE_LOCALAI_IMAGE_BACKEND_COMMAND",
		"NIMI_RUNTIME_ENGINE_LOCALAI_IMAGE_BACKEND_ARGS_JSON",
		"NIMI_RUNTIME_ENGINE_LOCALAI_IMAGE_BACKEND_ENV_JSON",
		"NIMI_RUNTIME_ENGINE_LOCALAI_IMAGE_BACKEND_WORKING_DIR",
		"NIMI_RUNTIME_ENGINE_NEXA_ENABLED",
		"NIMI_RUNTIME_ENGINE_NEXA_VERSION",
		"NIMI_RUNTIME_ENGINE_NEXA_PORT",
	}
	for _, key := range keys {
		t.Setenv(key, "")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatalf("resolve test home: %v", err)
	}
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", cmdTestPortableConfigPath(home))
}

package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	DefaultSchemaVersion            = 1
	defaultGRPCAddr                 = "127.0.0.1:46371"
	defaultHTTPAddr                 = "127.0.0.1:46372"
	defaultLocalRuntimeStateRelPath = ".nimi/runtime/local-runtime-state.json"
	defaultRuntimeConfigRelPath     = ".nimi/config.json"
	legacyRuntimeConfigRelPath      = ".nimi/runtime/config.json"
	defaultCloudGeminiBaseURL       = "https://generativelanguage.googleapis.com/v1beta/openai"
)

// Config defines daemon boot configuration.
type Config struct {
	GRPCAddr              string
	HTTPAddr              string
	ShutdownTimeout       time.Duration
	LocalRuntimeStatePath string

	// AllowLoopbackProviderEndpoint permits HTTP (non-TLS) connections to
	// loopback addresses (127.0.0.0/8, ::1, localhost) for provider endpoints.
	// Default: false. (K-SEC-002, K-DAEMON-009)
	AllowLoopbackProviderEndpoint bool

	// SessionTTLMinSeconds is the minimum TTL in seconds allowed for auth
	// sessions. Requests below this bound are rejected. Default: 60. (K-AUTHSVC-004)
	SessionTTLMinSeconds int

	// SessionTTLMaxSeconds is the maximum TTL in seconds allowed for auth
	// sessions. Requests above this bound are rejected. Default: 86400. (K-AUTHSVC-004)
	SessionTTLMaxSeconds int
}

type FileConfig struct {
	SchemaVersion int                 `json:"schemaVersion"`
	Runtime       RuntimeFileConfig   `json:"runtime"`
	AI            RuntimeFileAIConfig `json:"ai"`
}

type RuntimeFileConfig struct {
	GRPCAddr              string `json:"grpcAddr"`
	HTTPAddr              string `json:"httpAddr"`
	ShutdownTimeout       string `json:"shutdownTimeout"`
	LocalRuntimeStatePath string `json:"localRuntimeStatePath"`
}

type RuntimeFileAIConfig struct {
	HTTPTimeout    string                       `json:"httpTimeout"`
	HealthInterval string                       `json:"healthInterval"`
	Providers      map[string]RuntimeFileTarget `json:"providers"`
}

type RuntimeFileTarget struct {
	BaseURL   string `json:"baseUrl"`
	APIKey    string `json:"apiKey"`
	APIKeyEnv string `json:"apiKeyEnv"`
}

func DefaultFileConfig() FileConfig {
	return FileConfig{
		SchemaVersion: DefaultSchemaVersion,
		Runtime: RuntimeFileConfig{
			GRPCAddr:              defaultGRPCAddr,
			HTTPAddr:              defaultHTTPAddr,
			ShutdownTimeout:       "10s",
			LocalRuntimeStatePath: "~/" + defaultLocalRuntimeStateRelPath,
		},
		AI: RuntimeFileAIConfig{
			HTTPTimeout:    "30s",
			HealthInterval: "8s",
			Providers:      map[string]RuntimeFileTarget{},
		},
	}
}

// Load resolves configuration from environment with sane defaults.
func Load() (Config, error) {
	fileCfg, err := loadRuntimeFileConfig()
	if err != nil {
		return Config{}, err
	}
	applyAIEnvDefaults(fileCfg)
	applyImplicitProviderDefaults()

	cfg := Config{
		GRPCAddr:                      readString("NIMI_RUNTIME_GRPC_ADDR", firstNonEmptyString(fileCfg.Runtime.GRPCAddr, defaultGRPCAddr)),
		HTTPAddr:                      readString("NIMI_RUNTIME_HTTP_ADDR", firstNonEmptyString(fileCfg.Runtime.HTTPAddr, defaultHTTPAddr)),
		ShutdownTimeout:               10 * time.Second,
		LocalRuntimeStatePath:         resolveLocalRuntimeStatePath(fileCfg),
		AllowLoopbackProviderEndpoint: readBool("NIMI_RUNTIME_ALLOW_LOOPBACK_PROVIDER_ENDPOINT", false),
		SessionTTLMinSeconds:          readInt("NIMI_RUNTIME_SESSION_TTL_MIN_SECONDS", 60),
		SessionTTLMaxSeconds:          readInt("NIMI_RUNTIME_SESSION_TTL_MAX_SECONDS", 86400),
	}

	shutdownTimeoutRaw := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_SHUTDOWN_TIMEOUT"))
	if shutdownTimeoutRaw == "" {
		shutdownTimeoutRaw = strings.TrimSpace(fileCfg.Runtime.ShutdownTimeout)
	}
	if shutdownTimeoutRaw != "" {
		d, err := time.ParseDuration(shutdownTimeoutRaw)
		if err != nil {
			return Config{}, fmt.Errorf("parse NIMI_RUNTIME_SHUTDOWN_TIMEOUT: %w", err)
		}
		cfg.ShutdownTimeout = d
	}

	if err := cfg.Validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

// Validate ensures addresses and timeout are usable before boot.
func (c Config) Validate() error {
	if err := validateAddr(c.GRPCAddr, "grpc"); err != nil {
		return err
	}
	if err := validateAddr(c.HTTPAddr, "http"); err != nil {
		return err
	}
	if c.ShutdownTimeout <= 0 {
		return fmt.Errorf("shutdown timeout must be > 0")
	}
	return nil
}

func readString(envKey string, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(envKey)); value != "" {
		return value
	}
	return fallback
}

func readBool(envKey string, fallback bool) bool {
	raw := strings.TrimSpace(strings.ToLower(os.Getenv(envKey)))
	switch raw {
	case "true", "1", "yes":
		return true
	case "false", "0", "no":
		return false
	default:
		return fallback
	}
}

func readInt(envKey string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(envKey))
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return value
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func validateAddr(value string, name string) error {
	if strings.TrimSpace(value) == "" {
		return fmt.Errorf("%s address must not be empty", name)
	}
	if _, _, err := net.SplitHostPort(value); err != nil {
		return fmt.Errorf("invalid %s address %q: %w", name, value, err)
	}
	return nil
}

func resolveLocalRuntimeStatePath(fileCfg FileConfig) string {
	if value := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_LOCAL_RUNTIME_STATE_PATH")); value != "" {
		return value
	}
	if value := strings.TrimSpace(fileCfg.Runtime.LocalRuntimeStatePath); value != "" {
		return expandUserPath(value)
	}
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return ""
	}
	return filepath.Join(home, defaultLocalRuntimeStateRelPath)
}

func runtimeConfigPath() string {
	if raw := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CONFIG_PATH")); raw != "" {
		return expandUserPath(raw)
	}
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return ""
	}
	return filepath.Join(home, defaultRuntimeConfigRelPath)
}

func LegacyRuntimeConfigPath() string {
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return ""
	}
	return filepath.Join(home, legacyRuntimeConfigRelPath)
}

func RuntimeConfigPath() string {
	return runtimeConfigPath()
}

func ResolveRuntimeConfigPathForLoad() (string, error) {
	targetPath := runtimeConfigPath()
	if targetPath == "" {
		return "", nil
	}
	if strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CONFIG_PATH")) != "" {
		return targetPath, nil
	}
	legacyPath := LegacyRuntimeConfigPath()
	if legacyPath == "" || legacyPath == targetPath {
		return targetPath, nil
	}
	if _, err := os.Stat(targetPath); err == nil {
		return targetPath, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", fmt.Errorf("stat runtime config file %q: %w", targetPath, err)
	}
	if _, err := os.Stat(legacyPath); errors.Is(err, os.ErrNotExist) {
		return targetPath, nil
	} else if err != nil {
		return "", fmt.Errorf("stat legacy runtime config file %q: %w", legacyPath, err)
	}
	if err := migrateLegacyConfigFile(legacyPath, targetPath); err != nil {
		return "", err
	}
	return targetPath, nil
}

func MigrateLegacyConfig() (bool, string, error) {
	targetPath := runtimeConfigPath()
	if targetPath == "" {
		return false, "", nil
	}
	if strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CONFIG_PATH")) != "" {
		return false, targetPath, nil
	}
	legacyPath := LegacyRuntimeConfigPath()
	if legacyPath == "" || legacyPath == targetPath {
		return false, targetPath, nil
	}
	if _, err := os.Stat(targetPath); err == nil {
		return false, targetPath, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return false, "", fmt.Errorf("stat runtime config file %q: %w", targetPath, err)
	}
	if _, err := os.Stat(legacyPath); errors.Is(err, os.ErrNotExist) {
		return false, targetPath, nil
	} else if err != nil {
		return false, "", fmt.Errorf("stat legacy runtime config file %q: %w", legacyPath, err)
	}
	if err := migrateLegacyConfigFile(legacyPath, targetPath); err != nil {
		return false, "", err
	}
	return true, targetPath, nil
}

func migrateLegacyConfigFile(legacyPath string, targetPath string) error {
	content, err := os.ReadFile(legacyPath)
	if err != nil {
		return fmt.Errorf("read legacy runtime config file %q: %w", legacyPath, err)
	}
	normalized, err := normalizeMigratedConfigContent(content)
	if err != nil {
		return fmt.Errorf("normalize legacy runtime config file %q: %w", legacyPath, err)
	}
	if err := writeBytesAtomic(targetPath, normalized, 0o600); err != nil {
		return fmt.Errorf("write migrated runtime config file %q: %w", targetPath, err)
	}
	if err := os.Remove(legacyPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove legacy runtime config file %q: %w", legacyPath, err)
	}
	return nil
}

func normalizeMigratedConfigContent(content []byte) ([]byte, error) {
	trimmed := strings.TrimSpace(string(content))
	if trimmed == "" {
		defaultCfg := DefaultFileConfig()
		return MarshalFileConfig(defaultCfg)
	}
	var payload map[string]any
	if err := json.Unmarshal(content, &payload); err != nil {
		return nil, err
	}
	if _, exists := payload["schemaVersion"]; !exists {
		payload["schemaVersion"] = DefaultSchemaVersion
	}
	normalized, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(normalized, '\n'), nil
}

func writeBytesAtomic(path string, content []byte, mode os.FileMode) error {
	if path == "" {
		return fmt.Errorf("runtime config path is empty")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create runtime config directory: %w", err)
	}
	tmpPath := path + ".tmp"
	if err := os.WriteFile(tmpPath, content, mode); err != nil {
		return fmt.Errorf("write temp runtime config file: %w", err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("rename temp runtime config file: %w", err)
	}
	return nil
}

func loadRuntimeFileConfig() (FileConfig, error) {
	path, err := ResolveRuntimeConfigPathForLoad()
	if err != nil {
		return FileConfig{}, err
	}
	if path == "" {
		return FileConfig{SchemaVersion: DefaultSchemaVersion}, nil
	}
	return LoadFileConfig(path)
}

func LoadFileConfig(path string) (FileConfig, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return FileConfig{SchemaVersion: DefaultSchemaVersion}, nil
		}
		return FileConfig{}, fmt.Errorf("read runtime config file %q: %w", path, err)
	}
	if len(strings.TrimSpace(string(content))) == 0 {
		return FileConfig{SchemaVersion: DefaultSchemaVersion}, nil
	}
	var parsed FileConfig
	if err := json.Unmarshal(content, &parsed); err != nil {
		return FileConfig{}, fmt.Errorf("parse runtime config file %q: %w", path, err)
	}
	if err := ValidateFileConfig(parsed); err != nil {
		return FileConfig{}, fmt.Errorf("validate runtime config file %q: %w", path, err)
	}
	return parsed, nil
}

func ValidateFileConfig(fileCfg FileConfig) error {
	if fileCfg.SchemaVersion != DefaultSchemaVersion {
		return fmt.Errorf("schemaVersion must be %d", DefaultSchemaVersion)
	}
	for providerName, providerCfg := range fileCfg.AI.Providers {
		if isLegacyProviderName(providerName) {
			return fmt.Errorf("provider %q is forbidden", providerName)
		}
		if strings.TrimSpace(providerCfg.APIKey) != "" {
			return fmt.Errorf("provider %q apiKey is forbidden; use apiKeyEnv", providerName)
		}
		if strings.TrimSpace(providerCfg.APIKeyEnv) == "" {
			return fmt.Errorf("provider %q apiKeyEnv is required", providerName)
		}
	}
	return nil
}

func MarshalFileConfig(fileCfg FileConfig) ([]byte, error) {
	if err := ValidateFileConfig(fileCfg); err != nil {
		return nil, err
	}
	raw, err := json.MarshalIndent(fileCfg, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(raw, '\n'), nil
}

func WriteFileConfig(path string, fileCfg FileConfig) error {
	content, err := MarshalFileConfig(fileCfg)
	if err != nil {
		return err
	}
	return writeBytesAtomic(path, content, 0o600)
}

func expandUserPath(raw string) string {
	path := strings.TrimSpace(raw)
	if path == "" {
		return ""
	}
	if path == "~" {
		home, err := os.UserHomeDir()
		if err == nil {
			return home
		}
		return path
	}
	if !strings.HasPrefix(path, "~/") {
		return path
	}
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return path
	}
	return filepath.Join(home, strings.TrimPrefix(path, "~/"))
}

type providerEnvBinding struct {
	baseURLKey string
	apiKeyKey  string
}

func applyAIEnvDefaults(fileCfg FileConfig) {
	if timeout := strings.TrimSpace(fileCfg.AI.HTTPTimeout); timeout != "" && strings.TrimSpace(os.Getenv("NIMI_RUNTIME_AI_HTTP_TIMEOUT")) == "" {
		_ = os.Setenv("NIMI_RUNTIME_AI_HTTP_TIMEOUT", timeout)
	}
	if interval := strings.TrimSpace(fileCfg.AI.HealthInterval); interval != "" && strings.TrimSpace(os.Getenv("NIMI_RUNTIME_AI_HEALTH_INTERVAL")) == "" {
		_ = os.Setenv("NIMI_RUNTIME_AI_HEALTH_INTERVAL", interval)
	}

	for providerName, providerCfg := range fileCfg.AI.Providers {
		binding, ok := resolveProviderBinding(providerName)
		if !ok {
			continue
		}

		apiKeyValue := resolveProviderAPIKey(providerCfg)
		if strings.TrimSpace(os.Getenv(binding.apiKeyKey)) == "" && apiKeyValue != "" {
			_ = os.Setenv(binding.apiKeyKey, apiKeyValue)
		}

		baseURLValue := strings.TrimSpace(providerCfg.BaseURL)
		if baseURLValue == "" && normalizeProviderName(providerName) == "gemini" && (apiKeyValue != "" || strings.TrimSpace(os.Getenv(binding.apiKeyKey)) != "") {
			baseURLValue = defaultCloudGeminiBaseURL
		}
		if strings.TrimSpace(os.Getenv(binding.baseURLKey)) == "" && baseURLValue != "" {
			_ = os.Setenv(binding.baseURLKey, baseURLValue)
		}
	}
}

func applyImplicitProviderDefaults() {
	if strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CLOUD_ADAPTER_GEMINI_API_KEY")) == "" {
		if fallback := strings.TrimSpace(os.Getenv("GEMINI_API_KEY")); fallback != "" {
			_ = os.Setenv("NIMI_RUNTIME_CLOUD_ADAPTER_GEMINI_API_KEY", fallback)
		}
	}
	if strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CLOUD_ADAPTER_GEMINI_BASE_URL")) == "" && strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CLOUD_ADAPTER_GEMINI_API_KEY")) != "" {
		_ = os.Setenv("NIMI_RUNTIME_CLOUD_ADAPTER_GEMINI_BASE_URL", defaultCloudGeminiBaseURL)
	}
}

func resolveProviderAPIKey(target RuntimeFileTarget) string {
	if envRef := strings.TrimSpace(target.APIKeyEnv); envRef != "" {
		if value := strings.TrimSpace(os.Getenv(envRef)); value != "" {
			return value
		}
	}
	value := strings.TrimSpace(target.APIKey)
	if strings.HasPrefix(value, "${") && strings.HasSuffix(value, "}") {
		envRef := strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(value, "${"), "}"))
		if envRef != "" {
			return strings.TrimSpace(os.Getenv(envRef))
		}
	}
	return value
}

func resolveProviderBinding(raw string) (providerEnvBinding, bool) {
	switch normalizeProviderName(raw) {
	case "local":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_LOCAL_AI_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_LOCAL_AI_API_KEY",
		}, true
	case "localnexa", "nexa":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_LOCAL_NEXA_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_LOCAL_NEXA_API_KEY",
		}, true
	case "nimillm", "cloudnimillm":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_NIMILLM_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_NIMILLM_API_KEY",
		}, true
	case "alibaba", "aliyun", "cloudalibaba":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_ADAPTER_ALIBABA_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_ADAPTER_ALIBABA_API_KEY",
		}, true
	case "bytedance", "byte", "cloudbytedance":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_ADAPTER_BYTEDANCE_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_ADAPTER_BYTEDANCE_API_KEY",
		}, true
	case "bytedanceopenspeech", "openspeech", "cloudbytedanceopenspeech":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_ADAPTER_BYTEDANCE_OPENSPEECH_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_ADAPTER_BYTEDANCE_OPENSPEECH_API_KEY",
		}, true
	case "gemini", "cloudgemini":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_ADAPTER_GEMINI_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_ADAPTER_GEMINI_API_KEY",
		}, true
	case "minimax", "cloudminimax":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_ADAPTER_MINIMAX_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_ADAPTER_MINIMAX_API_KEY",
		}, true
	case "kimi", "moonshot", "cloudkimi":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_ADAPTER_KIMI_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_ADAPTER_KIMI_API_KEY",
		}, true
	case "glm", "zhipu", "bigmodel", "cloudglm":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_ADAPTER_GLM_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_ADAPTER_GLM_API_KEY",
		}, true
	default:
		return providerEnvBinding{}, false
	}
}

func normalizeProviderName(raw string) string {
	trimmed := strings.TrimSpace(strings.ToLower(raw))
	if trimmed == "" {
		return ""
	}
	var builder strings.Builder
	builder.Grow(len(trimmed))
	for _, char := range trimmed {
		if char >= 'a' && char <= 'z' {
			builder.WriteRune(char)
			continue
		}
		if char >= '0' && char <= '9' {
			builder.WriteRune(char)
		}
	}
	return builder.String()
}

func isLegacyProviderName(raw string) bool {
	switch normalizeProviderName(raw) {
	case "litellm", "cloudlitellm", "cloudai":
		return true
	default:
		return false
	}
}

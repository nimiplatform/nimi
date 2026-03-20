package config

import (
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"strings"
	"time"
)

// Validate ensures addresses and timeout are usable before boot.
func (c Config) Validate() error {
	if err := validateAddr(c.GRPCAddr, "grpc"); err != nil {
		return err
	}
	if err := validateAddr(c.HTTPAddr, "http"); err != nil {
		return err
	}
	if err := validateDurationRange(c.ShutdownTimeout, "shutdown timeout", time.Second, 10*time.Minute); err != nil {
		return err
	}
	if _, err := ParseLogLevel(c.LogLevel); err != nil {
		return err
	}
	if err := validateIntRange(c.SessionTTLMinSeconds, "session ttl min seconds", 1, 86400); err != nil {
		return err
	}
	if err := validateIntRange(c.SessionTTLMaxSeconds, "session ttl max seconds", 1, 604800); err != nil {
		return err
	}
	if c.SessionTTLMaxSeconds < c.SessionTTLMinSeconds {
		return fmt.Errorf("session ttl max seconds must be >= session ttl min seconds")
	}
	if err := validateIntRange(c.AIHealthIntervalSeconds, "ai health interval seconds", 1, 3600); err != nil {
		return err
	}
	if err := validateIntRange(c.AIHTTPTimeoutSeconds, "ai http timeout seconds", 1, 600); err != nil {
		return err
	}
	if err := validateIntRange(c.GlobalConcurrencyLimit, "global concurrency limit", 1, 256); err != nil {
		return err
	}
	if err := validateIntRange(c.PerAppConcurrencyLimit, "per-app concurrency limit", 1, 128); err != nil {
		return err
	}
	if c.PerAppConcurrencyLimit > c.GlobalConcurrencyLimit {
		return fmt.Errorf("per-app concurrency limit must be <= global concurrency limit")
	}
	if err := validateIntRange(c.IdempotencyCapacity, "idempotency capacity", 1, 1_000_000); err != nil {
		return err
	}
	if err := validateIntRange(c.MaxDelegationDepth, "max delegation depth", 1, 16); err != nil {
		return err
	}
	if err := validateIntRange(c.AuditRingBufferSize, "audit ring buffer size", 1, 1_000_000); err != nil {
		return err
	}
	if err := validateIntRange(c.UsageStatsBufferSize, "usage stats buffer size", 1, 1_000_000); err != nil {
		return err
	}
	if err := validateIntRange(c.LocalAuditCapacity, "local audit capacity", 1, 1_000_000); err != nil {
		return err
	}
	if err := validateOptionalPort(c.EngineLlamaPort, c.EngineLlamaEnabled, "llama engine port"); err != nil {
		return err
	}
	if err := validateOptionalPort(c.EngineMediaPort, c.EngineMediaEnabled, "media engine port"); err != nil {
		return err
	}
	if err := validateOptionalPort(c.EngineSpeechPort, c.EngineSpeechEnabled, "speech engine port"); err != nil {
		return err
	}
	if err := validateOptionalPort(c.EngineSidecarPort, c.EngineSidecarEnabled || c.EngineSidecarPort != 0, "sidecar engine port"); err != nil {
		return err
	}
	if err := validateJWTSettings(c.AuthJWTIssuer, c.AuthJWTAudience, c.AuthJWTJWKSURL); err != nil {
		return err
	}
	return nil
}

// ParseLogLevel converts a string log level to slog.Level.
func ParseLogLevel(raw string) (slog.Level, error) {
	switch strings.TrimSpace(strings.ToLower(raw)) {
	case "debug":
		return slog.LevelDebug, nil
	case "info", "":
		return slog.LevelInfo, nil
	case "warn", "warning":
		return slog.LevelWarn, nil
	case "error":
		return slog.LevelError, nil
	default:
		return slog.LevelInfo, fmt.Errorf("invalid log level %q: must be debug, info, warn, or error", raw)
	}
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

func validateIntRange(value int, name string, min int, max int) error {
	if value < min || value > max {
		return fmt.Errorf("%s must be between %d and %d", name, min, max)
	}
	return nil
}

func validateDurationRange(value time.Duration, name string, min time.Duration, max time.Duration) error {
	if value < min || value > max {
		return fmt.Errorf("%s must be between %s and %s", name, min, max)
	}
	return nil
}

func validateOptionalPort(port int, required bool, name string) error {
	if !required && port == 0 {
		return nil
	}
	if port < 1 || port > 65535 {
		return fmt.Errorf("%s must be between 1 and 65535", name)
	}
	return nil
}

func validateJWTSettings(issuer string, audience string, jwksURL string) error {
	issuer = strings.TrimSpace(issuer)
	audience = strings.TrimSpace(audience)
	jwksURL = strings.TrimSpace(jwksURL)

	if issuer == "" && audience == "" && jwksURL == "" {
		return nil
	}
	if issuer == "" || audience == "" || jwksURL == "" {
		return fmt.Errorf("jwt auth config requires issuer, audience, and jwks url together")
	}
	parsed, err := url.Parse(jwksURL)
	if err != nil {
		return fmt.Errorf("auth jwt jwks url invalid: %w", err)
	}
	if parsed.Scheme != "https" {
		return fmt.Errorf("auth jwt jwks url must use https")
	}
	if strings.TrimSpace(parsed.Host) == "" {
		return fmt.Errorf("auth jwt jwks url must include host")
	}
	return nil
}

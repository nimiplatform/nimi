package config

import (
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"path/filepath"
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
	if err := validateJWTSettings(c.AuthJWTIssuer, c.AuthJWTAudience, c.AuthJWTJWKSURL, c.AuthJWTRevocationURL); err != nil {
		return err
	}
	if c.NonReleaseDevKernelCheckpoint != nil {
		if !c.AllowLoopbackProviderEndpoint {
			return fmt.Errorf("dev-kernel checkpoint acceptance requires the bounded loopback provider profile")
		}
		if err := ValidateDevKernelCheckpointAcceptance(c.NonReleaseDevKernelCheckpoint); err != nil {
			return err
		}
	}
	return nil
}

func ValidateDevKernelCheckpointAcceptance(acceptance *DevKernelCheckpointAcceptance) error {
	if acceptance == nil {
		return fmt.Errorf("dev-kernel checkpoint acceptance is required")
	}
	values := []struct {
		name  string
		value string
	}{
		{"trial id", acceptance.TrialID},
		{"Runtime candidate id", acceptance.RuntimeCandidateID},
		{"development state candidate id", acceptance.DevelopmentStateCandidateID},
		{"acceptance round id", acceptance.AcceptanceRoundID},
		{"primary account id", acceptance.PrimaryAccountID},
		{"secondary account id", acceptance.SecondaryAccountID},
		{"local agent ref", acceptance.LocalAgentRef},
		{"runtime source ref", acceptance.RuntimeSourceRef},
		{"agent display name", acceptance.AgentDisplayName},
	}
	for _, item := range values {
		if item.value == "" || strings.TrimSpace(item.value) != item.value {
			return fmt.Errorf("dev-kernel checkpoint %s is invalid", item.name)
		}
	}
	if acceptance.PrimaryAccountID == acceptance.SecondaryAccountID {
		return fmt.Errorf("dev-kernel checkpoint accounts must be distinct")
	}
	if !validDevKernelTrialID(acceptance.TrialID) {
		return fmt.Errorf("dev-kernel checkpoint trial id is invalid")
	}
	const roundPrefix = "dev-kernel-round-"
	roundSuffix := strings.TrimPrefix(acceptance.AcceptanceRoundID, roundPrefix)
	if len(roundSuffix) != 32 || roundPrefix+roundSuffix != acceptance.AcceptanceRoundID || strings.IndexFunc(roundSuffix, func(value rune) bool {
		return !((value >= '0' && value <= '9') || (value >= 'a' && value <= 'f'))
	}) >= 0 {
		return fmt.Errorf("dev-kernel checkpoint acceptance round id is invalid")
	}
	if value := strings.TrimSpace(acceptance.DevelopmentDataRootRef); value != acceptance.DevelopmentDataRootRef {
		return fmt.Errorf("dev-kernel checkpoint development data root ref is invalid")
	} else if value != "" {
		cleaned := filepath.Clean(value)
		if cleaned == "." || !filepath.IsAbs(cleaned) || cleaned == filepath.VolumeName(cleaned)+string(filepath.Separator) {
			return fmt.Errorf("dev-kernel checkpoint development data root ref must be an absolute non-root path")
		}
	}
	for label, candidateID := range map[string]string{
		"Runtime candidate id":           acceptance.RuntimeCandidateID,
		"development state candidate id": acceptance.DevelopmentStateCandidateID,
	} {
		const candidatePrefix = "dev-kernel-runtime-"
		candidateSuffix := strings.TrimPrefix(candidateID, candidatePrefix)
		if len(candidateSuffix) != 32 || candidatePrefix+candidateSuffix != candidateID || strings.IndexFunc(candidateSuffix, func(value rune) bool {
			return !((value >= '0' && value <= '9') || (value >= 'a' && value <= 'f'))
		}) >= 0 {
			return fmt.Errorf("dev-kernel checkpoint %s is invalid", label)
		}
	}
	localRefSuffix := strings.TrimPrefix(acceptance.LocalAgentRef, "local-agent:runtime-")
	if len(localRefSuffix) != 32 || strings.IndexFunc(localRefSuffix, func(value rune) bool {
		return !((value >= '0' && value <= '9') || (value >= 'a' && value <= 'f'))
	}) >= 0 {
		return fmt.Errorf("dev-kernel checkpoint local agent ref is invalid")
	}
	return nil
}

func validDevKernelTrialID(value string) bool {
	if len(value) == 0 || len(value) > 64 {
		return false
	}
	first := value[0]
	if !((first >= 'a' && first <= 'z') || (first >= '0' && first <= '9')) {
		return false
	}
	for index, char := range value {
		if (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || (char == '-' && index > 0 && index < len(value)-1) {
			continue
		}
		return false
	}
	return true
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

func validateJWTSettings(issuer string, audience string, jwksURL string, revocationURL string) error {
	issuer = strings.TrimSpace(issuer)
	audience = strings.TrimSpace(audience)
	jwksURL = strings.TrimSpace(jwksURL)
	revocationURL = strings.TrimSpace(revocationURL)

	if issuer == "" && audience == "" && jwksURL == "" && revocationURL == "" {
		return nil
	}
	if issuer == "" || audience == "" || jwksURL == "" || revocationURL == "" {
		return fmt.Errorf("jwt auth config requires issuer, audience, jwks url, and revocation url together")
	}
	parsed, err := url.Parse(jwksURL)
	if err != nil {
		return fmt.Errorf("auth jwt jwks url invalid: %w", err)
	}
	host := strings.TrimSpace(strings.ToLower(parsed.Hostname()))
	if host == "" {
		return fmt.Errorf("auth jwt jwks url must include host")
	}
	if parsed.Scheme == "https" {
		return nil
	}
	if parsed.Scheme == "http" && isLoopbackHost(host) {
	} else if parsed.Scheme != "https" {
		return fmt.Errorf("auth jwt jwks url must use https unless host is loopback")
	}
	revocationParsed, err := url.Parse(revocationURL)
	if err != nil {
		return fmt.Errorf("auth jwt revocation url invalid: %w", err)
	}
	revocationHost := strings.TrimSpace(strings.ToLower(revocationParsed.Hostname()))
	if revocationHost == "" {
		return fmt.Errorf("auth jwt revocation url must include host")
	}
	if revocationParsed.Scheme == "https" {
		return nil
	}
	if revocationParsed.Scheme == "http" && isLoopbackHost(revocationHost) {
		return nil
	}
	return fmt.Errorf("auth jwt revocation url must use https unless host is loopback")
}

func validateOptionalAbsoluteURL(raw string, name string) error {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return fmt.Errorf("%s invalid: %w", name, err)
	}
	if strings.TrimSpace(parsed.Scheme) == "" || strings.TrimSpace(parsed.Host) == "" {
		return fmt.Errorf("%s must include scheme and host", name)
	}
	return nil
}

func isLoopbackHost(host string) bool {
	host = strings.TrimSpace(strings.ToLower(host))
	if host == "" {
		return false
	}
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

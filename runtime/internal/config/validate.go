package config

import (
	"fmt"
	"log/slog"
	"net"
	"strings"
)

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
	if _, err := ParseLogLevel(c.LogLevel); err != nil {
		return err
	}
	if err := validateLocalAIImageBackendConfig(c); err != nil {
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

func validateLocalAIImageBackendConfig(cfg Config) error {
	mode := strings.ToLower(strings.TrimSpace(cfg.EngineLocalAIImageBackendMode))
	switch mode {
	case "", "disabled", "official", "custom":
	default:
		return fmt.Errorf("invalid localai image backend mode %q", cfg.EngineLocalAIImageBackendMode)
	}
	if mode == "" || mode == "disabled" {
		return nil
	}
	if err := validateLoopbackHostPort(cfg.EngineLocalAIImageBackendAddress, "engines.localai.imageBackend.address"); err != nil {
		return err
	}
	if strings.TrimSpace(cfg.EngineLocalAIImageBackendName) == "" {
		return fmt.Errorf("engines.localai.imageBackend.backendName must not be empty")
	}
	if mode == "custom" && strings.TrimSpace(cfg.EngineLocalAIImageBackendCommand) == "" {
		return fmt.Errorf("engines.localai.imageBackend.command must not be empty when mode=custom")
	}
	return nil
}

func validateLoopbackHostPort(raw string, field string) error {
	value := strings.TrimSpace(raw)
	if value == "" {
		return fmt.Errorf("%s must not be empty", field)
	}
	host, port, err := net.SplitHostPort(value)
	if err != nil {
		return fmt.Errorf("%s must be host:port: %w", field, err)
	}
	if strings.TrimSpace(port) == "" {
		return fmt.Errorf("%s must include a port", field)
	}
	if !isLoopbackHost(host) {
		return fmt.Errorf("%s must use a loopback host", field)
	}
	return nil
}

func isLoopbackHost(host string) bool {
	trimmed := strings.TrimSpace(strings.ToLower(host))
	if trimmed == "" {
		return false
	}
	if trimmed == "localhost" {
		return true
	}
	ip := net.ParseIP(trimmed)
	return ip != nil && ip.IsLoopback()
}

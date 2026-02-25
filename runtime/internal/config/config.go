package config

import (
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	defaultGRPCAddr                 = "127.0.0.1:46371"
	defaultHTTPAddr                 = "127.0.0.1:46372"
	defaultLocalRuntimeStateRelPath = ".nimi/runtime/local-runtime-state.json"
)

// Config defines daemon boot configuration.
type Config struct {
	GRPCAddr              string
	HTTPAddr              string
	ShutdownTimeout       time.Duration
	LocalRuntimeStatePath string
}

// Load resolves configuration from environment with sane defaults.
func Load() (Config, error) {
	cfg := Config{
		GRPCAddr:              readString("NIMI_RUNTIME_GRPC_ADDR", defaultGRPCAddr),
		HTTPAddr:              readString("NIMI_RUNTIME_HTTP_ADDR", defaultHTTPAddr),
		ShutdownTimeout:       10 * time.Second,
		LocalRuntimeStatePath: resolveLocalRuntimeStatePath(),
	}

	if raw := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_SHUTDOWN_TIMEOUT")); raw != "" {
		d, err := time.ParseDuration(raw)
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

func validateAddr(value string, name string) error {
	if strings.TrimSpace(value) == "" {
		return fmt.Errorf("%s address must not be empty", name)
	}
	if _, _, err := net.SplitHostPort(value); err != nil {
		return fmt.Errorf("invalid %s address %q: %w", name, value, err)
	}
	return nil
}

func resolveLocalRuntimeStatePath() string {
	if value := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_LOCAL_RUNTIME_STATE_PATH")); value != "" {
		return value
	}
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return ""
	}
	return filepath.Join(home, defaultLocalRuntimeStateRelPath)
}

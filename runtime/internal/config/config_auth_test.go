package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadAuthJWTFromConfigFile(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "runtime-config.json")
	configBody := `{
  "schemaVersion": 1,
  "auth": {
    "jwt": {
      "issuer": "https://realm.nimi.xyz",
      "audience": "nimi-runtime",
      "jwksUrl": "https://realm.nimi.xyz/api/auth/jwks",
      "revocationUrl": "https://realm.nimi.xyz/api/auth/revocation"
    }
  }
}`
	if err := os.WriteFile(configPath, []byte(configBody), 0o600); err != nil {
		t.Fatalf("write config file: %v", err)
	}

	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", configPath)
	clearRuntimeConfigEnv(t)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.AuthJWTIssuer != "https://realm.nimi.xyz" {
		t.Fatalf("issuer mismatch: %q", cfg.AuthJWTIssuer)
	}
	if cfg.AuthJWTAudience != "nimi-runtime" {
		t.Fatalf("audience mismatch: %q", cfg.AuthJWTAudience)
	}
	if cfg.AuthJWTJWKSURL != "https://realm.nimi.xyz/api/auth/jwks" {
		t.Fatalf("jwksUrl mismatch: %q", cfg.AuthJWTJWKSURL)
	}
	if cfg.AuthJWTRevocationURL != "https://realm.nimi.xyz/api/auth/revocation" {
		t.Fatalf("revocationUrl mismatch: %q", cfg.AuthJWTRevocationURL)
	}
}

func TestLoadAuthJWTEnvOverridesConfigFile(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "runtime-config.json")
	configBody := `{
  "schemaVersion": 1,
  "auth": {
    "jwt": {
      "issuer": "https://realm.config.test",
      "audience": "runtime-config",
      "jwksUrl": "https://realm.config.test/api/auth/jwks",
      "revocationUrl": "https://realm.config.test/api/auth/revocation"
    }
  }
}`
	if err := os.WriteFile(configPath, []byte(configBody), 0o600); err != nil {
		t.Fatalf("write config file: %v", err)
	}

	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", configPath)
	clearRuntimeConfigEnv(t)
	t.Setenv("NIMI_RUNTIME_AUTH_JWT_ISSUER", "https://realm.env.test")
	t.Setenv("NIMI_RUNTIME_AUTH_JWT_AUDIENCE", "runtime-env")
	t.Setenv("NIMI_RUNTIME_AUTH_JWT_JWKS_URL", "https://realm.env.test/api/auth/jwks")
	t.Setenv("NIMI_RUNTIME_AUTH_JWT_REVOCATION_URL", "https://realm.env.test/api/auth/revocation")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.AuthJWTIssuer != "https://realm.env.test" {
		t.Fatalf("issuer env override mismatch: %q", cfg.AuthJWTIssuer)
	}
	if cfg.AuthJWTAudience != "runtime-env" {
		t.Fatalf("audience env override mismatch: %q", cfg.AuthJWTAudience)
	}
	if cfg.AuthJWTJWKSURL != "https://realm.env.test/api/auth/jwks" {
		t.Fatalf("jwksUrl env override mismatch: %q", cfg.AuthJWTJWKSURL)
	}
	if cfg.AuthJWTRevocationURL != "https://realm.env.test/api/auth/revocation" {
		t.Fatalf("revocationUrl env override mismatch: %q", cfg.AuthJWTRevocationURL)
	}
}

func TestLoadRejectsInvalidIntegerEnvOverride(t *testing.T) {
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", filepath.Join(t.TempDir(), "missing-config.json"))
	clearRuntimeConfigEnv(t)
	t.Setenv("NIMI_RUNTIME_GLOBAL_CONCURRENCY_LIMIT", "invalid")

	_, err := Load()
	if err == nil {
		t.Fatal("expected invalid integer env override to fail")
	}
	if !strings.Contains(err.Error(), "parse NIMI_RUNTIME_GLOBAL_CONCURRENCY_LIMIT") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestLoadRejectsIncompleteJWTConfig(t *testing.T) {
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", filepath.Join(t.TempDir(), "missing-config.json"))
	clearRuntimeConfigEnv(t)
	t.Setenv("NIMI_RUNTIME_AUTH_JWT_JWKS_URL", "https://realm.env.test/api/auth/jwks")

	_, err := Load()
	if err == nil {
		t.Fatal("expected incomplete jwt config to fail")
	}
	if !strings.Contains(err.Error(), "requires issuer, audience, jwks url, and revocation url together") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestLoadAllowsLoopbackHTTPJWKSURL(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "runtime-config.json")
	configBody := `{
  "schemaVersion": 1,
  "auth": {
    "jwt": {
      "issuer": "http://localhost:3002",
      "audience": "nimi-runtime",
      "jwksUrl": "http://127.0.0.1:3002/api/auth/jwks",
      "revocationUrl": "http://127.0.0.1:3002/api/auth/revocation"
    }
  }
}`
	if err := os.WriteFile(configPath, []byte(configBody), 0o600); err != nil {
		t.Fatalf("write config file: %v", err)
	}

	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", configPath)
	clearRuntimeConfigEnv(t)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("expected loopback http jwks url to load, got: %v", err)
	}
	if cfg.AuthJWTJWKSURL != "http://127.0.0.1:3002/api/auth/jwks" {
		t.Fatalf("jwksUrl mismatch: %q", cfg.AuthJWTJWKSURL)
	}
}

func TestLoadRejectsNonLoopbackHTTPJWKSURL(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "runtime-config.json")
	configBody := `{
  "schemaVersion": 1,
  "auth": {
    "jwt": {
      "issuer": "https://realm.nimi.xyz",
      "audience": "nimi-runtime",
      "jwksUrl": "http://realm.nimi.xyz/api/auth/jwks",
      "revocationUrl": "https://realm.nimi.xyz/api/auth/revocation"
    }
  }
}`
	if err := os.WriteFile(configPath, []byte(configBody), 0o600); err != nil {
		t.Fatalf("write config file: %v", err)
	}

	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", configPath)
	clearRuntimeConfigEnv(t)

	_, err := Load()
	if err == nil {
		t.Fatal("expected non-loopback http jwks url to fail")
	}
	if !strings.Contains(err.Error(), "auth jwt jwks url must use https unless host is loopback") {
		t.Fatalf("unexpected error: %v", err)
	}
}

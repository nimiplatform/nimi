//go:build windows && nimi_runtime_e2e

package entrypoint

import (
	"path/filepath"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/config"
)

func TestWindowsE2EConfigIgnoresPortableProductionAuthority(t *testing.T) {
	t.Setenv("NIMI_REALM_URL", "https://production.example.invalid")
	t.Setenv("NIMI_RUNTIME_AUTH_JWT_ISSUER", "production-issuer")
	t.Setenv("NIMI_RUNTIME_ACCOUNT_TOKEN_URL", "https://production.example.invalid/token")
	t.Setenv("NIMI_RUNTIME_APP_REGISTRY_PATH", `C:\user-controlled\registry.yaml`)
	root := filepath.Join(t.TempDir(), "protected-e2e")
	cfg, err := loadWindowsProtectedRuntimeConfig(root)
	if err != nil {
		t.Fatalf("load fixed E2E config: %v", err)
	}
	if cfg.AuthJWTIssuer != "" || cfg.AuthJWTJWKSURL != "" ||
		cfg.AccountRealmBaseURL != "" || cfg.AccountTokenURL != "" ||
		cfg.AppRegistryPath != "" || len(cfg.Providers) != 0 {
		t.Fatalf("E2E config consumed portable or production authority: %+v", cfg)
	}
	if cfg.RuntimeID != windowsE2ERuntimeID ||
		cfg.LocalStatePath != filepath.Join(root, "runtime", "local-state.json") {
		t.Fatalf("E2E state paths escaped the protected root: %+v", cfg)
	}
	if cfg.DataRootRef != "" || cfg.LocalModelsPath != "" || cfg.ManagedRoots != (config.ManagedRootsConfig{}) {
		t.Fatalf("E2E config installed an alternate data-root authority: %+v", cfg)
	}
	if !cfg.LocalService.Enabled || cfg.EngineLlamaEnabled || cfg.EngineMediaEnabled ||
		cfg.EngineSpeechEnabled || cfg.EngineSidecarEnabled {
		t.Fatalf("unexpected E2E execution posture: %+v", cfg)
	}
}

func TestWindowsE2ECredentialsAreFreshOpaqueMaterial(t *testing.T) {
	first, err := randomWindowsE2ECredential()
	if err != nil {
		t.Fatal(err)
	}
	second, err := randomWindowsE2ECredential()
	if err != nil {
		t.Fatal(err)
	}
	if first == second || len(first) < 40 || len(second) < 40 {
		t.Fatal("Windows E2E credentials were not independent opaque material")
	}
}

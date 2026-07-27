//go:build windows

package entrypoint

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/config"
)

func TestWindowsProductionRuntimeConfigUsesOnlyServiceOwnedRootAndFixedAuthority(t *testing.T) {
	t.Setenv("NIMI_RUNTIME_GRPC_ADDR", "127.0.0.1:59999")
	t.Setenv("NIMI_RUNTIME_ACCOUNT_REALM_BASE_URL", "https://attacker.invalid")
	t.Setenv("NIMI_RUNTIME_AUTH_JWT_ISSUER", "https://attacker.invalid")

	root := t.TempDir()
	first, err := loadWindowsProtectedRuntimeConfig(root)
	if err != nil {
		t.Fatalf("load production config: %v", err)
	}
	second, err := loadWindowsProtectedRuntimeConfig(root)
	if err != nil {
		t.Fatalf("reload production config: %v", err)
	}
	if first.RuntimeID == "" || second.RuntimeID != first.RuntimeID {
		t.Fatalf("service-owned RuntimeID is not stable: first=%q second=%q", first.RuntimeID, second.RuntimeID)
	}
	if first.GRPCAddr != "127.0.0.1:46371" || first.AccountRealmBaseURL != windowsProductionRealmBaseURL || first.AuthJWTIssuer != windowsProductionRealmBaseURL {
		t.Fatalf("caller environment altered production config: %+v", first)
	}
	wantState := filepath.Join(root, "runtime", windowsProductionInstallStateFile)
	if _, err := os.Stat(wantState); err != nil {
		t.Fatalf("service-owned installation state missing: %v", err)
	}
}

func TestWindowsProductionRuntimeConfigAppliesServiceOwnedDataRoot(t *testing.T) {
	root := t.TempDir()
	if _, err := loadWindowsProtectedRuntimeConfig(root); err != nil {
		t.Fatalf("initialize production config: %v", err)
	}
	dataRoot := t.TempDir()
	serviceConfigPath := filepath.Join(root, "runtime", config.ServiceOwnedConfigFilename)
	if changed, err := config.WriteServiceOwnedDataRoot(serviceConfigPath, dataRoot); err != nil || !changed {
		t.Fatalf("write service-owned data root changed=%v err=%v", changed, err)
	}

	cfg, err := loadWindowsProtectedRuntimeConfig(root)
	if err != nil {
		t.Fatalf("load production config with data root: %v", err)
	}
	if cfg.DataRootRef != dataRoot ||
		cfg.LocalModelsPath != filepath.Join(dataRoot, "models") ||
		cfg.ManagedRoots.Dependencies != filepath.Join(dataRoot, "dependencies") ||
		cfg.ManagedRoots.Environments != filepath.Join(dataRoot, "environments") ||
		cfg.ManagedRoots.Apps != filepath.Join(dataRoot, "apps") ||
		cfg.ManagedRoots.Accounts != filepath.Join(dataRoot, "accounts") ||
		cfg.ManagedRoots.Logs != filepath.Join(dataRoot, "logs") ||
		cfg.ManagedRoots.Audit != filepath.Join(dataRoot, "audit") {
		t.Fatalf("production config did not apply service-owned data root: %+v", cfg)
	}
}

func TestWindowsProductionRuntimeConfigFailsClosedOnCorruptInstallationState(t *testing.T) {
	root := t.TempDir()
	runtimeRoot := filepath.Join(root, "runtime")
	if err := os.MkdirAll(runtimeRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(runtimeRoot, windowsProductionInstallStateFile)
	if err := os.WriteFile(path, []byte(`{"schemaVersion":1,"runtimeId":"not-a-ulid","extra":true}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadWindowsProtectedRuntimeConfig(root); err == nil {
		t.Fatal("corrupt service-owned installation state was accepted")
	}
}

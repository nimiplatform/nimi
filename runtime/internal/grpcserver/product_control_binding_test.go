package grpcserver

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	localservice "github.com/nimiplatform/nimi/runtime/internal/services/localservice"
)

func TestProtectedRuntimeConfigMustMatchFixedProductControlDataRoot(t *testing.T) {
	productControlRoot := filepath.Join(t.TempDir(), ".nimi")
	dataRoot := filepath.Join(t.TempDir(), "NimiData")
	service, err := localservice.New(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		nil,
		filepath.Join(t.TempDir(), "local-state.json"),
		32,
	)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(service.Close)
	if err := service.SetProductControlRoot(productControlRoot); err != nil {
		t.Fatal(err)
	}
	if err := service.SetProductVersion("test"); err != nil {
		t.Fatal(err)
	}
	service.SetProductControlDataRootConfigWriter(func(string) (bool, error) { return false, nil })
	if _, err := service.SelectProductControlDataRoot(context.Background(), &runtimev1.SelectProductControlDataRootRequest{DataRoot: dataRoot}); err != nil {
		t.Fatalf("select Product Control data root: %v", err)
	}

	derivedConfigPath := filepath.Join(t.TempDir(), "runtime", config.ServiceOwnedConfigFilename)
	var derived config.Config
	if err := reconcileProtectedProductControlDataRootConfig(productControlRoot, derivedConfigPath, &derived, localservice.ProductControlDataRootSecurityBinding{}); err != nil {
		t.Fatalf("materialize missing derived config: %v", err)
	}
	if derived.DataRootRef != dataRoot ||
		derived.LocalModelsPath != filepath.Join(dataRoot, "models") ||
		derived.ManagedRoots.Dependencies != filepath.Join(dataRoot, "dependencies") ||
		derived.ManagedRoots.Apps != filepath.Join(dataRoot, "apps") ||
		derived.ManagedRoots.Accounts != filepath.Join(dataRoot, "accounts") {
		t.Fatalf("materialized derived config = %+v", derived)
	}

	cfg := config.Config{
		DataRootRef:     dataRoot,
		LocalModelsPath: filepath.Join(dataRoot, "models"),
		ManagedRoots: config.ManagedRootsConfig{
			Models:       filepath.Join(dataRoot, "models"),
			Dependencies: filepath.Join(dataRoot, "dependencies"),
			Environments: filepath.Join(dataRoot, "environments"),
			Apps:         filepath.Join(dataRoot, "apps"),
			Accounts:     filepath.Join(dataRoot, "accounts"),
			Logs:         filepath.Join(dataRoot, "logs"),
			Audit:        filepath.Join(dataRoot, "audit"),
		},
	}
	if err := validateProductControlDataRootConfigForTest(productControlRoot, cfg); err != nil {
		t.Fatalf("matching derived config rejected: %v", err)
	}

	t.Run("different data root", func(t *testing.T) {
		mutated := cfg
		mutated.DataRootRef = filepath.Join(t.TempDir(), "other")
		if err := validateProductControlDataRootConfigForTest(productControlRoot, mutated); err == nil ||
			!strings.Contains(err.Error(), "dataRootRef does not match") {
			t.Fatalf("mismatched derived data root error = %v", err)
		}
	})
	t.Run("existing private config cannot be regenerated over mismatch", func(t *testing.T) {
		mismatchedRoot := filepath.Join(t.TempDir(), "other")
		configPath := filepath.Join(t.TempDir(), "runtime", config.ServiceOwnedConfigFilename)
		if _, err := config.WriteServiceOwnedDataRoot(configPath, mismatchedRoot); err != nil {
			t.Fatal(err)
		}
		var mutated config.Config
		if err := config.ApplyServiceOwnedDataRoot(&mutated, configPath); err != nil {
			t.Fatal(err)
		}
		if err := reconcileProtectedProductControlDataRootConfig(productControlRoot, configPath, &mutated, localservice.ProductControlDataRootSecurityBinding{}); err == nil ||
			!strings.Contains(err.Error(), "dataRootRef does not match") {
			t.Fatalf("mismatched existing proof error = %v", err)
		}
	})
	t.Run("different managed dependency root", func(t *testing.T) {
		mutated := cfg
		mutated.ManagedRoots.Dependencies = filepath.Join(t.TempDir(), "dependencies")
		if err := validateProductControlDataRootConfigForTest(productControlRoot, mutated); err == nil ||
			!strings.Contains(err.Error(), "managedRoots.dependencies does not match") {
			t.Fatalf("mismatched derived dependency root error = %v", err)
		}
	})
	t.Run("different managed app root", func(t *testing.T) {
		mutated := cfg
		mutated.ManagedRoots.Apps = filepath.Join(t.TempDir(), "apps")
		if err := validateProductControlDataRootConfigForTest(productControlRoot, mutated); err == nil ||
			!strings.Contains(err.Error(), "managedRoots.apps does not match") {
			t.Fatalf("mismatched derived app root error = %v", err)
		}
	})
	t.Run("different managed account root", func(t *testing.T) {
		mutated := cfg
		mutated.ManagedRoots.Accounts = filepath.Join(t.TempDir(), "accounts")
		if err := validateProductControlDataRootConfigForTest(productControlRoot, mutated); err == nil ||
			!strings.Contains(err.Error(), "managedRoots.accounts does not match") {
			t.Fatalf("mismatched derived account root error = %v", err)
		}
	})
	t.Run("private config without Product Control", func(t *testing.T) {
		missingRoot := filepath.Join(t.TempDir(), ".nimi")
		if err := validateProductControlDataRootConfigForTest(missingRoot, cfg); err == nil ||
			!strings.Contains(err.Error(), "exists without a Product Control") {
			t.Fatalf("orphaned private config error = %v", err)
		}
	})
}

func TestNonProductionDataRootIgnoresConfigAndUsesCanonicalBinding(t *testing.T) {
	staleRoot := filepath.Join(t.TempDir(), "stale")
	canonicalRoot := filepath.Join(t.TempDir(), "canonical")
	cfg := config.Config{
		DataRootRef:     staleRoot,
		LocalModelsPath: filepath.Join(staleRoot, "models"),
		ManagedRoots: config.ManagedRootsConfig{
			Dependencies: filepath.Join(staleRoot, "dependencies"),
		},
	}
	applyProductControlDataRootBinding(&cfg, localservice.ProductControlDataRootBinding{DataRoot: canonicalRoot})
	if cfg.DataRootRef != canonicalRoot ||
		cfg.LocalModelsPath != filepath.Join(canonicalRoot, "models") ||
		cfg.ManagedRoots.Models != filepath.Join(canonicalRoot, "models") ||
		cfg.ManagedRoots.Dependencies != filepath.Join(canonicalRoot, "dependencies") ||
		cfg.ManagedRoots.Environments != filepath.Join(canonicalRoot, "environments") ||
		cfg.ManagedRoots.Apps != filepath.Join(canonicalRoot, "apps") ||
		cfg.ManagedRoots.Accounts != filepath.Join(canonicalRoot, "accounts") ||
		cfg.ManagedRoots.Logs != filepath.Join(canonicalRoot, "logs") ||
		cfg.ManagedRoots.Audit != filepath.Join(canonicalRoot, "audit") {
		t.Fatalf("non-production canonical binding = %+v", cfg)
	}

	applyProductControlDataRootBinding(&cfg, localservice.ProductControlDataRootBinding{})
	if cfg.DataRootRef != "" || cfg.LocalModelsPath != "" || cfg.ManagedRoots != (config.ManagedRootsConfig{}) {
		t.Fatalf("missing canonical selection retained config roots: %+v", cfg)
	}
}

func TestProtectedRuntimeDoesNotMaterializeDerivedConfigFromRepairRequiredProductControl(t *testing.T) {
	productControlRoot := filepath.Join(t.TempDir(), ".nimi")
	dataRoot := filepath.Join(t.TempDir(), "NimiData")
	service, err := localservice.New(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		nil,
		filepath.Join(t.TempDir(), "local-state.json"),
		32,
	)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(service.Close)
	if err := service.SetProductControlRoot(productControlRoot); err != nil {
		t.Fatal(err)
	}
	if err := service.SetProductVersion("test"); err != nil {
		t.Fatal(err)
	}
	service.SetProductControlDataRootConfigWriter(func(string) (bool, error) { return false, nil })
	if _, err := service.SelectProductControlDataRoot(
		context.Background(),
		&runtimev1.SelectProductControlDataRootRequest{DataRoot: dataRoot},
	); err != nil {
		t.Fatalf("select Product Control data root: %v", err)
	}

	recordPath := filepath.Join(productControlRoot, "nimi.json")
	raw, err := os.ReadFile(recordPath)
	if err != nil {
		t.Fatal(err)
	}
	var record map[string]any
	if err := json.Unmarshal(raw, &record); err != nil {
		t.Fatal(err)
	}
	record["state"] = "repair_required"
	record["dataRoot"].(map[string]any)["status"] = "repair_required"
	record["repair"] = map[string]any{
		"required": true,
		"reason":   "repair-required test fixture",
	}
	raw, err = json.Marshal(record)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(recordPath, raw, 0o600); err != nil {
		t.Fatal(err)
	}

	derivedConfigPath := filepath.Join(t.TempDir(), "runtime", config.ServiceOwnedConfigFilename)
	var derived config.Config
	err = reconcileProtectedProductControlDataRootConfig(
		productControlRoot,
		derivedConfigPath,
		&derived,
		localservice.ProductControlDataRootSecurityBinding{},
	)
	if err == nil || !strings.Contains(err.Error(), "forbids data-root binding") {
		t.Fatalf("repair-required Product Control reconciliation error = %v", err)
	}
	if _, statErr := os.Stat(derivedConfigPath); !os.IsNotExist(statErr) {
		t.Fatalf("repair-required Product Control materialized derived config: %v", statErr)
	}
	if derived.DataRootRef != "" || derived.LocalModelsPath != "" ||
		derived.ManagedRoots != (config.ManagedRootsConfig{}) {
		t.Fatalf("repair-required Product Control mutated Runtime roots: %+v", derived)
	}
}

func validateProductControlDataRootConfigForTest(productControlRoot string, cfg config.Config) error {
	binding, err := localservice.LoadProductControlDataRootBinding(
		productControlRoot,
		localservice.ProductControlDataRootSecurityBinding{},
	)
	if err != nil {
		return err
	}
	return validateProtectedProductControlDataRootBinding(binding, cfg)
}

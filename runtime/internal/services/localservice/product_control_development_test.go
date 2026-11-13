package localservice

import (
	"context"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestDevelopmentMayReuseAnInactiveInstalledDataRoot(t *testing.T) {
	home := setProductControlHomeForTest(t)
	service := newTestService(t)
	if err := service.SetProductControlRoot(filepath.Join(home, ".nimi")); err != nil {
		t.Fatal(err)
	}
	service.SetProductControlDataRootConfigWriter(func(string) (bool, error) { return true, nil })
	service.SetProductControlDataRootConfigValidator(func(string) error { return nil })
	if _, err := service.EnsureProductControlRecordCreated(context.Background(), &runtimev1.EnsureProductControlRecordCreatedRequest{}); err != nil {
		t.Fatal(err)
	}
	selected := filepath.Join(home, "installed-data")
	response, err := service.SelectProductControlDataRoot(context.Background(), &runtimev1.SelectProductControlDataRootRequest{DataRoot: selected})
	projection := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if projection.Record == nil || selectedProductDataRootPath(projection.Record) != selected {
		t.Fatalf("selection failed: %+v", projection)
	}
	stored, err := readProductControlRecord(filepath.Join(home, ".nimi", "nimi.json"))
	if err != nil || stored == nil || selectedProductDataRootPath(stored) != selected {
		t.Fatalf("selection stored at %s instead of expected home: %+v %v", projection.Path, stored, err)
	}
	control := filepath.Join(home, "RuntimeLocalDevelopment", "official", ".nimi")
	if err := validateProductControlDataRootBoundary(selected, control); err != nil {
		t.Fatalf("another Product Control reference must not prohibit sequential reuse: %v", err)
	}
	if err := validateProductControlDataRootBoundary(filepath.Join(home, "separate-source-data"), control); err != nil {
		t.Fatal(err)
	}
}

func TestProductControlSourceScopeShape(t *testing.T) {
	for _, realm := range []string{"official", "local"} {
		if !sourceProductControlRoot(filepath.Join(t.TempDir(), "RuntimeLocalDevelopment", realm, ".nimi")) {
			t.Fatal("valid source scope rejected")
		}
	}
	if sourceProductControlRoot(filepath.Join(t.TempDir(), "RuntimeLocalDevelopment", ".nimi")) {
		t.Fatal("unscoped previous data root must not be reused")
	}
}

package localservice

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/apphostprofile"
)

func readSelectedDataRootProjectionForTest(t *testing.T, service *Service) productControlSelectedDataRootProjection {
	t.Helper()
	response, err := service.GetProductControlSelectedDataRoot(context.Background(), &runtimev1.GetProductControlSelectedDataRootRequest{})
	if err != nil {
		t.Fatalf("get selected data root: %v", err)
	}
	var projection productControlSelectedDataRootProjection
	if err := json.Unmarshal([]byte(response.GetJson()), &projection); err != nil {
		t.Fatalf("decode selected data-root projection: %v", err)
	}
	return projection
}

func TestSelectedDataRootProjectsHostProfileScopeOnlyForTheBoundRoot(t *testing.T) {
	setProductControlHomeForTest(t)
	service := newTestService(t)
	if err := service.SetProductControlHostProfileAnchor("loua_v2_test-user"); err != nil {
		t.Fatal(err)
	}
	bound := service.localEnvironmentRuntimeDataRoot()
	response, err := service.SelectProductControlDataRoot(context.Background(), &runtimev1.SelectProductControlDataRootRequest{DataRoot: bound})
	selected := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if selected.State != productControlStateDataRootSelected || selected.Record == nil {
		t.Fatalf("selection = %+v", selected)
	}

	// A selected root that is not yet ready_for_use still projects its scope.
	projection := readSelectedDataRootProjectionForTest(t, service)
	want, err := apphostprofile.HostScopeRoot(bound, selected.Record.InstallID, "loua_v2_test-user")
	if err != nil {
		t.Fatal(err)
	}
	if projection.HostProfileScopeRoot == nil || *projection.HostProfileScopeRoot != want {
		t.Fatalf("host profile scope = %v, want %q", projection.HostProfileScopeRoot, want)
	}
	if filepath.Dir(filepath.Dir(want)) != filepath.Clean(bound) {
		t.Fatalf("scope %q must be inside the bound root %q", want, bound)
	}
	stored, err := readProductControlRecord(selected.Path)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(stored)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		t.Fatal(err)
	}
	if _, persisted := fields["hostProfileScopeRoot"]; persisted {
		t.Fatal("the scope projection must never be written to the canonical record")
	}
}

func TestSelectedDataRootScopeIsNullWhenRootIsNotBoundOrAnchorMissing(t *testing.T) {
	home := setProductControlHomeForTest(t)
	service := newTestService(t)
	if err := service.SetProductControlHostProfileAnchor("loua_v2_test-user"); err != nil {
		t.Fatal(err)
	}
	selectedRoot := filepath.Join(home, "selected-root")
	response, err := service.SelectProductControlDataRoot(context.Background(), &runtimev1.SelectProductControlDataRootRequest{DataRoot: selectedRoot})
	mustProductControlForTest(t, response, err)
	if projection := readSelectedDataRootProjectionForTest(t, service); projection.HostProfileScopeRoot == nil {
		t.Fatalf("the selected root this process serves must project a scope: %+v", projection)
	}
	// A committed replacement awaiting Runtime restart is not yet bound.
	service.mu.Lock()
	service.productControlRootAdmissionClosed = true
	service.mu.Unlock()
	if projection := readSelectedDataRootProjectionForTest(t, service); projection.DataRoot == nil || projection.HostProfileScopeRoot != nil {
		t.Fatalf("committed-but-unbound root projected a scope: %+v", projection)
	}
	// A selection this process does not serve projects no scope either.
	service.mu.Lock()
	service.productControlRootAdmissionClosed = false
	service.runtimeDataRoot = filepath.Join(home, "other-bound-root")
	service.mu.Unlock()
	if projection := readSelectedDataRootProjectionForTest(t, service); projection.DataRoot == nil || projection.HostProfileScopeRoot != nil {
		t.Fatalf("unbound selected root projected a scope: %+v", projection)
	}

	unanchored := newTestService(t)
	bound := unanchored.localEnvironmentRuntimeDataRoot()
	response, err = unanchored.SelectProductControlDataRoot(context.Background(), &runtimev1.SelectProductControlDataRootRequest{DataRoot: bound})
	mustProductControlForTest(t, response, err)
	if projection := readSelectedDataRootProjectionForTest(t, unanchored); projection.DataRoot == nil || projection.HostProfileScopeRoot != nil {
		t.Fatalf("missing OS-user anchor projected a scope: %+v", projection)
	}
	if err := unanchored.SetProductControlHostProfileAnchor("loua_v2_late"); err == nil {
		t.Fatal("the anchor must not change after Product Control first use")
	}
}

func TestCheckSyncTreatsAppHostsAsDeclaredRootEntry(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{apphostprofile.DirectoryName, "unexpected"} {
		if err := os.MkdirAll(filepath.Join(root, name), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	unclaimed := scanProductControlCheckSyncUnclaimed(root)
	if len(unclaimed) != 1 || unclaimed[0].Locator != "unexpected" {
		t.Fatalf("unclaimed = %+v", unclaimed)
	}
}

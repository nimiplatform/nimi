package appstorage

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestResolveReturnsAdmittedRoots(t *testing.T) {
	dataRoot := t.TempDir()
	plan, err := Resolve(dataRoot, "community.clock", "1.2.3", "nimi-data-app-roots")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if plan.ReleaseRoot != filepath.Join(dataRoot, "apps", "community.clock", "releases", "1.2.3") {
		t.Fatalf("release root = %q", plan.ReleaseRoot)
	}
	if plan.DurableDataRoot != filepath.Join(dataRoot, "apps", "community.clock", "data") {
		t.Fatalf("data root = %q", plan.DurableDataRoot)
	}
	if plan.CacheRoot != filepath.Join(dataRoot, "apps", "community.clock", "cache") {
		t.Fatalf("cache root = %q", plan.CacheRoot)
	}
	if plan.TempRoot != filepath.Join(dataRoot, "apps", "community.clock", "tmp") {
		t.Fatalf("tmp root = %q", plan.TempRoot)
	}
}

func TestResolveRejectsUnsafeInputs(t *testing.T) {
	dataRoot := t.TempDir()
	cases := []struct {
		name    string
		root    string
		appID   string
		version string
		want    error
	}{
		{name: "missing root", root: "", appID: "app", version: "1.0.0", want: ErrDataRootRequired},
		{name: "relative root", root: "relative", appID: "app", version: "1.0.0", want: ErrDataRootMustBeAbsolute},
		{name: "traversal app", root: dataRoot, appID: "../app", version: "1.0.0", want: ErrInvalidAppIDSegment},
		{name: "absolute app", root: dataRoot, appID: filepath.Join(string(filepath.Separator), "app"), version: "1.0.0", want: ErrInvalidAppIDSegment},
		{name: "slash app", root: dataRoot, appID: "org/app", version: "1.0.0", want: ErrInvalidAppIDSegment},
		{name: "traversal version", root: dataRoot, appID: "app", version: "../1.0.0", want: ErrInvalidVersionSegment},
		{name: "unsupported policy", root: dataRoot, appID: "app", version: "1.0.0", want: ErrStoragePolicyUnsupported},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			policy := "nimi-data-app-roots"
			if tc.want == ErrStoragePolicyUnsupported {
				policy = "other"
			}
			_, err := Resolve(tc.root, tc.appID, tc.version, policy)
			if !errors.Is(err, tc.want) {
				t.Fatalf("Resolve error = %v, want %v", err, tc.want)
			}
		})
	}
}

func TestMaterializeCreatesOnlyAdmittedRoots(t *testing.T) {
	plan, err := Resolve(t.TempDir(), "community.clock", "1.2.3", "nimi-data-app-roots")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if err := Materialize(plan); err != nil {
		t.Fatalf("Materialize: %v", err)
	}
	for _, root := range []string{plan.ReleaseRoot, plan.DurableDataRoot, plan.CacheRoot, plan.TempRoot} {
		info, err := os.Stat(root)
		if err != nil {
			t.Fatalf("stat %s: %v", root, err)
		}
		if !info.IsDir() {
			t.Fatalf("%s is not a dir", root)
		}
	}
}

func TestMaterializeRejectsSymlinkTraversal(t *testing.T) {
	dataRoot := t.TempDir()
	outside := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dataRoot, "apps"), 0o755); err != nil {
		t.Fatalf("mkdir apps: %v", err)
	}
	requireSymlinkForTest(t, outside, filepath.Join(dataRoot, "apps", "community.clock"))
	plan, err := Resolve(dataRoot, "community.clock", "1.2.3", "nimi-data-app-roots")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if err := Materialize(plan); !errors.Is(err, ErrStorageRootSymlink) {
		t.Fatalf("Materialize error = %v, want ErrStorageRootSymlink", err)
	}
}

func TestInstallEvidenceAndUninstallRetention(t *testing.T) {
	plan, err := Resolve(t.TempDir(), "community.clock", "1.2.3", "nimi-data-app-roots")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if err := Materialize(plan); err != nil {
		t.Fatalf("Materialize: %v", err)
	}
	dataFile := filepath.Join(plan.DurableDataRoot, "user.db")
	if err := os.WriteFile(dataFile, []byte("durable"), 0o600); err != nil {
		t.Fatalf("write data: %v", err)
	}
	evidence := InstallEvidence{
		AppID:                plan.AppID,
		ReleaseDescriptorRef: "community.clock.v1",
		StoragePolicyRef:     plan.StoragePolicyRef,
		InstalledVersion:     plan.Version,
		SHA256:               "abc",
		VerificationState:    "digest-verified",
		ReleaseRoot:          plan.ReleaseRoot,
		DurableDataRoot:      plan.DurableDataRoot,
		CacheRoot:            plan.CacheRoot,
		TempRoot:             plan.TempRoot,
	}
	if err := WriteInstallEvidence(plan, evidence); err != nil {
		t.Fatalf("WriteInstallEvidence: %v", err)
	}
	loaded, err := ReadInstallEvidence(plan)
	if err != nil {
		t.Fatalf("ReadInstallEvidence: %v", err)
	}
	if loaded.SHA256 != evidence.SHA256 || loaded.ReleaseRoot != plan.ReleaseRoot {
		t.Fatalf("loaded evidence = %+v", loaded)
	}
	if err := Uninstall(plan, UninstallOptions{}); err != nil {
		t.Fatalf("Uninstall: %v", err)
	}
	if _, err := os.Stat(plan.ReleaseRoot); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("release root stat error = %v, want not exist", err)
	}
	if _, err := os.Stat(dataFile); err != nil {
		t.Fatalf("durable data should remain: %v", err)
	}
	if err := Uninstall(plan, UninstallOptions{DeleteDurableData: true}); !errors.Is(err, ErrDestructiveDeleteConfirmation) {
		t.Fatalf("destructive uninstall error = %v", err)
	}
}

func TestWriteInstallEvidenceRejectsSymlinkAfterUnpack(t *testing.T) {
	plan, err := Resolve(t.TempDir(), "community.clock", "1.2.3", "nimi-data-app-roots")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if err := Materialize(plan); err != nil {
		t.Fatalf("Materialize: %v", err)
	}
	outside := t.TempDir()
	requireSymlinkForTest(t, outside, filepath.Join(plan.ReleaseRoot, ".nimi"))
	err = WriteInstallEvidence(plan, InstallEvidence{
		AppID:                plan.AppID,
		ReleaseDescriptorRef: "community.clock.v1",
		StoragePolicyRef:     plan.StoragePolicyRef,
		InstalledVersion:     plan.Version,
		SHA256:               "abc",
		VerificationState:    "digest-verified",
		ReleaseRoot:          plan.ReleaseRoot,
		DurableDataRoot:      plan.DurableDataRoot,
		CacheRoot:            plan.CacheRoot,
		TempRoot:             plan.TempRoot,
	})
	if !errors.Is(err, ErrStorageRootSymlink) {
		t.Fatalf("WriteInstallEvidence error = %v, want ErrStorageRootSymlink", err)
	}
	if entries, err := os.ReadDir(outside); err != nil || len(entries) != 0 {
		t.Fatalf("outside dir should stay empty, entries=%v err=%v", entries, err)
	}
}

func TestWriteInstallEvidenceRejectsSymlinkEvidenceFile(t *testing.T) {
	plan, err := Resolve(t.TempDir(), "community.clock", "1.2.3", "nimi-data-app-roots")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if err := Materialize(plan); err != nil {
		t.Fatalf("Materialize: %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(EvidencePath(plan)), 0o755); err != nil {
		t.Fatalf("mkdir evidence dir: %v", err)
	}
	outside := filepath.Join(t.TempDir(), "outside.json")
	requireSymlinkForTest(t, outside, EvidencePath(plan))
	err = WriteInstallEvidence(plan, InstallEvidence{
		AppID:                plan.AppID,
		ReleaseDescriptorRef: "community.clock.v1",
		StoragePolicyRef:     plan.StoragePolicyRef,
		InstalledVersion:     plan.Version,
		SHA256:               "abc",
		VerificationState:    "digest-verified",
		ReleaseRoot:          plan.ReleaseRoot,
		DurableDataRoot:      plan.DurableDataRoot,
		CacheRoot:            plan.CacheRoot,
		TempRoot:             plan.TempRoot,
	})
	if !errors.Is(err, ErrStorageRootSymlink) {
		t.Fatalf("WriteInstallEvidence error = %v, want ErrStorageRootSymlink", err)
	}
	if _, err := os.Stat(outside); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("outside evidence target should not be written, stat=%v", err)
	}
}

func requireSymlinkForTest(t *testing.T, oldname string, newname string) {
	t.Helper()
	if err := os.Symlink(oldname, newname); err != nil {
		t.Skipf("symlink unavailable in this test environment: %v", err)
	}
}

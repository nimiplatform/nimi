package appstorage

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestResolveReturnsAdmittedRoots(t *testing.T) {
	dataRoot := t.TempDir()
	plan, err := Resolve(dataRoot, "community.clock", "verified", "1.2.3", "nimi-mediated-default")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if plan.SourceClass != "verified" || plan.ReleaseRoot != filepath.Join(dataRoot, "apps", "community.clock", "releases", "verified", "1.2.3") {
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

func TestResolveAcceptsOnlyVerifiedPackageSource(t *testing.T) {
	dataRoot := t.TempDir()
	verified, err := Resolve(dataRoot, "community.clock", "verified", "1.2.3", StoragePolicyNimiMediatedDefault)
	if err != nil {
		t.Fatal(err)
	}
	if verified.SourceClass != "verified" {
		t.Fatalf("source class = %q", verified.SourceClass)
	}
	if _, err := Resolve(dataRoot, "community.clock", "user_imported", "1.2.3", StoragePolicyNimiMediatedDefault); !errors.Is(err, ErrInvalidSourceClass) {
		t.Fatalf("retired user-imported package source error = %v", err)
	}
	if _, err := Resolve(dataRoot, "community.clock", "local_development", "1.2.3", StoragePolicyNimiMediatedDefault); !errors.Is(err, ErrInvalidSourceClass) {
		t.Fatalf("local-development package source error = %v", err)
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
			policy := "nimi-mediated-default"
			if tc.want == ErrStoragePolicyUnsupported {
				policy = "other"
			}
			_, err := Resolve(tc.root, tc.appID, "verified", tc.version, policy)
			if !errors.Is(err, tc.want) {
				t.Fatalf("Resolve error = %v, want %v", err, tc.want)
			}
		})
	}
}

func TestMaterializeCreatesOnlyAdmittedRoots(t *testing.T) {
	plan, err := Resolve(t.TempDir(), "community.clock", "verified", "1.2.3", "nimi-mediated-default")
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
	plan, err := Resolve(dataRoot, "community.clock", "verified", "1.2.3", "nimi-mediated-default")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if err := Materialize(plan); !errors.Is(err, ErrStorageRootSymlink) {
		t.Fatalf("Materialize error = %v, want ErrStorageRootSymlink", err)
	}
}

func TestRemoveReleasePreservesDurableData(t *testing.T) {
	plan, err := Resolve(t.TempDir(), "community.clock", "verified", "1.2.3", "nimi-mediated-default")
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
	if err := RemoveRelease(plan); err != nil {
		t.Fatalf("RemoveRelease: %v", err)
	}
	if _, err := os.Stat(plan.ReleaseRoot); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("release root stat error = %v, want not exist", err)
	}
	if _, err := os.Stat(dataFile); err != nil {
		t.Fatalf("durable data should remain: %v", err)
	}
}

func requireSymlinkForTest(t *testing.T, oldname string, newname string) {
	t.Helper()
	if err := os.Symlink(oldname, newname); err != nil {
		t.Skipf("symlink unavailable in this test environment: %v", err)
	}
}

package appidentityprojection

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadRepositoryProjectionSelectsOnlyLocalFirstPartyApps(t *testing.T) {
	path := filepath.Join("..", "..", "..", "config", "platform-nimi-app-identity-surfaces.yaml")
	projection, err := LoadFromFile(path)
	if err != nil {
		t.Fatalf("load repository identity projection: %v", err)
	}

	for _, appID := range []string{"nimi.avatar", "nimi.zhiyu"} {
		if !projection.IsLocalFirstParty(appID) {
			t.Fatalf("%s was not projected as local-first-party", appID)
		}
	}
	for _, appID := range []string{"nimi.desktop", "nimi.web", "nimi.lab"} {
		if projection.IsLocalFirstParty(appID) {
			t.Fatalf("%s must not be projected as local-first-party", appID)
		}
	}
}

func TestLoadRejectsMalformedLocalFirstPartyIdentity(t *testing.T) {
	const source = `
version: 1
table_family: product_catalog
owner: platform
catalog_id: platform_nimi_app_identity_surfaces
apps:
  - canonical_app_id: nimi.avatar
    runtime_app_id: app.nimi.avatar
    runtime_caller_mode: local-first-party
`
	if _, err := Load(strings.NewReader(source)); err == nil {
		t.Fatal("mismatched Runtime identity was accepted")
	}
}

func TestLoadRejectsDuplicateLocalFirstPartyIdentity(t *testing.T) {
	const source = `
version: 1
table_family: product_catalog
owner: platform
catalog_id: platform_nimi_app_identity_surfaces
apps:
  - canonical_app_id: nimi.avatar
    runtime_app_id: nimi.avatar
    runtime_caller_mode: local-first-party
  - canonical_app_id: nimi.avatar
    runtime_app_id: nimi.avatar
    runtime_caller_mode: local-first-party
`
	if _, err := Load(strings.NewReader(source)); err == nil {
		t.Fatal("duplicate local-first-party identity was accepted")
	}
}

func TestLoadFromFileRejectsMissingProjection(t *testing.T) {
	_, err := LoadFromFile(filepath.Join(t.TempDir(), "missing.yaml"))
	if err == nil || !os.IsNotExist(rootCause(err)) {
		t.Fatalf("missing projection error = %v", err)
	}
}

func rootCause(err error) error {
	for {
		next, ok := err.(interface{ Unwrap() error })
		if !ok || next.Unwrap() == nil {
			return err
		}
		err = next.Unwrap()
	}
}

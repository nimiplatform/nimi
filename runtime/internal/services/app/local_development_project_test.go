package app

import (
	"os"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestResolveLocalDevelopmentProjectKeepsUnknownAppAccessInert(t *testing.T) {
	root := t.TempDir()
	manifest := "app_id: nimi.example\ndisplay_name: Example\napp_access:\n  - realm.data\n  - future.domain\n"
	if err := os.WriteFile(filepath.Join(root, "nimi.app.yaml"), []byte(manifest), 0o600); err != nil {
		t.Fatal(err)
	}
	project, err := resolveLocalDevelopmentProject(root, "nimi.example", runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_ELECTRON)
	if err != nil {
		t.Fatal(err)
	}
	if len(project.RawAppAccess) != 2 || len(project.ActivatedDomains) != 1 || project.ActivatedDomains[0] != "realm.data" {
		t.Fatalf("declaration = raw:%v activated:%v", project.RawAppAccess, project.ActivatedDomains)
	}
}

func TestResolveLocalDevelopmentProjectRejectsLegacyPermissionShape(t *testing.T) {
	root := t.TempDir()
	manifest := "app_id: nimi.example\ndisplay_name: Example\napp_access: []\npermissions:\n  - id: agents.interact\n    reason: legacy\n"
	if err := os.WriteFile(filepath.Join(root, "nimi.app.yaml"), []byte(manifest), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := resolveLocalDevelopmentProject(root, "nimi.example", runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_ELECTRON); err == nil {
		t.Fatal("legacy declaration unexpectedly accepted")
	}
}

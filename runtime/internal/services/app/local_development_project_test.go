package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/apppermission"
)

func TestNormalizeLocalDevelopmentPermissionRequestsAcceptsZeroPermissionApp(t *testing.T) {
	permissions, err := normalizeLocalDevelopmentPermissionRequests([]localAppManifestPermissionRequest{}, nil)
	if err != nil {
		t.Fatalf("normalize zero-permission manifest: %v", err)
	}
	if len(permissions) != 0 {
		t.Fatalf("zero-permission manifest projected authority: %v", permissions)
	}
}

func TestNormalizeLocalDevelopmentPermissionRequestsReturnsTypedReservedAndUnknownReasons(t *testing.T) {
	for _, test := range []struct {
		name         string
		permissionID string
		wantReason   localDevelopmentManifestPermissionReason
	}{
		{name: "reserved", permissionID: "agents.voice", wantReason: localDevelopmentManifestPermissionReserved},
		{name: "unknown", permissionID: "runtime.agent.turn.write", wantReason: localDevelopmentManifestPermissionUnknown},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := localAppManifestPermissionRequest{PermissionID: test.permissionID, Reason: "Explain the requested permission"}
			_, err := normalizeLocalDevelopmentPermissionRequests([]localAppManifestPermissionRequest{request}, nil)
			failure, ok := localDevelopmentManifestPermissionFailureFromError(err)
			if !ok || failure.Reason() != test.wantReason || failure.PermissionID() != test.permissionID {
				t.Fatalf("typed permission failure = (%#v, %v), want reason=%s permission=%s", failure, err, test.wantReason, test.permissionID)
			}
		})
	}
}

func TestNormalizeLocalDevelopmentPermissionRequestsRejectsMalformedRequests(t *testing.T) {
	for _, test := range []struct {
		name    string
		request localAppManifestPermissionRequest
	}{
		{name: "whitespace", request: localAppManifestPermissionRequest{PermissionID: " agents.interact", Reason: "Not canonical"}},
		{name: "missing reason", request: localAppManifestPermissionRequest{PermissionID: "agents.interact"}},
		{name: "long reason", request: localAppManifestPermissionRequest{PermissionID: "agents.interact", Reason: strings.Repeat("界", 81)}},
	} {
		t.Run(test.name, func(t *testing.T) {
			if _, err := normalizeLocalDevelopmentPermissionRequests([]localAppManifestPermissionRequest{test.request}, nil); err == nil {
				t.Fatal("malformed permission request was accepted")
			}
		})
	}
}

func TestNormalizeLocalDevelopmentPermissionRequestsAcceptsPublishedAgentPermissions(t *testing.T) {
	requests := []localAppManifestPermissionRequest{
		{PermissionID: "agents.interact", Reason: "Talk with selected Agents"},
		{PermissionID: "agents.configure", Reason: "Configure selected Agents"},
	}
	permissions, err := normalizeLocalDevelopmentPermissionRequests(requests, nil)
	if err != nil || len(permissions) != 2 ||
		permissions[0].PermissionID != "agents.configure" ||
		permissions[1].PermissionID != "agents.interact" {
		t.Fatalf("published permission request = (%+v, %v)", permissions, err)
	}
}

func TestResolveLocalDevelopmentProjectAcceptsPublishedManifestPermission(t *testing.T) {
	root := t.TempDir()
	manifest := []byte(`app_id: nimi.permission-test
display_name: Permission Test
permissions:
  - id: agents.interact
    reason: Talk with selected Agents
  - id: agents.configure
    reason: Configure selected Agents
`)
	if err := os.WriteFile(filepath.Join(root, "nimi.app.yaml"), manifest, 0o600); err != nil {
		t.Fatalf("write local app manifest: %v", err)
	}

	project, err := resolveLocalDevelopmentProject(
		root,
		"nimi.permission-test",
		runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_ELECTRON,
		"account-a",
		1,
	)
	if err != nil {
		t.Fatalf("resolve admitted manifest permission: %v", err)
	}
	if len(project.PermissionRequirements) != 2 ||
		project.PermissionRequirements[0].PermissionID != "agents.configure" ||
		project.PermissionRequirements[1].PermissionID != "agents.interact" {
		t.Fatalf("resolved permission requirements = %+v", project.PermissionRequirements)
	}
}

func TestNormalizeLocalDevelopmentPermissionRequestsFollowsCatalogAdmissionAndManifestEligibility(t *testing.T) {
	request := localAppManifestPermissionRequest{PermissionID: "agents.interact", Reason: "Talk with selected Agents"}
	lookup := func(id string) (apppermission.Descriptor, bool) {
		if id != "agents.interact" {
			return apppermission.Descriptor{}, false
		}
		return apppermission.Descriptor{ID: id, Admission: apppermission.AdmissionAdmitted, ManifestAllowed: true}, true
	}
	permissions, err := normalizeLocalDevelopmentPermissionRequestsWithCatalog([]localAppManifestPermissionRequest{request}, nil, lookup)
	if err != nil || len(permissions) != 1 || permissions[0].PermissionID != request.PermissionID || permissions[0].Reason != request.Reason {
		t.Fatalf("admitted catalog request = (%+v, %v)", permissions, err)
	}
	forbiddenLookup := func(id string) (apppermission.Descriptor, bool) {
		return apppermission.Descriptor{ID: id, Admission: apppermission.AdmissionAdmitted, ManifestAllowed: false}, true
	}
	if _, err := normalizeLocalDevelopmentPermissionRequestsWithCatalog([]localAppManifestPermissionRequest{request}, nil, forbiddenLookup); err == nil {
		t.Fatal("manifest-forbidden catalog row was accepted")
	}
	if _, err := normalizeLocalDevelopmentPermissionRequestsWithCatalog([]localAppManifestPermissionRequest{request, request}, nil, lookup); err == nil {
		t.Fatal("duplicate admitted permission was accepted")
	}
}

func TestNormalizeLocalDevelopmentPermissionRequestsRejectsRetiredRuntimeBindingSection(t *testing.T) {
	if _, err := normalizeLocalDevelopmentPermissionRequests(nil, []any{}); err == nil {
		t.Fatal("retired runtime_scoped_binding_requests was accepted")
	}
}

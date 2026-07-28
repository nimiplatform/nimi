package app

import (
	"strings"
	"testing"

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

func TestNormalizeLocalDevelopmentPermissionRequestsRejectsReservedAndUnknownIDs(t *testing.T) {
	for _, test := range []struct {
		name    string
		request localAppManifestPermissionRequest
	}{
		{name: "reserved", request: localAppManifestPermissionRequest{PermissionID: "agents.interact", Reason: "Talk with an Agent selected by me"}},
		{name: "unknown", request: localAppManifestPermissionRequest{PermissionID: "runtime.agent.turn.write", Reason: "Internal operation is not a permission"}},
		{name: "whitespace", request: localAppManifestPermissionRequest{PermissionID: " agents.interact", Reason: "Not canonical"}},
		{name: "missing reason", request: localAppManifestPermissionRequest{PermissionID: "agents.interact"}},
		{name: "long reason", request: localAppManifestPermissionRequest{PermissionID: "agents.interact", Reason: strings.Repeat("界", 81)}},
	} {
		t.Run(test.name, func(t *testing.T) {
			if _, err := normalizeLocalDevelopmentPermissionRequests([]localAppManifestPermissionRequest{test.request}, nil); err == nil {
				t.Fatal("non-admitted permission request was accepted")
			}
		})
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

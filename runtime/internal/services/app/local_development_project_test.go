package app

import (
	"strings"
	"testing"
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

func TestNormalizeLocalDevelopmentPermissionRequestsRejectsRetiredRuntimeBindingSection(t *testing.T) {
	if _, err := normalizeLocalDevelopmentPermissionRequests(nil, []any{}); err == nil {
		t.Fatal("retired runtime_scoped_binding_requests was accepted")
	}
}

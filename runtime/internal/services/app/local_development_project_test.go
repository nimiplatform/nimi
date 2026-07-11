package app

import (
	"reflect"
	"testing"
)

func TestNormalizeLocalDevelopmentCapabilitiesAcceptsClosedScopesAndCanonicalQualifiers(t *testing.T) {
	capabilities, err := normalizeLocalDevelopmentCapabilities([]localAppManifestCapability{
		{Scope: "data.scope.read", Qualifier: "runtime.artifacts", Purpose: "Read the Runtime artifact audience."},
		{Scope: "data.scope.read", Qualifier: "realm.core.worlds", Purpose: "Declare the reviewed world-read boundary."},
		{Scope: "ai.spend.meter", Purpose: "Declare metered AI execution."},
	})
	if err != nil {
		t.Fatalf("normalize canonical declarations: %v", err)
	}
	want := []string{"ai.spend.meter", "data.scope.read#realm.core.worlds", "data.scope.read#runtime.artifacts"}
	if !reflect.DeepEqual(capabilities, want) {
		t.Fatalf("unexpected normalized capabilities: got %v want %v", capabilities, want)
	}
}

func TestNormalizeLocalDevelopmentCapabilitiesRejectsNonCanonicalDeclarations(t *testing.T) {
	tests := []struct {
		name        string
		declaration localAppManifestCapability
	}{
		{name: "open scope", declaration: localAppManifestCapability{Scope: "runtime.ai.text.generate", Qualifier: "feature", Purpose: "Invalid open scope."}},
		{name: "unsafe qualifier", declaration: localAppManifestCapability{Scope: "data.scope.read", Qualifier: "realm worlds", Purpose: "Invalid qualifier."}},
		{name: "artifact qualifier on wrong scope", declaration: localAppManifestCapability{Scope: "account.read", Qualifier: "runtime.artifacts", Purpose: "Invalid artifact scope."}},
		{name: "draft qualifier on wrong scope", declaration: localAppManifestCapability{Scope: "data.scope.write", Qualifier: "app-local-drafts", Purpose: "Invalid draft scope."}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := normalizeLocalDevelopmentCapabilities([]localAppManifestCapability{test.declaration}); err == nil {
				t.Fatal("invalid local-development permission declaration was accepted")
			}
		})
	}
}

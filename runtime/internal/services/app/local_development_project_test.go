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
	}, []localAppManifestCapability{
		{Scope: "runtime.agent.turn.read", Purpose: "Request a Runtime-issued conversation read binding."},
		{Scope: "runtime.agent.turn.write", Purpose: "Request a Runtime-issued conversation write binding."},
		{Scope: "runtime.agent.voice.read", Purpose: "Request protected Runtime voice playback."},
		{Scope: "runtime.agent.voice.transcribe", Purpose: "Request protected Runtime voice transcription."},
	})
	if err != nil {
		t.Fatalf("normalize canonical declarations: %v", err)
	}
	want := []string{"ai.spend.meter", "data.scope.read#realm.core.worlds", "data.scope.read#runtime.artifacts", "runtime.agent.turn.read", "runtime.agent.turn.write", "runtime.agent.voice.read", "runtime.agent.voice.transcribe"}
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
			if _, err := normalizeLocalDevelopmentCapabilities([]localAppManifestCapability{test.declaration}, nil); err == nil {
				t.Fatal("invalid local-development permission declaration was accepted")
			}
		})
	}
}

func TestNormalizeLocalDevelopmentCapabilitiesSeparatesRuntimeBindingRequests(t *testing.T) {
	declarations := []localAppManifestCapability{{Scope: "account.session.read", Purpose: "Read the current account projection."}}
	for _, request := range []localAppManifestCapability{
		{Scope: "runtime.agent.turn.read", Qualifier: "conversation", Purpose: "Qualifier is not admitted."},
		{Scope: "runtime.agent.ai_config.write", Purpose: "Open Runtime scope is not admitted."},
	} {
		if _, err := normalizeLocalDevelopmentCapabilities(declarations, []localAppManifestCapability{request}); err == nil {
			t.Fatalf("invalid Runtime scoped binding request was accepted: %#v", request)
		}
	}
	if _, err := normalizeLocalDevelopmentCapabilities([]localAppManifestCapability{{
		Scope: "runtime.agent.turn.read", Purpose: "Runtime binding scopes are not registry permission declarations.",
	}}, nil); err == nil {
		t.Fatal("Runtime scoped binding request was accepted as a permission declaration")
	}
}

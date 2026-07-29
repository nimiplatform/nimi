//go:build darwin && cgo && nimi_macos_local_development

package protectedlocal

import "testing"

func TestMacOSLocalDevelopmentCodePolicyRequiresAdHocWithoutTeam(t *testing.T) {
	originalTeamID := MacOSTeamID
	MacOSTeamID = "ABCDE12345"
	t.Cleanup(func() { MacOSTeamID = originalTeamID })

	policy, err := macOSRuntimeCodePolicy()
	if err != nil {
		t.Fatalf("load local-development Runtime code policy: %v", err)
	}
	if !policy.requireAdHoc || policy.requireTrustedAnchor || policy.requireNotarization {
		t.Fatalf("local-development signer policy = %+v", policy)
	}
	if policy.teamID != "" {
		t.Fatalf("local-development Team ID = %q, want absent", policy.teamID)
	}
	if policy.directRequirement != `identifier "ai.nimi.runtime.dev"` {
		t.Fatalf("local-development requirement = %q", policy.directRequirement)
	}
}

func TestMacOSLocalDevelopmentCodePolicyRejectsMixedSignerModes(t *testing.T) {
	policy, err := macOSRuntimeCodePolicy()
	if err != nil {
		t.Fatalf("load local-development Runtime code policy: %v", err)
	}
	policy.teamID = "ABCDE12345"
	if err := policy.validate(); err == nil {
		t.Fatal("ad-hoc policy accepted a Team ID")
	}
	policy.teamID = ""
	policy.requireTrustedAnchor = true
	if err := policy.validate(); err == nil {
		t.Fatal("ad-hoc policy accepted trusted-anchor validation")
	}
}

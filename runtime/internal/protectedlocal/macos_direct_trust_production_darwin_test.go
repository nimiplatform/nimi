//go:build darwin && cgo && !nimi_macos_local_development && !nimi_macos_source_local_development

package protectedlocal

import "testing"

func TestMacOSProductionCodePolicyKeepsTeamAnchorAndNotarization(t *testing.T) {
	originalTeamID := MacOSTeamID
	MacOSTeamID = "ABCDE12345"
	t.Cleanup(func() { MacOSTeamID = originalTeamID })

	policy, err := macOSRuntimeCodePolicy()
	if err != nil {
		t.Fatalf("load production Runtime code policy: %v", err)
	}
	if policy.requireAdHoc || !policy.requireTrustedAnchor || !policy.requireNotarization {
		t.Fatalf("production signer policy = %+v", policy)
	}
	if policy.teamID != "ABCDE12345" {
		t.Fatalf("production Team ID = %q", policy.teamID)
	}
	const expected = `identifier "ai.nimi.runtime" and anchor apple generic and certificate leaf[subject.OU] = "ABCDE12345" and certificate leaf[field.1.2.840.113635.100.6.1.13] exists`
	if policy.directRequirement != expected {
		t.Fatalf("production requirement = %q", policy.directRequirement)
	}
}

func TestMacOSProductionCodePolicyStillRequiresEmbeddedTeam(t *testing.T) {
	originalTeamID := MacOSTeamID
	MacOSTeamID = ""
	t.Cleanup(func() { MacOSTeamID = originalTeamID })

	if _, err := macOSRuntimeCodePolicy(); err == nil {
		t.Fatal("production Runtime code policy accepted an absent Team ID")
	}
}

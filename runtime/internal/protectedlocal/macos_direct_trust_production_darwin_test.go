//go:build darwin && cgo && !nimi_macos_local_development && !nimi_macos_source_local_development

package protectedlocal

import (
	"os"
	"testing"
)

// The signing build supplies the real, stapled Host before packaging it.
// codesign and spctl do not exercise the Runtime's Security.framework call.
func TestMacOSNotarizedManagedWebCarrierSeal(t *testing.T) {
	bundle := os.Getenv("NIMI_TEST_NOTARIZED_LOCAL_APP_HOST")
	if bundle == "" {
		t.Skip("requires the notarized macOS release candidate")
	}
	policy, err := macOSLocalAppHostCodePolicy()
	if err != nil {
		t.Fatal(err)
	}
	if err := verifyMacOSOuterBundleSeal(bundle, policy.directRequirement, policy.teamID,
		policy.signingIdentifier, policy.requireTrustedAnchor, policy.requireNotarization, policy.requireAdHoc); err != nil {
		t.Fatalf("verify notarized Host with Runtime policy: %v", err)
	}
}

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

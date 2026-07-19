//go:build darwin

package protectedlocal

import (
	"fmt"
)

const (
	MacOSRuntimeStateLockFilename = "runtime.lock"
)

type macOSCodePolicy struct {
	executableRole           string
	teamID                   string
	leafSPKISHA256           string
	signingIdentifier        string
	designatedRequirement    string
	releaseCDHash            string
	artifactDigest           Identifier
	trustSetID               string
	releaseID                string
	compatiblePeerReleaseIDs []string
	generation               uint64
}

func (policy macOSCodePolicy) validate() error {
	if !canonicalIdentityField(policy.executableRole) || !validMacOSProfileTeamID(policy.teamID) ||
		!validMacOSProfileLeafSPKI(policy.leafSPKISHA256) ||
		!canonicalIdentityField(policy.signingIdentifier) ||
		!canonicalIdentityField(policy.designatedRequirement) ||
		!canonicalIdentityField(policy.trustSetID) ||
		!canonicalIdentityField(policy.releaseID) ||
		policy.artifactDigest == (Identifier{}) || policy.generation == 0 ||
		len(policy.compatiblePeerReleaseIDs) == 0 || !validMacOSCDHash(policy.releaseCDHash) {
		return fail(ReasonDesktopExecutableTrustFailed, false, "reinstall_signed_release", fmt.Errorf("macOS release code policy is incomplete"))
	}
	return nil
}

func (policy macOSCodePolicy) releaseLineage() ReleaseLineageRecord {
	return ReleaseLineageRecord{
		ExecutableRole: policy.executableRole,
		ReleaseID:      policy.releaseID,
		Generation:     policy.generation,
		ArtifactSHA256: policy.artifactDigest,
	}
}

func macOSRuntimeCodePolicy() (macOSCodePolicy, error) {
	return loadMacOSCodePolicy(macOSRuntimeExecutableRole)
}

func macOSDesktopCodePolicy() (macOSCodePolicy, error) {
	return loadMacOSCodePolicy(macOSDesktopExecutableRole)
}

func macOSLocalAppHostCodePolicy() (macOSCodePolicy, error) {
	return loadMacOSCodePolicy(macOSLocalHostExecutableRole)
}

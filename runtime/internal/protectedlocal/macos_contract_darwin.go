//go:build darwin

package protectedlocal

import (
	"fmt"
	"regexp"
)

const (
	MacOSRuntimeServiceLabel = "ai.nimi.runtime"
	MacOSRuntimeAccountName  = "_nimiruntime"

	MacOSRuntimeExecutablePath    = "/Applications/Nimi.app/Contents/Library/LaunchServices/nimi-runtime"
	MacOSDesktopExecutablePath    = "/Applications/Nimi.app/Contents/MacOS/Nimi"
	MacOSLocalAppHostPath         = "/Applications/Nimi.app/Contents/Frameworks/Nimi Local App Host.app/Contents/MacOS/Nimi Local App Host"
	MacOSRuntimeStateRoot         = "/Library/Application Support/Nimi/Runtime/state"
	MacOSRuntimeStateLockFilename = "runtime.lock"
	MacOSReleaseTrustRecordRoot   = "/Library/Application Support/Nimi/Runtime/trust/protected-local/v1"

	MacOSDesktopSocketActivationName  = "DesktopControl"
	MacOSLocalAppSocketActivationName = "LocalAppHost"
	MacOSDesktopSocketPath            = "/private/var/run/nimi/runtime-desktop.sock"
	MacOSLocalAppSocketPath           = "/private/var/run/nimi/runtime-local-app.sock"

	MacOSRuntimeSigningIdentifier = "ai.nimi.runtime"
	MacOSDesktopSigningIdentifier = "ai.nimi.apps.nimi.desktop"
	MacOSLocalAppHostIdentifier   = "ai.nimi.apps.nimi.local-app-host"

	MacOSDesktopProductionTrustSetID = "nimi-desktop-production-v1"
	MacOSRuntimeProductionTrustSetID = "nimi-runtime-production-v1"
)

var macOSTeamIDPattern = regexp.MustCompile(`^[A-Z0-9]{10}$`)

type macOSCodePolicy struct {
	executableRole           string
	teamID                   string
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
	if !canonicalIdentityField(policy.executableRole) || !macOSTeamIDPattern.MatchString(policy.teamID) ||
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

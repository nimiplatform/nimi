//go:build darwin && cgo

package protectedlocal

import (
	"fmt"
)

const (
	MacOSRuntimeStateLockFilename = "runtime.lock"
)

type macOSCodePolicy struct {
	teamID               string
	signingIdentifier    string
	directRequirement    string
	requireAdHoc         bool
	requireTrustedAnchor bool
	requireNotarization  bool
}

func (policy macOSCodePolicy) validate() error {
	if !canonicalIdentityField(policy.signingIdentifier) ||
		!validMacOSRequirement(policy.directRequirement) ||
		(policy.requireNotarization && !policy.requireTrustedAnchor) ||
		(policy.requireAdHoc && (policy.teamID != "" || policy.requireTrustedAnchor || policy.requireNotarization)) ||
		(!policy.requireAdHoc && (!validMacOSTeamID(policy.teamID) || !policy.requireTrustedAnchor)) {
		return fail(ReasonDesktopExecutableTrustFailed, false, "reinstall_runtime_service", fmt.Errorf("macOS direct code policy is incomplete"))
	}
	return nil
}

func macOSRuntimeCodePolicy() (macOSCodePolicy, error) {
	return newMacOSCodePolicy(MacOSRuntimeSigningIdentifier)
}

func macOSDesktopCodePolicy() (macOSCodePolicy, error) {
	return newMacOSCodePolicy(MacOSDesktopSigningIdentifier)
}

func macOSLocalAppHostCodePolicy() (macOSCodePolicy, error) {
	return newMacOSCodePolicy(MacOSLocalAppHostIdentifier)
}

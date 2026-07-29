//go:build darwin && cgo

package protectedlocal

import (
	"fmt"
)

const (
	MacOSRuntimeStateLockFilename = "runtime.lock"
)

type macOSCodePolicy struct {
	executableRole       string
	teamID               string
	signingIdentifier    string
	directRequirement    string
	trustSetID           string
	requireAdHoc         bool
	requireTrustedAnchor bool
	requireNotarization  bool
}

func (policy macOSCodePolicy) validate() error {
	if !canonicalIdentityField(policy.executableRole) ||
		!canonicalIdentityField(policy.signingIdentifier) ||
		!validMacOSRequirement(policy.directRequirement) ||
		!canonicalIdentityField(policy.trustSetID) ||
		(policy.requireNotarization && !policy.requireTrustedAnchor) ||
		(policy.requireAdHoc && (policy.teamID != "" || policy.requireTrustedAnchor || policy.requireNotarization)) ||
		(!policy.requireAdHoc && (!validMacOSTeamID(policy.teamID) || !policy.requireTrustedAnchor)) {
		return fail(ReasonDesktopExecutableTrustFailed, false, "reinstall_runtime_service", fmt.Errorf("macOS direct code policy is incomplete"))
	}
	return nil
}

func macOSRuntimeCodePolicy() (macOSCodePolicy, error) {
	return loadMacOSCodePolicy(macOSRuntimeExecutableRole)
}

func macOSDesktopCodePolicy() (macOSCodePolicy, error) {
	policy, err := loadMacOSCodePolicy(macOSDesktopExecutableRole)
	if err != nil {
		return macOSCodePolicy{}, err
	}
	if err := verifyMacOSOuterBundleSeal(
		MacOSDesktopApplicationPath,
		policy.directRequirement,
		policy.teamID,
		policy.signingIdentifier,
		policy.requireTrustedAnchor,
		policy.requireNotarization,
		policy.requireAdHoc,
	); err != nil {
		return macOSCodePolicy{}, err
	}
	return policy, nil
}

func macOSLocalAppHostCodePolicy() (macOSCodePolicy, error) {
	return loadMacOSCodePolicy(macOSLocalHostExecutableRole)
}

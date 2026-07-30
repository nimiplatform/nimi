//go:build darwin && cgo

package protectedlocal

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

// MacOSTeamID is injected only by guarded production builds. The mutually
// exclusive local-development build requires an ad-hoc signature instead.
var MacOSTeamID string

func macOSDirectCodeSigner() (string, error) {
	teamID := strings.TrimSpace(MacOSTeamID)
	if teamID != MacOSTeamID || !validMacOSTeamID(teamID) {
		return "", fmt.Errorf("macOS Team ID is not embedded")
	}
	return teamID, nil
}

func newMacOSCodePolicy(signingIdentifier string) (macOSCodePolicy, error) {
	if !canonicalIdentityField(signingIdentifier) {
		return macOSCodePolicy{}, fmt.Errorf("macOS signing identifier is invalid")
	}
	teamID := ""
	directRequirement := fmt.Sprintf(`identifier "%s"`, signingIdentifier)
	if !macOSDirectTrustRequiresAdHoc {
		var err error
		teamID, err = macOSDirectCodeSigner()
		if err != nil {
			return macOSCodePolicy{}, err
		}
		directRequirement = fmt.Sprintf(
			`identifier "%s" and anchor apple generic and certificate leaf[subject.OU] = "%s"`,
			signingIdentifier,
			teamID,
		)
	}
	if macOSDirectTrustRequiresNotarization {
		directRequirement += " and certificate leaf[field.1.2.840.113635.100.6.1.13] exists"
	}
	policy := macOSCodePolicy{
		teamID:               teamID,
		signingIdentifier:    signingIdentifier,
		directRequirement:    directRequirement,
		requireAdHoc:         macOSDirectTrustRequiresAdHoc,
		requireTrustedAnchor: macOSDirectTrustRequiresTrustedAnchor,
		requireNotarization:  macOSDirectTrustRequiresNotarization,
	}
	if err := policy.validate(); err != nil {
		return macOSCodePolicy{}, err
	}
	return policy, nil
}

func validMacOSTeamID(value string) bool {
	if len(value) != 10 {
		return false
	}
	for _, character := range value {
		if (character < 'A' || character > 'Z') && (character < '0' || character > '9') {
			return false
		}
	}
	return true
}

func validMacOSRequirement(value string) bool {
	if value == "" || len(value) > 2048 || strings.TrimSpace(value) != value || !utf8.ValidString(value) {
		return false
	}
	for _, character := range value {
		if character > 0x7f || character == 0 || character < 0x20 {
			return false
		}
	}
	return true
}

//go:build darwin && cgo

package protectedlocal

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

const (
	macOSRuntimeExecutableRole   = "nimi_runtime_service"
	macOSDesktopExecutableRole   = "nimi_desktop"
	macOSLocalHostExecutableRole = "nimi_local_app_host"
)

type macOSRoleTrustRequirements struct {
	role              string
	trustSetID        string
	signingIdentifier string
}

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

func macOSRoleRequirements(role string) (macOSRoleTrustRequirements, error) {
	switch role {
	case macOSRuntimeExecutableRole:
		return macOSRoleTrustRequirements{
			role: role, trustSetID: MacOSRuntimeTrustSetID,
			signingIdentifier: MacOSRuntimeSigningIdentifier,
		}, nil
	case macOSDesktopExecutableRole:
		return macOSRoleTrustRequirements{
			role: role, trustSetID: MacOSDesktopTrustSetID,
			signingIdentifier: MacOSDesktopSigningIdentifier,
		}, nil
	case macOSLocalHostExecutableRole:
		return macOSRoleTrustRequirements{
			role: role, trustSetID: MacOSLocalAppHostTrustSet,
			signingIdentifier: MacOSLocalAppHostIdentifier,
		}, nil
	default:
		return macOSRoleTrustRequirements{}, fmt.Errorf("unknown macOS protected-local executable role")
	}
}

func loadMacOSCodePolicy(role string) (macOSCodePolicy, error) {
	requirements, err := macOSRoleRequirements(role)
	if err != nil {
		return macOSCodePolicy{}, err
	}
	teamID := ""
	directRequirement := fmt.Sprintf(`identifier "%s"`, requirements.signingIdentifier)
	if !macOSDirectTrustRequiresAdHoc {
		teamID, err = macOSDirectCodeSigner()
		if err != nil {
			return macOSCodePolicy{}, err
		}
		directRequirement = fmt.Sprintf(
			`identifier "%s" and anchor apple generic and certificate leaf[subject.OU] = "%s"`,
			requirements.signingIdentifier,
			teamID,
		)
	}
	if macOSDirectTrustRequiresNotarization {
		directRequirement += " and certificate leaf[field.1.2.840.113635.100.6.1.13] exists"
	}
	policy := macOSCodePolicy{
		executableRole:       requirements.role,
		teamID:               teamID,
		signingIdentifier:    requirements.signingIdentifier,
		directRequirement:    directRequirement,
		trustSetID:           requirements.trustSetID,
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

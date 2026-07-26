package localappkernel

import (
	"fmt"
	"strconv"
	"strings"
)

const macOSUnassignedAuditSessionID = ^uint32(0)

// ValidateVerifiedMacOSInteractiveUser accepts only the kernel peer euid and
// audit session extracted from LOCAL_PEERTOKEN. The Runtime service uid must
// never be supplied here, and an unassigned audit session is not interactive.
func ValidateVerifiedMacOSInteractiveUser(euid uint32, auditSessionID uint32) (VerifiedLocalOSUserIdentity, error) {
	if euid == 0 || auditSessionID == 0 || auditSessionID == macOSUnassignedAuditSessionID {
		return VerifiedLocalOSUserIdentity{}, fmt.Errorf("%w: verified macOS interactive euid and audit session", ErrInvalidArgument)
	}
	return VerifiedLocalOSUserIdentity{canonical: fmt.Sprintf("macos:euid:%d:audit-session:%d", euid, auditSessionID)}, nil
}

// MacOSInteractiveUser returns the platform sources only from an already
// validated macOS identity. The values are used by OS-owned account/profile
// lookup and are never serialized to an app or request surface.
func (identity VerifiedLocalOSUserIdentity) MacOSInteractiveUser() (uint32, uint32, bool) {
	parts := strings.Split(identity.canonical, ":")
	if len(parts) != 5 || parts[0] != "macos" || parts[1] != "euid" || parts[3] != "audit-session" {
		return 0, 0, false
	}
	euid, euidErr := strconv.ParseUint(parts[2], 10, 32)
	auditSessionID, auditErr := strconv.ParseUint(parts[4], 10, 32)
	if euidErr != nil || auditErr != nil || euid == 0 || auditSessionID == 0 || uint32(auditSessionID) == macOSUnassignedAuditSessionID {
		return 0, 0, false
	}
	return uint32(euid), uint32(auditSessionID), true
}

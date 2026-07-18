package localappkernel

import "fmt"

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

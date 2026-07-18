package localappkernel

import (
	"fmt"
	"strconv"
	"strings"
)

// ValidateVerifiedWindowsInteractiveUserSID accepts only a canonical SID
// obtained from the protected Windows peer token.
func ValidateVerifiedWindowsInteractiveUserSID(value string) (VerifiedLocalOSUserIdentity, error) {
	if value == "" || value != strings.TrimSpace(value) {
		return VerifiedLocalOSUserIdentity{}, fmt.Errorf("%w: verified Windows interactive-user SID", ErrInvalidArgument)
	}
	parts := strings.Split(value, "-")
	if len(parts) < 4 || parts[0] != "S" || parts[1] != "1" {
		return VerifiedLocalOSUserIdentity{}, fmt.Errorf("%w: verified Windows interactive-user SID", ErrInvalidArgument)
	}
	for _, component := range parts[2:] {
		if component == "" || (len(component) > 1 && component[0] == '0') {
			return VerifiedLocalOSUserIdentity{}, fmt.Errorf("%w: verified Windows interactive-user SID", ErrInvalidArgument)
		}
		if _, err := strconv.ParseUint(component, 10, 64); err != nil {
			return VerifiedLocalOSUserIdentity{}, fmt.Errorf("%w: verified Windows interactive-user SID", ErrInvalidArgument)
		}
	}
	return VerifiedLocalOSUserIdentity{canonical: "windows:sid:" + value}, nil
}

// WindowsInteractiveUserSID returns the platform source only from an already
// validated Windows identity. It is used by the Windows-only OS profile lookup
// and is never serialized to an app or request surface.
func (identity VerifiedLocalOSUserIdentity) WindowsInteractiveUserSID() (string, bool) {
	const prefix = "windows:sid:"
	if !strings.HasPrefix(identity.canonical, prefix) {
		return "", false
	}
	return strings.TrimPrefix(identity.canonical, prefix), true
}

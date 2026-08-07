package protectedlocal

import (
	"crypto/sha256"
	"fmt"
	"strconv"
	"strings"
)

type windowsSourcePipeRole string

const (
	windowsSourceDesktopPipeRole  windowsSourcePipeRole = "desktop"
	windowsSourceLocalAppPipeRole windowsSourcePipeRole = "local-app"
)

type windowsSourceACLPolicyEntry struct {
	Principal   string
	Allow       bool
	Inherited   bool
	FullControl bool
}

func windowsSourceLocalDevelopmentPipeName(userSID string, role windowsSourcePipeRole) (string, error) {
	if !validWindowsSourceUserSID(userSID) || (role != windowsSourceDesktopPipeRole && role != windowsSourceLocalAppPipeRole) {
		return "", fmt.Errorf("canonical current-user SID and fixed pipe role are required")
	}
	digest := sha256.Sum256([]byte(strings.ToLower(userSID)))
	return fmt.Sprintf(`\\.\pipe\nimi-runtime-source-local-development-%x-%s-v1`, digest, role), nil
}

func windowsSourceOwnerOnlyPipeSDDL(userSID string) (string, error) {
	if !validWindowsSourceUserSID(userSID) {
		return "", fmt.Errorf("canonical current-user SID is required")
	}
	return fmt.Sprintf("O:%sD:P(A;;GA;;;%s)", userSID, userSID), nil
}

func validateWindowsSourceOwnerOnlyACLPolicy(userSID string, entries []windowsSourceACLPolicyEntry) error {
	if !validWindowsSourceUserSID(userSID) || len(entries) != 1 {
		return fmt.Errorf("exact one-entry current-user ACL is required")
	}
	entry := entries[0]
	if entry.Principal != userSID || !entry.Allow || entry.Inherited || !entry.FullControl {
		return fmt.Errorf("ACL must grant only exact non-inherited current-user full control")
	}
	return nil
}

func validWindowsSourceUserSID(value string) bool {
	if value == "" || value != strings.TrimSpace(value) {
		return false
	}
	parts := strings.Split(value, "-")
	if len(parts) < 4 || parts[0] != "S" || parts[1] != "1" {
		return false
	}
	for _, part := range parts[2:] {
		if part == "" || (len(part) > 1 && part[0] == '0') {
			return false
		}
		if _, err := strconv.ParseUint(part, 10, 64); err != nil {
			return false
		}
	}
	return true
}

//go:build windows

package grpcserver

import (
	"fmt"
	"path/filepath"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

const windowsProfileListRegistryPath = `SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList`

// ResolveProtectedProductControlRoot derives the fixed Product Control
// directory from the OS-owned profile mapping for the already-verified
// interactive-user SID. Environment, argv, Runtime configuration, and request
// values are not inputs.
func ResolveProtectedProductControlRoot(identity localappkernel.VerifiedLocalOSUserIdentity) (string, error) {
	profileRoot, err := resolveProtectedWindowsInteractiveUserProfileRoot(identity)
	if err != nil {
		return "", err
	}
	return filepath.Join(profileRoot, ".nimi"), nil
}

// ResolveCurrentProcessProductControlRoot resolves the same fixed locator for
// an explicit non-production Runtime running as the interactive user.
func ResolveCurrentProcessProductControlRoot() (string, error) {
	tokenUser, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil || tokenUser == nil || tokenUser.User.Sid == nil {
		return "", fmt.Errorf("resolve current Windows user SID: %w", err)
	}
	identity, err := localappkernel.ValidateVerifiedWindowsInteractiveUserSID(tokenUser.User.Sid.String())
	if err != nil {
		return "", fmt.Errorf("validate current Windows user SID: %w", err)
	}
	return ResolveProtectedProductControlRoot(identity)
}

func resolveProtectedWindowsInteractiveUserProfileRoot(identity localappkernel.VerifiedLocalOSUserIdentity) (string, error) {
	sid, ok := identity.WindowsInteractiveUserSID()
	if !ok {
		return "", fmt.Errorf("verified Windows interactive-user identity is required")
	}
	sid = strings.TrimSpace(sid)
	if !strings.HasPrefix(sid, "S-1-") || strings.ContainsAny(sid, `\/`) {
		return "", fmt.Errorf("verified interactive-user SID is invalid")
	}
	key, err := registry.OpenKey(registry.LOCAL_MACHINE, windowsProfileListRegistryPath+`\`+sid, registry.QUERY_VALUE)
	if err != nil {
		return "", fmt.Errorf("open verified interactive-user profile mapping: %w", err)
	}
	defer func() { _ = key.Close() }()
	raw, valueType, err := key.GetStringValue("ProfileImagePath")
	if err != nil {
		return "", fmt.Errorf("read verified interactive-user profile mapping: %w", err)
	}
	return resolveWindowsProfileImagePath(raw, valueType)
}

func resolveWindowsProfileImagePath(raw string, valueType uint32) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "", fmt.Errorf("verified interactive-user profile mapping is empty")
	}
	if valueType == registry.EXPAND_SZ {
		const systemDriveToken = `%SystemDrive%`
		if strings.Contains(value, "%") {
			if len(value) < len(systemDriveToken) || !strings.EqualFold(value[:len(systemDriveToken)], systemDriveToken) {
				return "", fmt.Errorf("verified interactive-user profile mapping uses an unsupported expansion")
			}
			windowsDirectory, err := windows.GetSystemWindowsDirectory()
			if err != nil {
				return "", fmt.Errorf("resolve Windows system drive: %w", err)
			}
			volume := filepath.VolumeName(windowsDirectory)
			if volume == "" {
				return "", fmt.Errorf("resolve Windows system drive")
			}
			value = volume + value[len(systemDriveToken):]
		}
	} else if valueType != registry.SZ {
		return "", fmt.Errorf("verified interactive-user profile mapping has an invalid type")
	}
	if strings.Contains(value, "%") {
		return "", fmt.Errorf("verified interactive-user profile mapping contains an unresolved expansion")
	}
	cleaned := filepath.Clean(value)
	if !filepath.IsAbs(cleaned) || windowsProductControlPathIsVolumeRoot(cleaned) {
		return "", fmt.Errorf("verified interactive-user profile mapping is not an absolute non-root path")
	}
	return cleaned, nil
}

func windowsProductControlPathIsVolumeRoot(value string) bool {
	volume := filepath.VolumeName(value)
	return volume != "" &&
		(strings.EqualFold(value, volume) ||
			strings.EqualFold(value, volume+string(filepath.Separator)))
}

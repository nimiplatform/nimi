//go:build windows

package grpcserver

import (
	"fmt"
	"path/filepath"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

const windowsProfileListRegistryPath = `SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList`

func resolveProtectedProductControlDataRootProposal(identity localappkernel.VerifiedLocalOSUserIdentity, acceptance *config.DevKernelCheckpointAcceptance) (string, error) {
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
	return resolveProtectedProductControlDataRootProposalFromProfileMapping(raw, valueType, acceptance)
}

func resolveProtectedProductControlDataRootProposalFromProfileMapping(raw string, valueType uint32, acceptance *config.DevKernelCheckpointAcceptance) (string, error) {
	profileRoot, err := resolveWindowsProfileImagePath(raw, valueType)
	if err != nil {
		return "", err
	}
	// ProfileList is the OS-owned mapping authority. The restricted service SID
	// intentionally has no requirement to traverse an interactive user's
	// profile directory, and the proposal neither creates nor selects the path.
	return checkpointProductControlDataRootProposal(profileRoot, acceptance)
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
	if !filepath.IsAbs(cleaned) || cleaned == filepath.VolumeName(cleaned)+string(filepath.Separator) {
		return "", fmt.Errorf("verified interactive-user profile mapping is not an absolute non-root path")
	}
	return cleaned, nil
}

package app

import (
	"errors"
	"fmt"
	"path/filepath"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/apppermission"
)

type localDevelopmentManifestPermissionReason string

const (
	localDevelopmentManifestPermissionReserved localDevelopmentManifestPermissionReason = "LOCAL_DEVELOPMENT_MANIFEST_PERMISSION_RESERVED"
	localDevelopmentManifestPermissionUnknown  localDevelopmentManifestPermissionReason = "LOCAL_DEVELOPMENT_MANIFEST_PERMISSION_UNKNOWN"
)

type localDevelopmentManifestPermissionError struct {
	reason       localDevelopmentManifestPermissionReason
	permissionID string
}

func (failure *localDevelopmentManifestPermissionError) Error() string {
	if failure == nil {
		return "local-development manifest permission validation failed"
	}
	switch failure.reason {
	case localDevelopmentManifestPermissionReserved:
		return fmt.Sprintf("local-development permission %s is reserved pending admission", failure.permissionID)
	case localDevelopmentManifestPermissionUnknown:
		return fmt.Sprintf("local-development permission id %s is unknown", failure.permissionID)
	default:
		return "local-development manifest permission validation failed"
	}
}

func (failure *localDevelopmentManifestPermissionError) Reason() localDevelopmentManifestPermissionReason {
	if failure == nil {
		return ""
	}
	return failure.reason
}

func (failure *localDevelopmentManifestPermissionError) PermissionID() string {
	if failure == nil {
		return ""
	}
	return failure.permissionID
}

func localDevelopmentManifestPermissionFailure(reason localDevelopmentManifestPermissionReason, permissionID string) error {
	return &localDevelopmentManifestPermissionError{reason: reason, permissionID: permissionID}
}

func localDevelopmentManifestPermissionFailureFromError(err error) (*localDevelopmentManifestPermissionError, bool) {
	var failure *localDevelopmentManifestPermissionError
	if !errors.As(err, &failure) || failure == nil || failure.Reason() == "" {
		return nil, false
	}
	return failure, true
}

func resolveLocalDevelopmentProject(rootPath string, expectedAppID string, shellKind runtimev1.LocalDevelopmentShellKind, accountID string, accountGeneration uint64) (localDevelopmentProjectSnapshot, error) {
	root, manifestPath, manifest, err := loadLocalAppManifest(rootPath)
	if err != nil {
		return localDevelopmentProjectSnapshot{}, err
	}
	appID := firstNonEmpty(manifest.AppID, manifest.AppIDCamel)
	displayName := firstNonEmpty(manifest.DisplayName, manifest.DisplayNameCamel)
	if appID == "" || !safeLocalAppID(appID) || appID != strings.TrimSpace(appID) || displayName == "" || displayName != strings.TrimSpace(displayName) {
		return localDevelopmentProjectSnapshot{}, errors.New("local-development manifest requires canonical app_id and display_name")
	}
	if expected := strings.TrimSpace(expectedAppID); expected == "" || expected != expectedAppID || expected != appID {
		return localDevelopmentProjectSnapshot{}, fmt.Errorf("local-development manifest app_id %s does not match expected app_id %s", appID, expectedAppID)
	}
	permissionRequirements, err := normalizeLocalDevelopmentPermissionRequests(
		manifest.Permissions,
		manifest.LocalDevelopment.LegacyRuntimeScopedBindingRequests,
	)
	if err != nil {
		return localDevelopmentProjectSnapshot{}, err
	}
	project := localDevelopmentProjectSnapshot{
		AppID:                            appID,
		DisplayName:                      displayName,
		ProjectRoot:                      filepath.Clean(root),
		ManifestPath:                     filepath.Clean(manifestPath),
		ShellKind:                        shellKind,
		AccountID:                        strings.TrimSpace(accountID),
		AccountGeneration:                accountGeneration,
		PermissionRequirements:           permissionRequirements,
		PermissionRequirementFingerprint: localDevelopmentPermissionRequirementFingerprint(permissionRequirements),
	}
	if err := validateLocalDevelopmentProject(project); err != nil {
		return localDevelopmentProjectSnapshot{}, err
	}
	return project, nil
}

func normalizeLocalDevelopmentPermissionRequests(requests []localAppManifestPermissionRequest, legacyRuntimeBindingRequests any) ([]localDevelopmentPermissionRequirement, error) {
	return normalizeLocalDevelopmentPermissionRequestsWithCatalog(requests, legacyRuntimeBindingRequests, apppermission.Lookup)
}

func normalizeLocalDevelopmentPermissionRequestsWithCatalog(requests []localAppManifestPermissionRequest, legacyRuntimeBindingRequests any, lookup func(string) (apppermission.Descriptor, bool)) ([]localDevelopmentPermissionRequirement, error) {
	if legacyRuntimeBindingRequests != nil {
		return nil, errors.New("local-development runtime_scoped_binding_requests is retired")
	}
	if lookup == nil {
		return nil, errors.New("local-development permission catalog is unavailable")
	}
	permissions := make([]localDevelopmentPermissionRequirement, 0, len(requests))
	seen := make(map[string]struct{}, len(requests))
	for index, request := range requests {
		permissionID := strings.TrimSpace(request.PermissionID)
		reason := strings.TrimSpace(request.Reason)
		if permissionID == "" || permissionID != request.PermissionID || reason == "" || reason != request.Reason || len([]byte(reason)) > 240 {
			return nil, fmt.Errorf("local-development permission request %d is not canonical", index)
		}
		descriptor, known := lookup(permissionID)
		if !known {
			return nil, localDevelopmentManifestPermissionFailure(localDevelopmentManifestPermissionUnknown, permissionID)
		}
		if descriptor.ID != permissionID {
			return nil, errors.New("local-development permission catalog returned a mismatched id")
		}
		if _, duplicate := seen[permissionID]; duplicate {
			return nil, fmt.Errorf("local-development permission %s is duplicated", permissionID)
		}
		if descriptor.Admission == apppermission.AdmissionReserved {
			return nil, localDevelopmentManifestPermissionFailure(localDevelopmentManifestPermissionReserved, permissionID)
		}
		if descriptor.Admission != apppermission.AdmissionAdmitted {
			return nil, errors.New("local-development permission catalog returned an invalid admission posture")
		}
		if !descriptor.ManifestAllowed {
			return nil, fmt.Errorf("local-development permission %s is forbidden in manifests", permissionID)
		}
		seen[permissionID] = struct{}{}
		permissions = append(permissions, localDevelopmentPermissionRequirement{PermissionID: permissionID, Reason: reason})
	}
	sort.Slice(permissions, func(left, right int) bool {
		return permissions[left].PermissionID < permissions[right].PermissionID
	})
	return permissions, nil
}

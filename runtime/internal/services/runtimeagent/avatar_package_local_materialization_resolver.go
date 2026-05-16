package runtimeagent

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const localAvatarPackageMaterializationRefPrefix = "agent-center-avatar-package:"

type LocalAvatarPackageProjectionResolver struct {
	dataRoot string
}

type localAgentCenterConfigFile struct {
	SchemaVersion int    `json:"schema_version"`
	ConfigKind    string `json:"config_kind"`
	AccountID     string `json:"account_id"`
	OwnerUserID   string `json:"owner_user_id"`
	RealmAgentID  string `json:"realm_agent_id"`
	LocalAgentRef string `json:"local_agent_ref"`
	Modules       struct {
		AvatarPackage localAgentCenterAvatarPackageConfig `json:"avatar_package"`
	} `json:"modules"`
}

type localAgentCenterAvatarPackageConfig struct {
	SchemaVersion               int    `json:"schema_version"`
	AvatarPackageRef            string `json:"avatar_package_ref"`
	BackendKind                 string `json:"backend_kind"`
	BackendCapabilityProfileRef string `json:"backend_capability_profile_ref"`
	UpdatedAt                   string `json:"updated_at"`
	Provenance                  struct {
		Source      string `json:"source"`
		EvidenceRef string `json:"evidence_ref"`
	} `json:"provenance"`
}

type localAvatarPackageManifest struct {
	ManifestVersion int                        `json:"manifest_version"`
	PackageVersion  string                     `json:"package_version"`
	PackageID       string                     `json:"package_id"`
	Kind            string                     `json:"kind"`
	EntryFile       string                     `json:"entry_file"`
	RequiredFiles   []string                   `json:"required_files"`
	ContentDigest   string                     `json:"content_digest"`
	Files           []localAvatarPackageFile   `json:"files"`
	Import          localAvatarPackageImport   `json:"import"`
	Limits          map[string]json.RawMessage `json:"limits"`
}

type localAvatarPackageFile struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
	Bytes  uint64 `json:"bytes"`
	MIME   string `json:"mime"`
}

type localAvatarPackageImport struct {
	ImportedAt        string `json:"imported_at"`
	SourceLabel       string `json:"source_label"`
	SourceFingerprint string `json:"source_fingerprint"`
}

func NewLocalAvatarPackageProjectionResolver(dataRoot string) *LocalAvatarPackageProjectionResolver {
	return &LocalAvatarPackageProjectionResolver{dataRoot: strings.TrimSpace(dataRoot)}
}

func (r *LocalAvatarPackageProjectionResolver) ResolveAvatarPackageLaunchProjection(_ context.Context, req AvatarPackageLaunchProjectionRequest) (*runtimev1.ResolveAvatarPackageLaunchProjectionResponse, error) {
	dataRoot, err := r.resolveDataRoot()
	if err != nil {
		return nil, err
	}
	if err := validateLocalAvatarPackageRequest(req); err != nil {
		return nil, err
	}
	config, err := readLocalAgentCenterConfig(dataRoot, req)
	if err != nil {
		return nil, err
	}
	packageConfig := config.Modules.AvatarPackage
	packageID := strings.TrimSpace(packageConfig.AvatarPackageRef)
	backendKind := strings.TrimSpace(packageConfig.BackendKind)
	profileRef := strings.TrimSpace(packageConfig.BackendCapabilityProfileRef)
	if packageID == "" || backendKind == "" || profileRef == "" {
		return nil, fmt.Errorf("runtime avatar package projection local materialization is incomplete")
	}
	if backendKind != "live2d" && backendKind != "vrm" {
		return nil, fmt.Errorf("runtime avatar package projection local materialization has unsupported backend_kind")
	}
	if !strings.HasPrefix(packageID, backendKind+"_") {
		return nil, fmt.Errorf("runtime avatar package projection local materialization package id does not match backend kind")
	}
	manifest, err := readLocalAvatarPackageManifest(dataRoot, req.AccountPathScope(), backendKind, packageID)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(manifest.PackageID) != packageID || strings.TrimSpace(manifest.Kind) != backendKind {
		return nil, fmt.Errorf("runtime avatar package projection local manifest identity mismatch")
	}
	entryFile := strings.TrimSpace(manifest.EntryFile)
	if !isSafeAvatarPackageRelativePath(entryFile) || !strings.HasPrefix(entryFile, "files/") {
		return nil, fmt.Errorf("runtime avatar package projection local manifest entry_file is invalid")
	}
	if backendKind == "live2d" && !strings.HasSuffix(entryFile, ".model3.json") {
		return nil, fmt.Errorf("runtime avatar package projection local manifest live2d entry is invalid")
	}
	if backendKind == "vrm" && !strings.HasSuffix(entryFile, ".vrm") {
		return nil, fmt.Errorf("runtime avatar package projection local manifest vrm entry is invalid")
	}
	bundleMembers := manifest.bundleMemberAssetIDs()
	if !stringSliceContains(bundleMembers, entryFile) {
		return nil, fmt.Errorf("runtime avatar package projection local manifest files missing entry_file")
	}
	requiredAssetIDs := normalizeAssetIDs(manifest.RequiredFiles)
	if len(requiredAssetIDs) == 0 || !stringSliceContains(requiredAssetIDs, entryFile) {
		return nil, fmt.Errorf("runtime avatar package projection local manifest required_files missing entry_file")
	}
	materializationRef := localAvatarPackageMaterializationRef(req.OwnerUserID, req.LocalAgentRef, backendKind, packageID)
	layout := &runtimev1.RuntimeAvatarPackageModelLayout{
		LayoutVersion:    1,
		BackendKind:      backendKind,
		EntryAssetId:     entryFile,
		RuntimeRoot:      "files",
		RequiredAssetIds: requiredAssetIDs,
	}
	if backendKind == "live2d" {
		layout.Live2D = &runtimev1.RuntimeAvatarPackageLive2DLayout{
			Model3JsonAssetId: entryFile,
			Model3JsonPath:    entryFile,
		}
	} else {
		layout.Vrm = &runtimev1.RuntimeAvatarPackageVrmLayout{
			VrmAssetId:  entryFile,
			VrmFilePath: entryFile,
		}
	}
	return &runtimev1.ResolveAvatarPackageLaunchProjectionResponse{
		AvatarPackageRef:            packageID,
		PackageKind:                 "avatar",
		PackageId:                   packageID,
		BundleId:                    "local-materialization:" + packageID,
		BundleMemberAssetIds:        bundleMembers,
		BackendKind:                 backendKind,
		BackendCapabilityProfileRef: profileRef,
		AvatarModelLayout:           layout,
		Provenance: &runtimev1.RuntimeAvatarPackageProvenance{
			SourceType:        "imported_local_materialization",
			SourceFingerprint: localAvatarPackageSourceFingerprint(manifest),
			AdmittedAt:        localAvatarPackageAdmittedAt(packageConfig, manifest),
			Validator:         "runtime.local-avatar-package-materialization",
		},
		CompatibilityDiagnostics: []*runtimev1.RuntimeAvatarPackageCompatibilityDiagnostic{{
			Code:     "local-materialization-ready",
			Severity: "info",
			Source:   "runtime",
		}},
		Status:             "published",
		IsReady:            true,
		ReadinessIssues:    nil,
		MaterializationRef: materializationRef,
		ObservedAt:         time.Now().UTC().Format(time.RFC3339Nano),
	}, nil
}

func (r *LocalAvatarPackageProjectionResolver) resolveDataRoot() (string, error) {
	if r != nil && r.dataRoot != "" {
		return filepath.Clean(r.dataRoot), nil
	}
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return "", fmt.Errorf("runtime avatar package projection data root unavailable")
	}
	return filepath.Join(home, ".nimi", "data"), nil
}

func (req AvatarPackageLaunchProjectionRequest) AccountPathScope() localAvatarPackagePathScope {
	return localAvatarPackagePathScope{
		AccountID:     req.OwnerUserID,
		LocalAgentRef: req.LocalAgentRef,
	}
}

type localAvatarPackagePathScope struct {
	AccountID     string
	LocalAgentRef string
}

func validateLocalAvatarPackageRequest(req AvatarPackageLaunchProjectionRequest) error {
	if strings.TrimSpace(req.OwnerUserID) == "" || strings.TrimSpace(req.RealmAgentID) == "" || strings.TrimSpace(req.LocalAgentRef) == "" {
		return fmt.Errorf("runtime avatar package projection local request identity is incomplete")
	}
	if req.LocalAgentRef != "local-agent:"+req.OwnerUserID+":"+req.RealmAgentID {
		return fmt.Errorf("runtime avatar package projection localAgentRef mismatch")
	}
	if strings.TrimSpace(req.AvatarInstanceID) == "" {
		return fmt.Errorf("runtime avatar package projection avatarInstanceID is required")
	}
	return nil
}

func readLocalAgentCenterConfig(dataRoot string, req AvatarPackageLaunchProjectionRequest) (*localAgentCenterConfigFile, error) {
	path := filepath.Join(
		dataRoot,
		"accounts",
		agentCenterPathSegment(req.OwnerUserID),
		"agents",
		agentCenterPathSegment(req.LocalAgentRef),
		"agent-center",
		"config.json",
	)
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("runtime avatar package projection local config unavailable: %w", err)
	}
	var config localAgentCenterConfigFile
	if err := json.Unmarshal(raw, &config); err != nil {
		return nil, fmt.Errorf("runtime avatar package projection local config invalid: %w", err)
	}
	if config.SchemaVersion != 1 || config.ConfigKind != "agent_center_local_config" {
		return nil, fmt.Errorf("runtime avatar package projection local config kind is invalid")
	}
	if config.AccountID != req.OwnerUserID || config.OwnerUserID != req.OwnerUserID || config.RealmAgentID != req.RealmAgentID || config.LocalAgentRef != req.LocalAgentRef {
		return nil, fmt.Errorf("runtime avatar package projection local config scope mismatch")
	}
	return &config, nil
}

func readLocalAvatarPackageManifest(dataRoot string, scope localAvatarPackagePathScope, backendKind string, packageID string) (*localAvatarPackageManifest, error) {
	path := filepath.Join(
		dataRoot,
		"accounts",
		agentCenterPathSegment(scope.AccountID),
		"agents",
		agentCenterPathSegment(scope.LocalAgentRef),
		"agent-center",
		"modules",
		"avatar_package",
		"packages",
		backendKind,
		packageID,
		"manifest.json",
	)
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("runtime avatar package projection local manifest unavailable: %w", err)
	}
	var manifest localAvatarPackageManifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return nil, fmt.Errorf("runtime avatar package projection local manifest invalid: %w", err)
	}
	if manifest.ManifestVersion != 1 {
		return nil, fmt.Errorf("runtime avatar package projection local manifest_version is invalid")
	}
	return &manifest, nil
}

func canUseRawAgentCenterPathSegment(value string) bool {
	body := strings.TrimPrefix(value, "~")
	if body == "" || len(value) > 128 {
		return false
	}
	for index, r := range body {
		if index == 0 && !((r >= 'a' && r <= 'z') || (r >= '0' && r <= '9')) {
			return false
		}
		if !((r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' || r == '-') {
			return false
		}
	}
	return true
}

func agentCenterPathSegment(value string) string {
	if canUseRawAgentCenterPathSegment(value) {
		return value
	}
	sum := sha256.Sum256([]byte(value))
	return "id_" + hex.EncodeToString(sum[:])[:24]
}

func localAvatarPackageMaterializationRef(accountID string, localAgentRef string, backendKind string, packageID string) string {
	return fmt.Sprintf(
		"%s%s:%s:%s:%s",
		localAvatarPackageMaterializationRefPrefix,
		agentCenterPathSegment(accountID),
		agentCenterPathSegment(localAgentRef),
		backendKind,
		packageID,
	)
}

func (manifest *localAvatarPackageManifest) bundleMemberAssetIDs() []string {
	if manifest == nil {
		return nil
	}
	seen := map[string]struct{}{}
	out := make([]string, 0, len(manifest.Files)+len(manifest.RequiredFiles))
	for _, item := range manifest.Files {
		path := strings.TrimSpace(item.Path)
		if path == "" {
			continue
		}
		if _, ok := seen[path]; ok {
			continue
		}
		seen[path] = struct{}{}
		out = append(out, path)
	}
	for _, path := range normalizeAssetIDs(manifest.RequiredFiles) {
		if _, ok := seen[path]; ok {
			continue
		}
		seen[path] = struct{}{}
		out = append(out, path)
	}
	return out
}

func normalizeAssetIDs(values []string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		out = append(out, trimmed)
	}
	return out
}

func stringSliceContains(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

func isSafeAvatarPackageRelativePath(value string) bool {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" || strings.Contains(trimmed, "\\") || filepath.IsAbs(trimmed) {
		return false
	}
	for _, part := range strings.Split(trimmed, "/") {
		if part == "" || part == "." || part == ".." {
			return false
		}
	}
	return true
}

func localAvatarPackageSourceFingerprint(manifest *localAvatarPackageManifest) string {
	if manifest != nil && strings.TrimSpace(manifest.Import.SourceFingerprint) != "" {
		return strings.TrimSpace(manifest.Import.SourceFingerprint)
	}
	if manifest != nil && strings.TrimSpace(manifest.ContentDigest) != "" {
		return strings.TrimSpace(manifest.ContentDigest)
	}
	return "sha256:local-avatar-package-materialization"
}

func localAvatarPackageAdmittedAt(config localAgentCenterAvatarPackageConfig, manifest *localAvatarPackageManifest) string {
	if strings.TrimSpace(config.UpdatedAt) != "" {
		return strings.TrimSpace(config.UpdatedAt)
	}
	if manifest != nil && strings.TrimSpace(manifest.Import.ImportedAt) != "" {
		return strings.TrimSpace(manifest.Import.ImportedAt)
	}
	return time.Now().UTC().Format(time.RFC3339Nano)
}

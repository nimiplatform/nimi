package localservice

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

// localCapabilityAssetInventorySnapshot is a private LocalAsset-owner view
// used by one Add/Reproject transaction. It is not persisted and is not a
// readiness or health projection.
type localCapabilityAssetInventorySnapshot struct {
	modelsRoot string
	assets     []*runtimev1.LocalAssetRecord
}

type localCapabilityAssetIdentityFingerprint struct {
	LocalAssetID   string
	AssetID        string
	Kind           runtimev1.LocalAssetKind
	Family         string
	Engine         string
	Entry          string
	DeclaredHash   string
	BundleManifest string
	LogicalModel   string
	SourceRepo     string
	ArtifactRoles  string
	Capabilities   string
	Removed        bool
}

func (snapshot localCapabilityAssetInventorySnapshot) exactAsset(localAssetID string) *runtimev1.LocalAssetRecord {
	localAssetID = strings.TrimSpace(localAssetID)
	for _, asset := range snapshot.assets {
		if asset != nil && strings.TrimSpace(asset.GetLocalAssetId()) == localAssetID {
			return cloneLocalAsset(asset)
		}
	}
	return nil
}

func (snapshot localCapabilityAssetInventorySnapshot) exactAssetStillMatchesLocked(s *Service, localAssetID string) bool {
	if s == nil || strings.TrimSpace(s.localModelsPath) != snapshot.modelsRoot {
		return false
	}
	before, beforeOK := exactLocalCapabilityAssetFingerprint(snapshot.assets, localAssetID)
	current, currentOK := exactLocalCapabilityAssetFingerprintFromRecord(s.assets[strings.TrimSpace(localAssetID)])
	return beforeOK && currentOK && reflect.DeepEqual(before, current)
}

func exactLocalCapabilityAssetFingerprint(assets []*runtimev1.LocalAssetRecord, localAssetID string) (localCapabilityAssetIdentityFingerprint, bool) {
	localAssetID = strings.TrimSpace(localAssetID)
	for _, asset := range assets {
		if asset != nil && strings.TrimSpace(asset.GetLocalAssetId()) == localAssetID {
			return exactLocalCapabilityAssetFingerprintFromRecord(asset)
		}
	}
	return localCapabilityAssetIdentityFingerprint{}, false
}

func exactLocalCapabilityAssetFingerprintFromRecord(asset *runtimev1.LocalAssetRecord) (localCapabilityAssetIdentityFingerprint, bool) {
	if asset == nil || strings.TrimSpace(asset.GetLocalAssetId()) == "" {
		return localCapabilityAssetIdentityFingerprint{}, false
	}
	roles := normalizeStringSlice(asset.GetArtifactRoles())
	capabilities := normalizeStringSlice(asset.GetCapabilities())
	sort.Strings(roles)
	sort.Strings(capabilities)
	return localCapabilityAssetIdentityFingerprint{
		LocalAssetID:   strings.TrimSpace(asset.GetLocalAssetId()),
		AssetID:        strings.TrimSpace(asset.GetAssetId()),
		Kind:           asset.GetKind(),
		Family:         strings.TrimSpace(asset.GetFamily()),
		Engine:         strings.TrimSpace(asset.GetEngine()),
		Entry:          strings.TrimSpace(asset.GetEntry()),
		DeclaredHash:   exactDeclaredContentSHA256(asset),
		BundleManifest: localCapabilityBundleFingerprint(asset),
		LogicalModel:   strings.TrimSpace(asset.GetLogicalModelId()),
		SourceRepo:     strings.TrimSpace(asset.GetSource().GetRepo()),
		ArtifactRoles:  strings.Join(roles, "\x00"),
		Capabilities:   strings.Join(capabilities, "\x00"),
		Removed:        asset.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_REMOVED,
	}, true
}

func (s *Service) snapshotLocalCapabilityAssetInventory() localCapabilityAssetInventorySnapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.snapshotLocalCapabilityAssetInventoryLocked()
}

func (s *Service) snapshotLocalCapabilityAssetInventoryLocked() localCapabilityAssetInventorySnapshot {
	assets := make([]*runtimev1.LocalAssetRecord, 0, len(s.assets))
	for _, asset := range s.assets {
		if cloned := cloneLocalAsset(asset); cloned != nil {
			assets = append(assets, cloned)
		}
	}
	sort.Slice(assets, func(i, j int) bool {
		return assets[i].GetLocalAssetId() < assets[j].GetLocalAssetId()
	})
	return localCapabilityAssetInventorySnapshot{
		modelsRoot: strings.TrimSpace(s.localModelsPath),
		assets:     assets,
	}
}

func (snapshot localCapabilityAssetInventorySnapshot) stillMatchesLocked(s *Service, preferredContentIDs map[string]struct{}) bool {
	if len(preferredContentIDs) == 0 {
		return true
	}
	if strings.TrimSpace(s.localModelsPath) != snapshot.modelsRoot {
		return false
	}
	current := make([]*runtimev1.LocalAssetRecord, 0, len(s.assets))
	for _, asset := range s.assets {
		if cloned := cloneLocalAsset(asset); cloned != nil {
			current = append(current, cloned)
		}
	}
	return reflect.DeepEqual(
		relevantLocalCapabilityAssetFingerprints(snapshot.assets, preferredContentIDs),
		relevantLocalCapabilityAssetFingerprints(current, preferredContentIDs),
	)
}

func relevantLocalCapabilityAssetFingerprints(assets []*runtimev1.LocalAssetRecord, preferredContentIDs map[string]struct{}) map[string]localCapabilityAssetIdentityFingerprint {
	result := make(map[string]localCapabilityAssetIdentityFingerprint)
	for _, asset := range assets {
		contentSHA256 := exactDeclaredContentSHA256(asset)
		verifiedContentID := normalizeVerifiedContentID("sha256:" + contentSHA256)
		if _, relevant := preferredContentIDs[verifiedContentID]; !relevant {
			continue
		}
		roles := normalizeStringSlice(asset.GetArtifactRoles())
		capabilities := normalizeStringSlice(asset.GetCapabilities())
		sort.Strings(roles)
		sort.Strings(capabilities)
		localAssetID := strings.TrimSpace(asset.GetLocalAssetId())
		result[localAssetID] = localCapabilityAssetIdentityFingerprint{
			LocalAssetID:   localAssetID,
			AssetID:        strings.TrimSpace(asset.GetAssetId()),
			Kind:           asset.GetKind(),
			Family:         strings.TrimSpace(asset.GetFamily()),
			Engine:         strings.TrimSpace(asset.GetEngine()),
			Entry:          strings.TrimSpace(asset.GetEntry()),
			DeclaredHash:   contentSHA256,
			BundleManifest: localCapabilityBundleFingerprint(asset),
			LogicalModel:   strings.TrimSpace(asset.GetLogicalModelId()),
			SourceRepo:     strings.TrimSpace(asset.GetSource().GetRepo()),
			ArtifactRoles:  strings.Join(roles, "\x00"),
			Capabilities:   strings.Join(capabilities, "\x00"),
			Removed:        asset.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_REMOVED,
		}
	}
	return result
}

// verifyLocalCapabilityAssetContent is the LocalAsset owner's one-shot
// resolution check. It verifies only a record whose declared identity exactly
// matches the preferred content. The result is neither persisted as health nor
// polled; later byte loss does not clear an already committed binding.
func (s *Service) verifyLocalCapabilityAssetContent(asset *runtimev1.LocalAssetRecord, modelsRoot string, preferredContentID string) (capabilitydriver.AssetDescriptor, runtimev1.LocalCapabilityReason, bool) {
	if asset == nil || strings.TrimSpace(asset.GetLocalAssetId()) == "" || asset.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_REMOVED {
		return capabilitydriver.AssetDescriptor{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED, false
	}
	bundleEntries, bundleErr := localCapabilityBundleEntryDescriptors(asset)
	if bundleErr != nil {
		return capabilitydriver.AssetDescriptor{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_UNVERIFIED, false
	}
	contentSHA256 := exactDeclaredContentSHA256(asset)
	declaredContentID := normalizeVerifiedContentID("sha256:" + contentSHA256)
	if declaredContentID == "" || declaredContentID != preferredContentID {
		return capabilitydriver.AssetDescriptor{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED, false
	}

	var formatProbe []byte
	if len(bundleEntries) > 0 {
		bundleRoot := runtimeManagedBundleDir(modelsRoot, asset)
		for index, entry := range asset.GetBundleEntries() {
			entryPath := filepath.Join(bundleRoot, filepath.FromSlash(entry.GetRelativePath()))
			if _, reason := verifyLocalCapabilityAssetFile(modelsRoot, entryPath, bundleEntries[index].SHA256); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
				return capabilitydriver.AssetDescriptor{}, reason, true
			}
		}
	} else {
		entryPath, err := resolveManagedModelEntryAbsolutePath(modelsRoot, asset)
		if err != nil {
			return capabilitydriver.AssetDescriptor{}, localCapabilityAssetVerificationReason(err), true
		}
		var reason runtimev1.LocalCapabilityReason
		formatProbe, reason = verifyLocalCapabilityAssetFile(modelsRoot, entryPath, contentSHA256)
		if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
			return capabilitydriver.AssetDescriptor{}, reason, true
		}
	}

	return capabilitydriver.AssetDescriptor{
		LocalAssetID:      strings.TrimSpace(asset.GetLocalAssetId()),
		VerifiedContentID: declaredContentID,
		EntrySHA256:       contentSHA256,
		Kind:              asset.GetKind(),
		Family:            strings.TrimSpace(asset.GetFamily()),
		Engine:            strings.TrimSpace(asset.GetEngine()),
		ArtifactRoles:     normalizeStringSlice(asset.GetArtifactRoles()),
		BundleEntries:     append([]capabilitydriver.BundleEntryDescriptor(nil), bundleEntries...),
		FormatProbe:       append([]byte(nil), formatProbe...),
	}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED, true
}

func verifyLocalCapabilityAssetFile(modelsRoot, entryPath, expectedSHA256 string) ([]byte, runtimev1.LocalCapabilityReason) {
	verifiedEntryPath, err := resolveLocalCapabilityAssetPathWithinRoot(modelsRoot, entryPath)
	if err != nil {
		return nil, localCapabilityAssetVerificationReason(err)
	}
	entryFile, err := os.Open(verifiedEntryPath)
	if err != nil {
		return nil, localCapabilityAssetVerificationReason(err)
	}
	defer func() { _ = entryFile.Close() }()
	before, err := entryFile.Stat()
	if err != nil {
		return nil, localCapabilityAssetVerificationReason(err)
	}
	if err := validateManagedModelEntryOpenFile(verifiedEntryPath, entryFile, before); err != nil {
		return nil, localCapabilityAssetVerificationReason(err)
	}
	if err := validateOpenLocalCapabilityAssetEntry(modelsRoot, entryPath, before); err != nil {
		return nil, localCapabilityAssetVerificationReason(err)
	}
	formatProbe, err := readOpenFilePrefix(entryFile, capabilitydriver.MaxAssetFormatProbeBytes)
	if err != nil {
		return nil, localCapabilityAssetVerificationReason(err)
	}
	actualSHA256, err := computeOpenFileSHA256(entryFile)
	if err != nil {
		return nil, localCapabilityAssetVerificationReason(err)
	}
	after, err := entryFile.Stat()
	if err != nil {
		return nil, localCapabilityAssetVerificationReason(err)
	}
	if before.Size() != after.Size() || before.ModTime() != after.ModTime() {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_UNVERIFIED
	}
	actualSHA256 = normalizeExactSHA256Hex(actualSHA256)
	if actualSHA256 == "" {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_UNVERIFIED
	}
	if actualSHA256 != expectedSHA256 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_MISMATCH
	}
	return formatProbe, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func resolveLocalCapabilityAssetPathWithinRoot(modelsRoot, entryPath string) (string, error) {
	rootAbs, err := filepath.Abs(strings.TrimSpace(modelsRoot))
	if err != nil {
		return "", err
	}
	resolvedRoot, err := filepath.EvalSymlinks(rootAbs)
	if err != nil {
		return "", err
	}
	resolvedEntry, err := filepath.EvalSymlinks(strings.TrimSpace(entryPath))
	if err != nil {
		return "", err
	}
	relative, err := filepath.Rel(resolvedRoot, resolvedEntry)
	if err != nil {
		return "", err
	}
	if relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.IsAbs(relative) {
		return "", errors.New("local capability asset entry resolves outside the Runtime models root")
	}
	return resolvedEntry, nil
}

func validateOpenLocalCapabilityAssetEntry(modelsRoot, entryPath string, openedInfo os.FileInfo) error {
	if openedInfo == nil || !openedInfo.Mode().IsRegular() {
		return errors.New("local capability asset entry is not a regular file")
	}
	currentPath, err := resolveLocalCapabilityAssetPathWithinRoot(modelsRoot, entryPath)
	if err != nil {
		return err
	}
	currentInfo, err := os.Stat(currentPath)
	if err != nil {
		return err
	}
	if !os.SameFile(openedInfo, currentInfo) {
		return errors.New("local capability asset entry changed during exact verification")
	}
	return nil
}

func readOpenFilePrefix(file *os.File, limit int64) ([]byte, error) {
	if file == nil || limit <= 0 {
		return nil, errors.New("local capability asset entry probe is unavailable")
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}
	return io.ReadAll(io.LimitReader(file, limit))
}

func computeOpenFileSHA256(file *os.File) (string, error) {
	if file == nil {
		return "", errors.New("local capability asset entry is unavailable")
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return "", err
	}
	hasher := sha256.New()
	if _, err := io.Copy(hasher, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hasher.Sum(nil)), nil
}

func localCapabilityAssetVerificationReason(err error) runtimev1.LocalCapabilityReason {
	if errors.Is(err, os.ErrNotExist) {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_NOT_FOUND
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_UNVERIFIED
}

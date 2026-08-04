package localservice

import (
	"errors"
	"os"
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
	LocalAssetID  string
	AssetID       string
	Kind          runtimev1.LocalAssetKind
	Engine        string
	Entry         string
	DeclaredHash  string
	LogicalModel  string
	SourceRepo    string
	ArtifactRoles string
	Capabilities  string
	Removed       bool
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
		entrySHA256 := exactDeclaredEntrySHA256(asset)
		verifiedContentID := normalizeVerifiedContentID("sha256:" + entrySHA256)
		if _, relevant := preferredContentIDs[verifiedContentID]; !relevant {
			continue
		}
		roles := normalizeStringSlice(asset.GetArtifactRoles())
		capabilities := normalizeStringSlice(asset.GetCapabilities())
		sort.Strings(roles)
		sort.Strings(capabilities)
		localAssetID := strings.TrimSpace(asset.GetLocalAssetId())
		result[localAssetID] = localCapabilityAssetIdentityFingerprint{
			LocalAssetID:  localAssetID,
			AssetID:       strings.TrimSpace(asset.GetAssetId()),
			Kind:          asset.GetKind(),
			Engine:        strings.TrimSpace(asset.GetEngine()),
			Entry:         strings.TrimSpace(asset.GetEntry()),
			DeclaredHash:  entrySHA256,
			LogicalModel:  strings.TrimSpace(asset.GetLogicalModelId()),
			SourceRepo:    strings.TrimSpace(asset.GetSource().GetRepo()),
			ArtifactRoles: strings.Join(roles, "\x00"),
			Capabilities:  strings.Join(capabilities, "\x00"),
			Removed:       asset.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_REMOVED,
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
	entrySHA256 := exactDeclaredEntrySHA256(asset)
	declaredContentID := normalizeVerifiedContentID("sha256:" + entrySHA256)
	if declaredContentID == "" || declaredContentID != preferredContentID {
		return capabilitydriver.AssetDescriptor{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED, false
	}
	entryPath, err := resolveManagedModelEntryAbsolutePath(modelsRoot, asset)
	if err != nil {
		return capabilitydriver.AssetDescriptor{}, localCapabilityAssetVerificationReason(err), true
	}
	if err := validateManagedModelEntryFile(entryPath); err != nil {
		return capabilitydriver.AssetDescriptor{}, localCapabilityAssetVerificationReason(err), true
	}
	before, err := os.Stat(entryPath)
	if err != nil {
		return capabilitydriver.AssetDescriptor{}, localCapabilityAssetVerificationReason(err), true
	}
	actualSHA256, err := computeFileSHA256(entryPath)
	if err != nil {
		return capabilitydriver.AssetDescriptor{}, localCapabilityAssetVerificationReason(err), true
	}
	after, err := os.Stat(entryPath)
	if err != nil {
		return capabilitydriver.AssetDescriptor{}, localCapabilityAssetVerificationReason(err), true
	}
	if before.Size() != after.Size() || before.ModTime() != after.ModTime() {
		return capabilitydriver.AssetDescriptor{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_UNVERIFIED, true
	}
	actualSHA256 = normalizeExactSHA256Hex(actualSHA256)
	if actualSHA256 == "" {
		return capabilitydriver.AssetDescriptor{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_UNVERIFIED, true
	}
	if actualSHA256 != entrySHA256 {
		return capabilitydriver.AssetDescriptor{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_MISMATCH, true
	}
	return capabilitydriver.AssetDescriptor{
		LocalAssetID:      strings.TrimSpace(asset.GetLocalAssetId()),
		VerifiedContentID: declaredContentID,
		EntrySHA256:       entrySHA256,
		Engine:            strings.TrimSpace(asset.GetEngine()),
		ArtifactRoles:     normalizeStringSlice(asset.GetArtifactRoles()),
	}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED, true
}

func localCapabilityAssetVerificationReason(err error) runtimev1.LocalCapabilityReason {
	if errors.Is(err, os.ErrNotExist) {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_NOT_FOUND
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_UNVERIFIED
}

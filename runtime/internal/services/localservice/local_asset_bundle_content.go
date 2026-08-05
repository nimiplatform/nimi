package localservice

import (
	"fmt"
	"path"
	"path/filepath"
	"strconv"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"google.golang.org/protobuf/proto"
)

func cloneLocalBundleEntryDigests(entries []*runtimev1.LocalBundleEntryDigest) []*runtimev1.LocalBundleEntryDigest {
	result := make([]*runtimev1.LocalBundleEntryDigest, 0, len(entries))
	for _, entry := range entries {
		if entry == nil {
			continue
		}
		result = append(result, proto.Clone(entry).(*runtimev1.LocalBundleEntryDigest))
	}
	return result
}

func localBundleEntriesFromState(entries []localStateBundleEntryState) []*runtimev1.LocalBundleEntryDigest {
	result := make([]*runtimev1.LocalBundleEntryDigest, 0, len(entries))
	for _, entry := range entries {
		result = append(result, &runtimev1.LocalBundleEntryDigest{
			Ordinal:      entry.Ordinal,
			RelativePath: entry.RelativePath,
			Sha256:       entry.SHA256,
		})
	}
	return result
}

func localBundleEntriesToState(entries []*runtimev1.LocalBundleEntryDigest) []localStateBundleEntryState {
	result := make([]localStateBundleEntryState, 0, len(entries))
	for _, entry := range entries {
		if entry == nil {
			continue
		}
		result = append(result, localStateBundleEntryState{
			Ordinal:      entry.GetOrdinal(),
			RelativePath: entry.GetRelativePath(),
			SHA256:       entry.GetSha256(),
		})
	}
	return result
}

func normalizeLocalBundleRelativePath(value string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" || trimmed != value || strings.Contains(trimmed, "\\") || strings.HasPrefix(trimmed, "/") {
		return "", fmt.Errorf("bundle entry relative path is not canonical")
	}
	cleaned := path.Clean(trimmed)
	if cleaned != trimmed || cleaned == "." || cleaned == ".." || strings.HasPrefix(cleaned, "../") || filepath.IsAbs(filepath.FromSlash(cleaned)) {
		return "", fmt.Errorf("bundle entry relative path is not canonical")
	}
	return cleaned, nil
}

func localCapabilityBundleEntryDescriptors(asset *runtimev1.LocalAssetRecord) ([]capabilitydriver.BundleEntryDescriptor, error) {
	if asset == nil || len(asset.GetBundleEntries()) == 0 {
		return nil, nil
	}
	if len(asset.GetBundleEntries()) < 2 {
		return nil, fmt.Errorf("sharded bundle requires at least two entries")
	}
	entryPath, err := normalizeLocalBundleRelativePath(asset.GetEntry())
	if err != nil {
		return nil, fmt.Errorf("bundle main entry: %w", err)
	}
	seenPaths := make(map[string]struct{}, len(asset.GetBundleEntries()))
	containsMainEntry := false
	result := make([]capabilitydriver.BundleEntryDescriptor, 0, len(asset.GetBundleEntries()))
	for index, entry := range asset.GetBundleEntries() {
		if entry == nil || entry.GetOrdinal() != uint32(index+1) {
			return nil, fmt.Errorf("bundle entry %d has a non-contiguous ordinal", index)
		}
		relativePath, err := normalizeLocalBundleRelativePath(entry.GetRelativePath())
		if err != nil {
			return nil, fmt.Errorf("bundle entry %d: %w", index, err)
		}
		if _, exists := seenPaths[relativePath]; exists {
			return nil, fmt.Errorf("bundle entry path %q is duplicated", relativePath)
		}
		seenPaths[relativePath] = struct{}{}
		if relativePath == entryPath {
			containsMainEntry = true
		}
		digest := normalizeExactSHA256Hex(entry.GetSha256())
		if digest == "" || digest != entry.GetSha256() {
			return nil, fmt.Errorf("bundle entry %d has a non-canonical sha256", index)
		}
		if declared := normalizeExactSHA256Hex(asset.GetHashes()[relativePath]); declared == "" || declared != digest {
			return nil, fmt.Errorf("bundle entry %d does not match the LocalAsset hash manifest", index)
		}
		result = append(result, capabilitydriver.BundleEntryDescriptor{Ordinal: entry.GetOrdinal(), SHA256: digest})
	}
	if !containsMainEntry {
		return nil, fmt.Errorf("bundle entries do not cover the LocalAsset entry")
	}
	if _, err := capabilitydriver.CanonicalBundleSHA256(result); err != nil {
		return nil, err
	}
	return result, nil
}

func exactDeclaredContentSHA256(asset *runtimev1.LocalAssetRecord) string {
	if asset == nil {
		return ""
	}
	if len(asset.GetBundleEntries()) > 0 {
		entries, err := localCapabilityBundleEntryDescriptors(asset)
		if err != nil {
			return ""
		}
		digest, err := capabilitydriver.CanonicalBundleSHA256(entries)
		if err != nil {
			return ""
		}
		return digest
	}
	entry := strings.TrimSpace(asset.GetEntry())
	if entry == "" {
		return ""
	}
	// A sole hash or sole file never supplies the missing entry relationship.
	return normalizeExactSHA256Hex(asset.GetHashes()[entry])
}

func localCapabilityBundleFingerprint(asset *runtimev1.LocalAssetRecord) string {
	if asset == nil || len(asset.GetBundleEntries()) == 0 {
		return ""
	}
	var builder strings.Builder
	for _, entry := range asset.GetBundleEntries() {
		if entry == nil {
			builder.WriteString("<nil>\x00")
			continue
		}
		builder.WriteString(strconv.FormatUint(uint64(entry.GetOrdinal()), 10))
		builder.WriteByte('\x00')
		builder.WriteString(entry.GetRelativePath())
		builder.WriteByte('\x00')
		builder.WriteString(entry.GetSha256())
		builder.WriteByte('\x00')
	}
	return builder.String()
}

func applyLocalAssetBundleManifest(
	s *Service,
	record *runtimev1.LocalAssetRecord,
	files []string,
	bundleEntries []*runtimev1.LocalBundleEntryDigest,
) *runtimev1.LocalAssetRecord {
	if record == nil {
		return nil
	}
	cloned := cloneLocalAsset(record)
	cloned.Files = normalizeStringSlice(files)
	cloned.BundleEntries = cloneLocalBundleEntryDigests(bundleEntries)
	if s == nil {
		return cloned
	}
	s.mu.Lock()
	if _, exists := s.assets[cloned.GetLocalAssetId()]; exists {
		s.assets[cloned.GetLocalAssetId()] = cloneLocalAsset(cloned)
	}
	s.mu.Unlock()
	return cloned
}

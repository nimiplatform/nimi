// @nimi-authority: rule.nimi.runtime.local-compute.r014

package localservice

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"path/filepath"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// modelDistribution is the complete, canonical description of one managed
// distribution: its entry and every unique normalized payload path with the
// file's exact SHA-256, verified size, and import safety fact. Two intakes
// describe the same distribution exactly when these are equal. Display name,
// acquisition time, source, and configuration purpose never enter equality;
// content_id, file names, mtimes, or a previous content_verified fact never
// establish it on their own.
type modelDistribution struct {
	Entry string
	Files []modelDistributionFile
}

type modelDistributionFile struct {
	RelativePath         string
	SHA256               string
	SizeBytes            int64
	NonExecutableContent bool
}

func newModelDistribution(entry string, files []modelDistributionFile) (modelDistribution, error) {
	if len(files) == 0 {
		return modelDistribution{}, errors.New("distribution has no payload files")
	}
	ordered := make([]modelDistributionFile, 0, len(files))
	seen := make(map[string]struct{}, len(files))
	for _, file := range files {
		relative := filepath.ToSlash(strings.TrimSpace(file.RelativePath))
		if !canonicalModelAssetRelativePath(relative) || isModelAssetControlFile(relative) {
			return modelDistribution{}, fmt.Errorf("distribution path %q is not canonical", file.RelativePath)
		}
		if _, duplicate := seen[relative]; duplicate {
			return modelDistribution{}, fmt.Errorf("distribution path %q is duplicated", relative)
		}
		digest := normalizeExactSHA256Hex(file.SHA256)
		if digest == "" {
			return modelDistribution{}, fmt.Errorf("distribution file %q has no exact SHA-256", relative)
		}
		if file.SizeBytes < 0 {
			return modelDistribution{}, fmt.Errorf("distribution file %q has a negative size", relative)
		}
		seen[relative] = struct{}{}
		ordered = append(ordered, modelDistributionFile{
			RelativePath: relative, SHA256: digest, SizeBytes: file.SizeBytes, NonExecutableContent: file.NonExecutableContent,
		})
	}
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].RelativePath < ordered[j].RelativePath })
	normalizedEntry := filepath.ToSlash(strings.TrimSpace(entry))
	if _, present := seen[normalizedEntry]; !present {
		return modelDistribution{}, fmt.Errorf("distribution entry %q is not a payload file", entry)
	}
	return modelDistribution{Entry: normalizedEntry, Files: ordered}, nil
}

func modelDistributionFromRecord(asset *runtimev1.ModelAssetRecord) (modelDistribution, error) {
	if asset == nil {
		return modelDistribution{}, errors.New("ModelAsset record is required")
	}
	files := make([]modelDistributionFile, 0, len(asset.GetFiles()))
	for _, file := range asset.GetFiles() {
		if file == nil {
			continue
		}
		files = append(files, modelDistributionFile{
			RelativePath: file.GetRelativePath(), SHA256: file.GetSha256(), SizeBytes: file.GetSizeBytes(),
			NonExecutableContent: file.GetNonExecutableContent(),
		})
	}
	return newModelDistribution(asset.GetEntry(), files)
}

func modelDistributionFromFiles(entry string, files []*runtimev1.ModelAssetFile) (modelDistribution, error) {
	converted := make([]modelDistributionFile, 0, len(files))
	for _, file := range files {
		if file == nil {
			continue
		}
		converted = append(converted, modelDistributionFile{
			RelativePath: file.GetRelativePath(), SHA256: file.GetSha256(), SizeBytes: file.GetSizeBytes(),
			NonExecutableContent: file.GetNonExecutableContent(),
		})
	}
	return newModelDistribution(entry, converted)
}

func (d modelDistribution) totalSize() int64 {
	var total int64
	for _, file := range d.Files {
		total += file.SizeBytes
	}
	return total
}

func (d modelDistribution) modelAssetFiles() []*runtimev1.ModelAssetFile {
	files := make([]*runtimev1.ModelAssetFile, 0, len(d.Files))
	for _, file := range d.Files {
		files = append(files, &runtimev1.ModelAssetFile{
			RelativePath: file.RelativePath, Sha256: file.SHA256, SizeBytes: file.SizeBytes, NonExecutableContent: file.NonExecutableContent,
		})
	}
	return files
}

func (d modelDistribution) digests() []string {
	seen := make(map[string]struct{}, len(d.Files))
	digests := make([]string, 0, len(d.Files))
	for _, file := range d.Files {
		if _, duplicate := seen[file.SHA256]; duplicate {
			continue
		}
		seen[file.SHA256] = struct{}{}
		digests = append(digests, file.SHA256)
	}
	sort.Strings(digests)
	return digests
}

// layoutKey is the derived accelerator over entry, paths, digests, and safety
// facts; sizes are excluded so an intake whose sizes are still unverified can
// locate candidates. It never replaces the complete comparison.
func (d modelDistribution) layoutKey() string {
	hasher := sha256.New()
	_, _ = hasher.Write([]byte("nimi.model-distribution-layout.v1\x00" + d.Entry + "\x00"))
	for _, file := range d.Files {
		_, _ = hasher.Write([]byte(file.RelativePath + "\x00" + file.SHA256 + "\x00"))
		if file.NonExecutableContent {
			_, _ = hasher.Write([]byte{1})
		} else {
			_, _ = hasher.Write([]byte{0})
		}
		_, _ = hasher.Write([]byte{0})
	}
	return hex.EncodeToString(hasher.Sum(nil))
}

// equal is the complete distribution comparison including verified sizes.
func (d modelDistribution) equal(other modelDistribution) bool {
	if d.Entry != other.Entry || len(d.Files) != len(other.Files) {
		return false
	}
	for index := range d.Files {
		if d.Files[index] != other.Files[index] {
			return false
		}
	}
	return true
}

// equalLayout compares everything except sizes: the shape an acquisition
// knows before it has verified every file.
func (d modelDistribution) equalLayout(other modelDistribution) bool {
	if d.Entry != other.Entry || len(d.Files) != len(other.Files) {
		return false
	}
	for index := range d.Files {
		left, right := d.Files[index], other.Files[index]
		if left.RelativePath != right.RelativePath || left.SHA256 != right.SHA256 || left.NonExecutableContent != right.NonExecutableContent {
			return false
		}
	}
	return true
}

// modelDistributionFileNonExecutable derives the import safety fact for a
// payload path from its extension. Adoption of existing bytes additionally
// considers an execute bit; both paths normalize permissions before publish.
func modelDistributionFileNonExecutable(relativePath string) bool {
	_, code := modelAssetCodeExtensions[strings.ToLower(filepath.Ext(relativePath))]
	return code
}

// equivalentModelAssetsLocked returns every committed inventory asset whose
// distribution layout matches. Caller holds s.mu (read or write).
func (s *Service) equivalentModelAssetsLocked(distribution modelDistribution) []*runtimev1.ModelAssetRecord {
	key := distribution.layoutKey()
	matches := make([]*runtimev1.ModelAssetRecord, 0, 1)
	for _, asset := range s.modelAssets {
		if asset == nil {
			continue
		}
		existing, err := modelDistributionFromRecord(asset)
		if err != nil || existing.layoutKey() != key || !existing.equalLayout(distribution) {
			continue
		}
		matches = append(matches, cloneModelAsset(asset))
	}
	sort.Slice(matches, func(i, j int) bool { return matches[i].GetModelAssetId() < matches[j].GetModelAssetId() })
	return matches
}

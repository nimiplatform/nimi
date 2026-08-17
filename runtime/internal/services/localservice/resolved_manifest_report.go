package localservice

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
)

// ResolvedManifestDirectoryReport is tool-private recovery evidence. It is not
// a Runtime RPC or SDK contract.
type ResolvedManifestDirectoryReport struct {
	Filename                 string `json:"filename"`
	Path                     string `json:"path"`
	SizeBytes                int64  `json:"size_bytes"`
	SuggestionSource         string `json:"suggestion_source"`
	Confidence               string `json:"confidence"`
	AutoImportable           bool   `json:"auto_importable"`
	RequiresManualReview     bool   `json:"requires_manual_review"`
	FolderName               string `json:"folder_name"`
	RecoveryStatus           string `json:"recovery_status"`
	FailureReason            string `json:"failure_reason"`
	CatalogHit               bool   `json:"catalog_hit"`
	Unclassified             bool   `json:"unclassified"`
	ContentID                string `json:"content_id"`
	ManagedManifestDirectory bool   `json:"managed_manifest_directory"`
}

func (r *ResolvedManifestDirectoryReport) GetFilename() string {
	if r == nil {
		return ""
	}
	return r.Filename
}
func (r *ResolvedManifestDirectoryReport) GetPath() string {
	if r == nil {
		return ""
	}
	return r.Path
}
func (r *ResolvedManifestDirectoryReport) GetSizeBytes() int64 {
	if r == nil {
		return 0
	}
	return r.SizeBytes
}
func (r *ResolvedManifestDirectoryReport) GetRecoveryStatus() string {
	if r == nil {
		return ""
	}
	return r.RecoveryStatus
}
func (r *ResolvedManifestDirectoryReport) GetFailureReason() string {
	if r == nil {
		return ""
	}
	return r.FailureReason
}
func (r *ResolvedManifestDirectoryReport) GetCatalogHit() bool   { return r != nil && r.CatalogHit }
func (r *ResolvedManifestDirectoryReport) GetUnclassified() bool { return r != nil && r.Unclassified }
func (r *ResolvedManifestDirectoryReport) GetContentId() string {
	if r == nil {
		return ""
	}
	return r.ContentID
}
func (r *ResolvedManifestDirectoryReport) GetManagedManifestDirectory() bool {
	return r != nil && r.ManagedManifestDirectory
}

// ReportResolvedManifestDirectories performs the bounded, read-only recovery
// report without loading or mutating Runtime state. It re-hashes the current
// payload and compares exact per-file identities with the built-in catalog.
func ReportResolvedManifestDirectories(modelsRoot string) ([]*ResolvedManifestDirectoryReport, error) {
	localCatalog, err := catalog.LoadBuiltInLocalProviderCatalog()
	if err != nil {
		return nil, fmt.Errorf("load local provider catalog: %w", err)
	}
	verified, err := verifiedAssetsFromLocalCatalog(localCatalog)
	if err != nil {
		return nil, fmt.Errorf("project verified catalog assets: %w", err)
	}
	return scanResolvedManifestDirectories(modelsRoot, verified, nil), nil
}

func scanResolvedManifestDirectories(
	modelsRoot string,
	verified []*runtimev1.LocalVerifiedAssetDescriptor,
	registeredDirectories map[string]struct{},
) []*ResolvedManifestDirectoryReport {
	resolvedRoot := filepath.Join(filepath.Clean(strings.TrimSpace(modelsRoot)), "resolved")
	info, err := os.Stat(resolvedRoot)
	if err != nil || !info.IsDir() {
		return []*ResolvedManifestDirectoryReport{}
	}
	manifestPaths := make([]string, 0)
	_ = filepath.WalkDir(resolvedRoot, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		if entry.IsDir() {
			return nil
		}
		if strings.EqualFold(entry.Name(), "asset.manifest.json") {
			manifestPaths = append(manifestPaths, filepath.Clean(path))
		}
		return nil
	})
	sort.Strings(manifestPaths)

	items := make([]*ResolvedManifestDirectoryReport, 0, len(manifestPaths))
	for _, manifestPath := range manifestPaths {
		directory := filepath.Dir(manifestPath)
		if _, registered := registeredDirectories[canonicalReportPath(directory)]; registered {
			continue
		}
		items = append(items, reportResolvedManifestDirectory(directory, manifestPath, verified))
	}
	return items
}

func reportResolvedManifestDirectory(
	directory string,
	manifestPath string,
	verified []*runtimev1.LocalVerifiedAssetDescriptor,
) *ResolvedManifestDirectoryReport {
	item := &ResolvedManifestDirectoryReport{
		Filename: directoryNameForReport(directory), Path: filepath.Clean(directory), FolderName: directoryNameForReport(directory),
		SuggestionSource: "resolved_manifest_rehash", Confidence: "exact_content",
		AutoImportable: false, RequiresManualReview: true, ManagedManifestDirectory: true,
		RecoveryStatus: "failed", Unclassified: true,
	}
	manifestPayload, err := os.ReadFile(manifestPath)
	if err != nil {
		item.FailureReason = "read manifest: " + err.Error()
		return item
	}
	var manifest struct {
		Entry string `json:"entry"`
	}
	if err := json.Unmarshal(manifestPayload, &manifest); err != nil {
		item.FailureReason = "decode manifest: " + err.Error()
		return item
	}

	hashes, totalSize, classified, err := hashResolvedPayload(directory)
	if err != nil {
		item.FailureReason = err.Error()
		return item
	}
	if len(hashes) == 0 {
		item.FailureReason = "manifest directory contains no payload files"
		return item
	}
	item.SizeBytes = totalSize
	item.Unclassified = !classified
	item.ContentID = resolvedPayloadContentID(hashes)
	item.CatalogHit = resolvedPayloadCatalogHit(hashes, verified)
	item.RecoveryStatus = "reimportable"
	item.FailureReason = ""
	return item
}

func hashResolvedPayload(directory string) (map[string]string, int64, bool, error) {
	hashes := make(map[string]string)
	var totalSize int64
	classified := false
	err := filepath.WalkDir(directory, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return fmt.Errorf("enumerate payload: %w", walkErr)
		}
		if filepath.Clean(path) == filepath.Clean(directory) {
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("payload contains symlink %q", path)
		}
		if entry.IsDir() {
			return nil
		}
		relativePath, err := filepath.Rel(directory, path)
		if err != nil {
			return fmt.Errorf("resolve payload path: %w", err)
		}
		relativePath = filepath.ToSlash(relativePath)
		if relativePath == "asset.manifest.json" || strings.EqualFold(filepath.Base(relativePath), "quarantine.manifest.json") {
			return nil
		}
		if strings.HasPrefix(relativePath, "../") || relativePath == ".." || filepath.IsAbs(relativePath) {
			return fmt.Errorf("payload path escapes manifest directory: %q", relativePath)
		}
		info, err := entry.Info()
		if err != nil {
			return fmt.Errorf("stat payload %q: %w", relativePath, err)
		}
		file, err := os.Open(path)
		if err != nil {
			return fmt.Errorf("open payload %q: %w", relativePath, err)
		}
		digest := sha256.New()
		_, copyErr := io.Copy(digest, file)
		closeErr := file.Close()
		if copyErr != nil {
			return fmt.Errorf("hash payload %q: %w", relativePath, copyErr)
		}
		if closeErr != nil {
			return fmt.Errorf("close payload %q: %w", relativePath, closeErr)
		}
		hashes[relativePath] = hex.EncodeToString(digest.Sum(nil))
		totalSize += info.Size()
		switch strings.ToLower(filepath.Ext(relativePath)) {
		case ".gguf", ".safetensors":
			classified = true
		}
		return nil
	})
	return hashes, totalSize, classified, err
}

func resolvedPayloadContentID(hashes map[string]string) string {
	files := make([]*runtimev1.ModelAssetFile, 0, len(hashes))
	for path, digest := range hashes {
		files = append(files, &runtimev1.ModelAssetFile{
			RelativePath: filepath.ToSlash(strings.TrimSpace(path)),
			Sha256:       strings.TrimPrefix(strings.ToLower(strings.TrimSpace(digest)), "sha256:"),
		})
	}
	return modelAssetContentID(files)
}

func resolvedPayloadCatalogHit(actual map[string]string, verified []*runtimev1.LocalVerifiedAssetDescriptor) bool {
	for _, descriptor := range verified {
		if descriptor == nil || len(descriptor.GetHashes()) == 0 {
			continue
		}
		expected := make(map[string]string, len(descriptor.GetHashes()))
		for path, digest := range descriptor.GetHashes() {
			normalized := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(digest)), "sha256:")
			if normalized != "" {
				expected[filepath.ToSlash(strings.TrimSpace(path))] = normalized
			}
		}
		if equalResolvedPayloadHashes(actual, expected) {
			return true
		}
	}
	return false
}

func equalResolvedPayloadHashes(actual map[string]string, expected map[string]string) bool {
	if len(actual) != len(expected) || len(actual) == 0 {
		return false
	}
	for path, digest := range expected {
		if actual[path] != digest {
			return false
		}
	}
	return true
}

func canonicalReportPath(path string) string {
	return canonicalReportPathForOS(path, runtime.GOOS)
}

func canonicalReportPathForOS(path string, goos string) string {
	cleaned := filepath.Clean(path)
	if absolute, err := filepath.Abs(cleaned); err == nil {
		cleaned = absolute
	}
	if strings.EqualFold(strings.TrimSpace(goos), "windows") {
		return strings.ToLower(cleaned)
	}
	return cleaned
}

func directoryNameForReport(path string) string {
	return filepath.Base(filepath.Clean(path))
}

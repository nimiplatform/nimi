package localservice

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const ggufMagicHeader = "GGUF"
const minManagedGGUFSizeBytes = 4 * 1024

func validateManagedModelEntryFile(path string) error {
	entryPath := strings.TrimSpace(path)
	if entryPath == "" {
		return fmt.Errorf("managed local model entry path is empty")
	}
	info, err := os.Stat(entryPath)
	if err != nil {
		return fmt.Errorf("managed local model entry missing: %w", err)
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("managed local model entry is not a regular file")
	}
	if strings.ToLower(filepath.Ext(entryPath)) != ".gguf" {
		return nil
	}
	file, err := os.Open(entryPath)
	if err != nil {
		return fmt.Errorf("open gguf entry: %w", err)
	}
	defer func() { _ = file.Close() }()
	return validateManagedModelEntryOpenFile(entryPath, file, info)
}

func validateManagedModelEntryOpenFile(path string, file *os.File, info os.FileInfo) error {
	if file == nil || info == nil || !info.Mode().IsRegular() {
		return fmt.Errorf("managed local model entry is not a regular file")
	}
	if strings.ToLower(filepath.Ext(strings.TrimSpace(path))) != ".gguf" {
		return nil
	}
	if info.Size() < minManagedGGUFSizeBytes {
		return fmt.Errorf("gguf payload too small")
	}
	header := make([]byte, len(ggufMagicHeader))
	if _, err := file.ReadAt(header, 0); err != nil {
		return fmt.Errorf("read gguf header: %w", err)
	}
	if string(header) != ggufMagicHeader {
		return fmt.Errorf("gguf header invalid")
	}
	if placeholder, err := ggufLooksHeaderOnlyPlaceholder(file); err != nil {
		return fmt.Errorf("inspect gguf payload: %w", err)
	} else if placeholder {
		return fmt.Errorf("gguf payload placeholder or truncated")
	}
	return nil
}

func ggufLooksHeaderOnlyPlaceholder(file *os.File) (bool, error) {
	const sampleSize = 256
	sample := make([]byte, sampleSize)
	n, err := file.ReadAt(sample, 0)
	if err != nil && err != io.EOF {
		return false, err
	}
	if n <= len(ggufMagicHeader) {
		return true, nil
	}
	sample = sample[:n]
	for _, value := range sample[len(ggufMagicHeader):] {
		if value != 0 {
			return false, nil
		}
	}
	return true, nil
}

func normalizeExpectedSHA256Hash(value string) string {
	trimmed := strings.TrimSpace(strings.ToLower(value))
	trimmed = strings.TrimPrefix(trimmed, "sha256:")
	if len(trimmed) != 64 {
		return ""
	}
	return trimmed
}

func computeFileSHA256(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer func() { _ = file.Close() }()
	hasher := sha256.New()
	if _, err := io.Copy(hasher, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hasher.Sum(nil)), nil
}

func modelAssetFileVerificationGeneration(asset *runtimev1.ModelAssetRecord, file *runtimev1.ModelAssetFile) string {
	if asset == nil || file == nil {
		return ""
	}
	return strings.TrimSpace(asset.GetContentId()) + "/" + strings.ToLower(strings.TrimSpace(file.GetSha256()))
}

func (s *Service) recordVerifiedFileSHA256(path string, info os.FileInfo, digest string, generationDigest string) {
	if s == nil || info == nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || strings.TrimSpace(digest) == "" {
		return
	}
	s.mu.Lock()
	s.entryHashCache[filepath.Clean(path)] = entryHashCacheState{
		size:             info.Size(),
		modTimeUnixNano:  info.ModTime().UnixNano(),
		generationDigest: strings.TrimSpace(generationDigest),
		sha256:           strings.ToLower(strings.TrimSpace(digest)),
	}
	s.mu.Unlock()
}

// cacheVerifiedModelAssetGeneration carries a digest proof produced by the
// confirmation/import flow into later Loadout resolution. verificationRoot is
// the pre-promotion directory when an atomic rename changed only the paths.
func (s *Service) cacheVerifiedModelAssetGeneration(asset *runtimev1.ModelAssetRecord, directory string, verificationRoot ...string) {
	if s == nil || asset == nil || strings.TrimSpace(asset.GetContentId()) == "" {
		return
	}
	proofRoot := directory
	if len(verificationRoot) > 0 && strings.TrimSpace(verificationRoot[0]) != "" {
		proofRoot = verificationRoot[0]
	}
	type verifiedFile struct {
		path  string
		state entryHashCacheState
	}
	verified := make([]verifiedFile, 0, len(asset.GetFiles()))
	for _, file := range asset.GetFiles() {
		if file == nil || !safeModelAssetRelativePath(file.GetRelativePath()) {
			return
		}
		relative := filepath.FromSlash(file.GetRelativePath())
		path := filepath.Join(directory, relative)
		proofPath := filepath.Clean(filepath.Join(proofRoot, relative))
		info, err := os.Lstat(path)
		if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Size() != file.GetSizeBytes() {
			return
		}
		s.mu.RLock()
		proof, ok := s.entryHashCache[proofPath]
		s.mu.RUnlock()
		declaredDigest := strings.ToLower(strings.TrimSpace(file.GetSha256()))
		if !ok || proof.size != info.Size() || proof.modTimeUnixNano != info.ModTime().UnixNano() || proof.sha256 != declaredDigest {
			return
		}
		proof.generationDigest = modelAssetFileVerificationGeneration(asset, file)
		verified = append(verified, verifiedFile{path: filepath.Clean(path), state: proof})
	}
	s.mu.Lock()
	for _, file := range verified {
		s.entryHashCache[file.path] = file.state
	}
	s.mu.Unlock()
}

// restoreVerifiedModelAssetGeneration rehydrates the persisted verification
// fact recorded after import/adoption. A file modified after that fact has an
// mtime newer than LatestIntegrityCheckedAt and is deliberately not cached.
func (s *Service) restoreVerifiedModelAssetGeneration(asset *runtimev1.ModelAssetRecord, directory string) {
	if s == nil || asset == nil {
		return
	}
	verifiedAt, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(asset.GetLatestIntegrityCheckedAt()))
	if err != nil {
		return
	}
	type verifiedFile struct {
		path  string
		state entryHashCacheState
	}
	verified := make([]verifiedFile, 0, len(asset.GetFiles()))
	for _, file := range asset.GetFiles() {
		if file == nil || !safeModelAssetRelativePath(file.GetRelativePath()) {
			return
		}
		path := filepath.Join(directory, filepath.FromSlash(file.GetRelativePath()))
		info, err := os.Lstat(path)
		if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 ||
			info.Size() != file.GetSizeBytes() || info.ModTime().After(verifiedAt) {
			return
		}
		verified = append(verified, verifiedFile{
			path: filepath.Clean(path),
			state: entryHashCacheState{
				size:             info.Size(),
				modTimeUnixNano:  info.ModTime().UnixNano(),
				generationDigest: modelAssetFileVerificationGeneration(asset, file),
				sha256:           strings.ToLower(strings.TrimSpace(file.GetSha256())),
			},
		})
	}
	s.mu.Lock()
	for _, file := range verified {
		s.entryHashCache[file.path] = file.state
	}
	s.mu.Unlock()
}

func (s *Service) cachedFileSHA256(path string, info os.FileInfo, generationDigest string) (string, error) {
	if info == nil {
		var err error
		info, err = os.Stat(path)
		if err != nil {
			return "", err
		}
	}
	cacheKey := filepath.Clean(strings.TrimSpace(path))
	generation := strings.TrimSpace(generationDigest)
	modTimeUnixNano := info.ModTime().UnixNano()
	size := info.Size()
	s.mu.RLock()
	cached, ok := s.entryHashCache[cacheKey]
	s.mu.RUnlock()
	if ok && cached.size == size && cached.modTimeUnixNano == modTimeUnixNano &&
		cached.generationDigest == generation && strings.TrimSpace(cached.sha256) != "" {
		return cached.sha256, nil
	}
	return s.freshFileSHA256(cacheKey, info, generation)
}

// freshFileSHA256 deliberately bypasses entryHashCache. Job admission uses
// this entry so every bound payload is reread even when size and mtime were
// restored to a previously verified generation. The resulting proof may warm
// projection caches, but it is never sourced from them.
func (s *Service) freshFileSHA256(path string, info os.FileInfo, generationDigest string) (string, error) {
	if info == nil {
		var err error
		info, err = os.Stat(path)
		if err != nil {
			return "", err
		}
	}
	cacheKey := filepath.Clean(strings.TrimSpace(path))
	generation := strings.TrimSpace(generationDigest)
	modTimeUnixNano := info.ModTime().UnixNano()
	size := info.Size()
	s.mu.RLock()
	hasher := s.entryFileSHA256
	s.mu.RUnlock()
	if hasher == nil {
		hasher = computeFileSHA256
	}
	sum, err := hasher(cacheKey)
	if err != nil {
		return "", err
	}
	verifiedInfo, err := os.Stat(cacheKey)
	if err != nil {
		return "", err
	}
	if verifiedInfo.Size() != size || verifiedInfo.ModTime().UnixNano() != modTimeUnixNano || verifiedInfo.Mode() != info.Mode() {
		return "", fmt.Errorf("file changed during sha256 verification: %s", cacheKey)
	}
	s.mu.Lock()
	s.entryHashCache[cacheKey] = entryHashCacheState{
		size:             size,
		modTimeUnixNano:  modTimeUnixNano,
		generationDigest: generation,
		sha256:           sum,
	}
	s.mu.Unlock()
	return sum, nil
}

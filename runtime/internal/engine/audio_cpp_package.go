package engine

import (
	"archive/zip"
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	AudioCppPackageVersion       = "0.6.1"
	AudioCppPackageCommit        = "26dcb5c4cf5aa016ae6285096a7b45f2671e5d17"
	AudioCppPackageAssetName     = "audiocpp-windows-cuda-balance-26dcb5c4.zip"
	AudioCppPackageArchiveURL    = "https://github.com/0xShug0/audio.cpp/releases/download/release-0.6.1/audiocpp-windows-cuda-balance-26dcb5c4.zip"
	AudioCppPackageArchiveSHA256 = "5e6b6389a05be228f89ba15c5f5f037351a8e2d2be82d1bec363d26dfa55b373"
	AudioCppPackageArchiveBytes  = int64(257604825)
	AudioCppCLIExecutableName    = "audiocpp_cli.exe"
)

var audioCppPackageAdmittedFiles = []string{
	AudioCppCLIExecutableName,
	"MSVCP140.dll",
	"VCRUNTIME140.dll",
	"VCRUNTIME140_1.dll",
	"VCOMP140.DLL",
	"README.md",
}

func (m *Manager) ensureAudioCppBinaryDependency(ctx context.Context, cfg EngineConfig) (EngineBinaryDependencyStatus, error) {
	if strings.TrimSpace(cfg.Version) == "" {
		cfg.Version = AudioCppPackageVersion
	}
	if cfg.Version != AudioCppPackageVersion {
		return EngineBinaryDependencyStatus{}, fmt.Errorf("unsupported audio.cpp package version %q", cfg.Version)
	}
	if currentGOOS() != "windows" || currentGOARCH() != "amd64" {
		return EngineBinaryDependencyStatus{}, fmt.Errorf("audio.cpp package is unsupported on %s/%s", currentGOOS(), currentGOARCH())
	}
	if entry := m.registry.Get(EngineAudioCPP, cfg.Version); entry != nil {
		if status, err := m.audioCppStatusFromRegistryEntry(entry); err == nil {
			return status, nil
		}
		_ = m.registry.Remove(EngineAudioCPP, cfg.Version)
	}

	targetDir := engineVersionDir(m.baseDir, EngineAudioCPP, cfg.Version)
	tmpDir, err := os.MkdirTemp(m.baseDir, ".audio-cpp-package-*")
	if err != nil {
		return EngineBinaryDependencyStatus{}, fmt.Errorf("create audio.cpp package staging: %w", err)
	}
	defer func() { _ = os.RemoveAll(tmpDir) }()

	archivePath := filepath.Join(tmpDir, AudioCppPackageAssetName)
	archiveHash, err := downloadURLToFileWithProgress(ctx, AudioCppPackageArchiveURL, archivePath, downloadProgressFromContext(ctx))
	if err != nil {
		return EngineBinaryDependencyStatus{}, fmt.Errorf("download audio.cpp package: %w", err)
	}
	archiveInfo, err := os.Stat(archivePath)
	if err != nil {
		return EngineBinaryDependencyStatus{}, fmt.Errorf("stat audio.cpp package archive: %w", err)
	}
	if archiveInfo.Size() != AudioCppPackageArchiveBytes {
		return EngineBinaryDependencyStatus{}, fmt.Errorf("audio.cpp package archive size mismatch: expected=%d actual=%d", AudioCppPackageArchiveBytes, archiveInfo.Size())
	}
	if !strings.EqualFold(archiveHash, AudioCppPackageArchiveSHA256) {
		return EngineBinaryDependencyStatus{}, fmt.Errorf("%w: expected=%s actual=%s", ErrEngineBinaryHashMismatch, AudioCppPackageArchiveSHA256, archiveHash)
	}

	admittedDir := filepath.Join(tmpDir, "admitted")
	if err := os.MkdirAll(admittedDir, 0o755); err != nil {
		return EngineBinaryDependencyStatus{}, fmt.Errorf("create audio.cpp admitted root: %w", err)
	}
	if err := extractAudioCppAdmittedPackageFiles(archivePath, admittedDir); err != nil {
		return EngineBinaryDependencyStatus{}, fmt.Errorf("extract admitted audio.cpp package files: %w", err)
	}
	for _, name := range audioCppPackageAdmittedFiles {
		if _, err := os.Stat(filepath.Join(admittedDir, name)); err != nil {
			return EngineBinaryDependencyStatus{}, fmt.Errorf("verify audio.cpp package artifact %s: %w", name, err)
		}
	}
	if err := installManagedBinaryPayload(targetDir, admittedDir); err != nil {
		return EngineBinaryDependencyStatus{}, fmt.Errorf("promote audio.cpp package: %w", err)
	}
	binaryPath := filepath.Join(targetDir, AudioCppCLIExecutableName)
	if err := m.registry.Put(&RegistryEntry{
		Engine:           EngineAudioCPP,
		Version:          cfg.Version,
		BinaryPath:       binaryPath,
		SHA256:           AudioCppPackageArchiveSHA256,
		Platform:         "windows/amd64",
		AssetName:        AudioCppPackageAssetName,
		AcceleratorPlane: "cuda13",
		InstalledAt:      time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		return EngineBinaryDependencyStatus{}, fmt.Errorf("persist audio.cpp package registry entry: %w", err)
	}
	entry := m.registry.Get(EngineAudioCPP, cfg.Version)
	return m.audioCppStatusFromRegistryEntry(entry)
}

func extractAudioCppAdmittedPackageFiles(archivePath string, destination string) error {
	reader, err := zip.OpenReader(archivePath)
	if err != nil {
		return fmt.Errorf("open audio.cpp package archive: %w", err)
	}
	defer func() { _ = reader.Close() }()
	wanted := make(map[string]string, len(audioCppPackageAdmittedFiles))
	for _, name := range audioCppPackageAdmittedFiles {
		wanted[strings.ToLower(filepath.ToSlash(name))] = name
	}
	seen := make(map[string]bool, len(wanted))
	for _, file := range reader.File {
		archiveName := strings.TrimPrefix(filepath.ToSlash(strings.TrimSpace(file.Name)), "./")
		targetName, admitted := wanted[strings.ToLower(archiveName)]
		if !admitted {
			continue
		}
		if seen[targetName] || file.FileInfo().IsDir() || file.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("audio.cpp package artifact %s is duplicated or not a regular file", targetName)
		}
		source, err := file.Open()
		if err != nil {
			return fmt.Errorf("open audio.cpp package artifact %s: %w", targetName, err)
		}
		target, err := os.OpenFile(filepath.Join(destination, targetName), os.O_CREATE|os.O_EXCL|os.O_WRONLY, file.Mode().Perm())
		if err != nil {
			_ = source.Close()
			return fmt.Errorf("create audio.cpp package artifact %s: %w", targetName, err)
		}
		_, copyErr := io.Copy(target, source)
		closeTargetErr := target.Close()
		closeSourceErr := source.Close()
		if copyErr != nil || closeTargetErr != nil || closeSourceErr != nil {
			return fmt.Errorf("copy audio.cpp package artifact %s", targetName)
		}
		seen[targetName] = true
	}
	for _, name := range audioCppPackageAdmittedFiles {
		if !seen[name] {
			return fmt.Errorf("audio.cpp package artifact %s is missing", name)
		}
	}
	return nil
}

func (m *Manager) requireAudioCppBinaryDependency(cfg EngineConfig) (EngineConfig, error) {
	if strings.TrimSpace(cfg.Version) == "" {
		cfg.Version = AudioCppPackageVersion
	}
	if m.registry == nil {
		return cfg, fmt.Errorf("%w: audio.cpp package registry unavailable", ErrEngineBinaryDependencyNotReady)
	}
	entry := m.registry.Get(EngineAudioCPP, cfg.Version)
	if entry == nil {
		return cfg, fmt.Errorf("%w: state=needs_confirmation; dependency_family=native-engine-package.audio-cpp; dependency_id=audio.cpp.package", ErrEngineBinaryDependencyNotReady)
	}
	if _, err := m.audioCppStatusFromRegistryEntry(entry); err != nil {
		return cfg, fmt.Errorf("%w: state=repair_required; dependency_family=native-engine-package.audio-cpp; dependency_id=audio.cpp.package; %v", ErrEngineBinaryDependencyNotReady, err)
	}
	cfg.BinaryPath = strings.TrimSpace(entry.BinaryPath)
	return cfg, nil
}

func (m *Manager) audioCppStatusFromRegistryEntry(entry *RegistryEntry) (EngineBinaryDependencyStatus, error) {
	if entry == nil {
		return EngineBinaryDependencyStatus{}, fmt.Errorf("audio.cpp package registry entry is missing")
	}
	binaryPath := strings.TrimSpace(entry.BinaryPath)
	if binaryPath == "" {
		return EngineBinaryDependencyStatus{}, fmt.Errorf("audio.cpp package binary path is missing")
	}
	root := filepath.Dir(binaryPath)
	for _, name := range audioCppPackageAdmittedFiles {
		if _, err := os.Stat(filepath.Join(root, name)); err != nil {
			return EngineBinaryDependencyStatus{}, fmt.Errorf("audio.cpp package artifact %s is missing: %w", name, err)
		}
	}
	for _, rejected := range []string{"audiocpp_server.exe", "tools", "model_specs"} {
		if _, err := os.Stat(filepath.Join(root, rejected)); err == nil {
			return EngineBinaryDependencyStatus{}, fmt.Errorf("audio.cpp package contains rejected product entrypoint %s", rejected)
		} else if !os.IsNotExist(err) {
			return EngineBinaryDependencyStatus{}, fmt.Errorf("verify rejected audio.cpp package entrypoint %s: %w", rejected, err)
		}
	}
	info, err := os.Stat(binaryPath)
	if err != nil {
		return EngineBinaryDependencyStatus{}, fmt.Errorf("stat audio.cpp CLI: %w", err)
	}
	if !strings.EqualFold(strings.TrimSpace(entry.SHA256), AudioCppPackageArchiveSHA256) || strings.TrimSpace(entry.AssetName) != AudioCppPackageAssetName {
		return EngineBinaryDependencyStatus{}, fmt.Errorf("audio.cpp package source identity mismatch")
	}
	return EngineBinaryDependencyStatus{
		Engine:           string(EngineAudioCPP),
		Version:          AudioCppPackageVersion,
		BinaryPath:       binaryPath,
		BinarySizeBytes:  info.Size(),
		SHA256:           AudioCppPackageArchiveSHA256,
		Platform:         "windows/amd64",
		AssetName:        AudioCppPackageAssetName,
		AcceleratorPlane: "cuda13",
		Detail:           "audio.cpp release-0.6.1 official CLI package verified and promoted",
	}, nil
}

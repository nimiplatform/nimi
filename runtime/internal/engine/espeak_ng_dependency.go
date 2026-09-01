// @nimi-authority: rule.nimi.runtime.local-compute.r085

package engine

import (
	"archive/zip"
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

const (
	ESpeakNGDependencyID            = "espeak-ng-windows-amd64"
	ESpeakNGDependencyVersion       = "0.2.4"
	ESpeakNGWheelName               = "espeakng_loader-0.2.4-py3-none-win_amd64.whl"
	ESpeakNGWheelURL                = "https://files.pythonhosted.org/packages/9d/ed/a3d872fbad4f3a3f3db0e8c31768ab14e77cd77306de16b8b20b1e1df7ea/espeakng_loader-0.2.4-py3-none-win_amd64.whl"
	ESpeakNGWheelSHA256             = "41f1e08ac9deda2efd1ea9de0b81dab9f5ae3c4b24284f76533d0a7b1dd7abd7" // pragma: allowlist secret -- public wheel checksum
	ESpeakNGWheelBytes        int64 = 9437292
)

var espeakNGRequiredArtifacts = []string{
	"espeak-ng.dll",
	"espeak-ng-data/phontab",
	"espeak-ng-data/lang/gmw/en",
	"espeak-ng-data/lang/gmw/en-US",
}

var espeakNGRequiredArtifactSHA256 = map[string]string{
	"espeak-ng.dll":                 "646d387acbc7ac2aa45e3625aa00a6835ae5d446ff8b0748298c3900b4dde258", // pragma: allowlist secret -- public payload checksum
	"espeak-ng-data/phontab":        "1b40690667e1e9aa1ba5e5234773c799e7e72ea751426e5150423d53c3f24fa2", // pragma: allowlist secret -- public payload checksum
	"espeak-ng-data/lang/gmw/en":    "4605d5330801de3641c6e366d15f129ea1f5ffbce8722642aba01ace07ab9c83", // pragma: allowlist secret -- public payload checksum
	"espeak-ng-data/lang/gmw/en-US": "41534c2a22df5dd4f1052ff9e1a33a3ea7bff5a26b5c02bdad5ba8ddb7524704", // pragma: allowlist secret -- public payload checksum
}

type ESpeakNGDependencyStatus struct {
	DependencyID      string
	Version           string
	CanonicalRoot     string
	LibraryPath       string
	DataPath          string
	VerifiedArtifacts []string
	Hashes            map[string]string
	SourceSHA256      string
	Detail            string
}

func (m *Manager) EnsureESpeakNGDependency(ctx context.Context) (ESpeakNGDependencyStatus, error) {
	if m == nil || !filepath.IsAbs(strings.TrimSpace(m.depsDir)) {
		return ESpeakNGDependencyStatus{}, fmt.Errorf("eSpeak-ng dependency root is unavailable")
	}
	if currentGOOS() != "windows" || currentGOARCH() != "amd64" {
		return ESpeakNGDependencyStatus{}, fmt.Errorf("eSpeak-ng dependency is unsupported on %s/%s", currentGOOS(), currentGOARCH())
	}
	m.espeakNGMu.Lock()
	defer m.espeakNGMu.Unlock()
	targetDir := filepath.Join(m.depsDir, "espeak-ng", ESpeakNGDependencyVersion)
	if status, err := espeakNGStatus(targetDir); err == nil {
		return status, nil
	}
	stagingRoot, err := os.MkdirTemp(m.depsDir, ".espeak-ng-*")
	if err != nil {
		return ESpeakNGDependencyStatus{}, fmt.Errorf("create eSpeak-ng staging root: %w", err)
	}
	defer func() { _ = os.RemoveAll(stagingRoot) }()
	archivePath := filepath.Join(stagingRoot, ESpeakNGWheelName)
	hash, err := downloadURLToFileWithProgress(ctx, ESpeakNGWheelURL, archivePath, downloadProgressFromContext(ctx))
	if err != nil {
		return ESpeakNGDependencyStatus{}, fmt.Errorf("download eSpeak-ng wheel: %w", err)
	}
	info, err := os.Stat(archivePath)
	if err != nil || info.Size() != ESpeakNGWheelBytes || !strings.EqualFold(hash, ESpeakNGWheelSHA256) {
		return ESpeakNGDependencyStatus{}, fmt.Errorf("eSpeak-ng wheel source identity mismatch")
	}
	payload := filepath.Join(stagingRoot, "payload")
	if err := extractESpeakNGWheel(archivePath, payload); err != nil {
		return ESpeakNGDependencyStatus{}, err
	}
	if _, err := espeakNGStatus(payload); err != nil {
		return ESpeakNGDependencyStatus{}, err
	}
	if err := installManagedBinaryPayload(targetDir, payload); err != nil {
		return ESpeakNGDependencyStatus{}, fmt.Errorf("promote eSpeak-ng dependency: %w", err)
	}
	return espeakNGStatus(targetDir)
}

func espeakNGStatus(root string) (ESpeakNGDependencyStatus, error) {
	verified := make([]string, 0, len(espeakNGRequiredArtifacts))
	hashes := make(map[string]string, len(espeakNGRequiredArtifacts))
	for _, relative := range espeakNGRequiredArtifacts {
		path := filepath.Join(root, filepath.FromSlash(relative))
		info, err := os.Stat(path)
		if err != nil || !info.Mode().IsRegular() || info.Size() <= 0 {
			return ESpeakNGDependencyStatus{}, fmt.Errorf("eSpeak-ng artifact %s is unavailable", relative)
		}
		hash, err := sha256File(path)
		if err != nil || !strings.EqualFold(hash, espeakNGRequiredArtifactSHA256[relative]) {
			return ESpeakNGDependencyStatus{}, fmt.Errorf("eSpeak-ng artifact %s content is invalid", relative)
		}
		verified = append(verified, path)
		hashes[relative] = hash
	}
	return ESpeakNGDependencyStatus{
		DependencyID: ESpeakNGDependencyID, Version: ESpeakNGDependencyVersion, CanonicalRoot: filepath.Clean(root),
		LibraryPath: filepath.Join(root, "espeak-ng.dll"), DataPath: filepath.Join(root, "espeak-ng-data"),
		VerifiedArtifacts: verified, Hashes: hashes, SourceSHA256: ESpeakNGWheelSHA256,
		Detail: "espeakng-loader 0.2.4 Windows amd64 wheel verified and promoted",
	}, nil
}

func extractESpeakNGWheel(archivePath string, destination string) error {
	reader, err := zip.OpenReader(archivePath)
	if err != nil {
		return fmt.Errorf("open eSpeak-ng wheel: %w", err)
	}
	defer func() { _ = reader.Close() }()
	const prefix = "espeakng_loader/"
	for _, entry := range reader.File {
		name := filepath.ToSlash(strings.TrimSpace(entry.Name))
		if !strings.HasPrefix(name, prefix) {
			continue
		}
		relative := strings.TrimPrefix(name, prefix)
		if relative != "espeak-ng.dll" && !strings.HasPrefix(relative, "espeak-ng-data/") {
			continue
		}
		clean := filepath.Clean(filepath.FromSlash(relative))
		cleanSlash := filepath.ToSlash(clean)
		if clean == "." || filepath.IsAbs(clean) || strings.HasPrefix(clean, ".."+string(os.PathSeparator)) || (cleanSlash != "espeak-ng.dll" && !strings.HasPrefix(cleanSlash, "espeak-ng-data/")) || entry.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("eSpeak-ng wheel contains an unsafe path")
		}
		target := filepath.Join(destination, clean)
		if entry.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		source, err := entry.Open()
		if err != nil {
			return err
		}
		output, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
		if err != nil {
			_ = source.Close()
			return err
		}
		_, copyErr := io.Copy(output, source)
		closeOutputErr := output.Close()
		closeSourceErr := source.Close()
		if copyErr != nil || closeOutputErr != nil || closeSourceErr != nil {
			return fmt.Errorf("extract eSpeak-ng wheel artifact %s", relative)
		}
	}
	return nil
}

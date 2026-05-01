package engine

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const managedUVVersion = "0.11.8"

type managedUVArchiveSpec struct {
	OS          string
	Arch        string
	ArchiveName string
	SHA256      string
}

var managedUVArchiveSpecs = []managedUVArchiveSpec{
	{
		OS:          "windows",
		Arch:        "amd64",
		ArchiveName: "uv-x86_64-pc-windows-msvc.zip",
		SHA256:      "c84629a56e0706b69a47ea35862208af827cb6fbfa1d0ca763c52c67594637e8",
	},
	{
		OS:          "windows",
		Arch:        "arm64",
		ArchiveName: "uv-aarch64-pc-windows-msvc.zip",
		SHA256:      "bb48716e74e4998993f15bc57a55e4d0d73ccbd27a66d7cbed37605f7c67d747",
	},
	{
		OS:          "darwin",
		Arch:        "amd64",
		ArchiveName: "uv-x86_64-apple-darwin.tar.gz",
		SHA256:      "c59d73bf34b58bc8e33a11629f7a255c11789fd00f03cd3e68ab2d1603645de9",
	},
	{
		OS:          "darwin",
		Arch:        "arm64",
		ArchiveName: "uv-aarch64-apple-darwin.tar.gz",
		SHA256:      "c729adb365114e844dd7f9316313a7ed6443b89bb5681d409eebac78b0bd06c8",
	},
	{
		OS:          "linux",
		Arch:        "amd64",
		ArchiveName: "uv-x86_64-unknown-linux-gnu.tar.gz",
		SHA256:      "56dd1b66701ecb62fe896abb919444e4b83c5e8645cca953e6ddd496ff8a0feb",
	},
	{
		OS:          "linux",
		Arch:        "arm64",
		ArchiveName: "uv-aarch64-unknown-linux-gnu.tar.gz",
		SHA256:      "eee8dd658d20e5ac85fec9c2326b6cbc9d83a1eef09ef07433e58698ac849591",
	},
}

func (m *Manager) EnsureUVToolDependency(ctx context.Context) (UVToolDependencyStatus, error) {
	_ = ctx
	uvRoot := filepath.Join(m.baseDir, "uv")
	spec, ok := managedUVArchiveSpecForCurrentHost()
	if !ok {
		return UVToolDependencyStatus{}, fmt.Errorf("no published Runtime-managed uv package is available for %s/%s", currentGOOS(), currentGOARCH())
	}
	if status, ok := verifiedManagedUVToolStatus(uvRoot, spec); ok {
		return status, nil
	}
	if err := installManagedUVTool(uvRoot, spec); err != nil {
		return UVToolDependencyStatus{}, err
	}
	status, ok := verifiedManagedUVToolStatus(uvRoot, spec)
	if !ok {
		return UVToolDependencyStatus{}, fmt.Errorf("Runtime-managed uv installation did not produce verified executable at %s", managedUVPath(uvRoot))
	}
	return status, nil
}

func managedUVArchiveSpecForCurrentHost() (managedUVArchiveSpec, bool) {
	for _, spec := range managedUVArchiveSpecs {
		if strings.EqualFold(spec.OS, currentGOOS()) && strings.EqualFold(spec.Arch, currentGOARCH()) {
			return spec, true
		}
	}
	return managedUVArchiveSpec{}, false
}

func managedUVArchiveURL(spec managedUVArchiveSpec) string {
	return fmt.Sprintf("https://releases.astral.sh/github/uv/releases/download/%s/%s", managedUVVersion, strings.TrimSpace(spec.ArchiveName))
}

func verifiedManagedUVToolStatus(root string, spec managedUVArchiveSpec) (UVToolDependencyStatus, bool) {
	executablePath := managedUVPath(root)
	if _, err := os.Stat(executablePath); err != nil {
		return UVToolDependencyStatus{}, false
	}
	return UVToolDependencyStatus{
		Version:          managedUVVersion,
		ExecutablePath:   executablePath,
		SourceRoot:       strings.TrimSpace(root),
		ArchiveURL:       managedUVArchiveURL(spec),
		ArchiveSHA256:    strings.TrimSpace(spec.SHA256),
		ArchiveAssetName: strings.TrimSpace(spec.ArchiveName),
		Platform:         currentGOOS() + "/" + currentGOARCH(),
		Detail:           "Runtime-managed uv tool verified from pinned official archive",
	}, true
}

func installManagedUVTool(root string, spec managedUVArchiveSpec) error {
	if strings.TrimSpace(root) == "" {
		return fmt.Errorf("uv install root is required")
	}
	tmpDir, err := os.MkdirTemp(filepath.Dir(root), ".uv-tool-*")
	if err != nil {
		return fmt.Errorf("install uv tool: create temp dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	archivePath := filepath.Join(tmpDir, strings.TrimSpace(spec.ArchiveName))
	archiveHash, err := downloadURLToFile(managedUVArchiveURL(spec), archivePath)
	if err != nil {
		return fmt.Errorf("install uv tool: %w", err)
	}
	if !strings.EqualFold(strings.TrimSpace(spec.SHA256), archiveHash) {
		return fmt.Errorf("%w: expected=%s actual=%s", ErrEngineBinaryHashMismatch, strings.ToLower(strings.TrimSpace(spec.SHA256)), archiveHash)
	}

	stagedDir := filepath.Join(tmpDir, "payload")
	if err := os.MkdirAll(stagedDir, 0o755); err != nil {
		return fmt.Errorf("install uv tool: create staged dir: %w", err)
	}
	if err := extractManagedPayload(archivePath, stagedDir); err != nil {
		return fmt.Errorf("install uv tool: %w", err)
	}
	if _, err := os.Stat(managedUVPath(stagedDir)); err != nil {
		return fmt.Errorf("install uv tool: uv executable missing from staged payload: %w", err)
	}
	if err := os.Chmod(managedUVPath(stagedDir), 0o755); err != nil {
		return fmt.Errorf("install uv tool: chmod executable: %w", err)
	}
	if err := installManagedBinaryPayload(root, stagedDir); err != nil {
		return fmt.Errorf("install uv tool: %w", err)
	}
	return nil
}

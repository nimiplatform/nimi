package engine

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const ManagedUVVersion = "0.13.5"

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
		SHA256:      "a38b8d1902b7cfbc76b423ba1bb456f623f42064cdc72628b6075b89afd1019a",
	},
	{
		OS:          "windows",
		Arch:        "arm64",
		ArchiveName: "uv-aarch64-pc-windows-msvc.zip",
		SHA256:      "09f47edf90726084a70f9426f6e3ca4f46e9bf7cbf23b1716ec64d60b055fae3",
	},
	{
		OS:          "darwin",
		Arch:        "amd64",
		ArchiveName: "uv-x86_64-apple-darwin.tar.gz",
		SHA256:      "b0f52b0e3945b4107d89024ea38e625683011fbfc05a0d98f9fa2d6dcee28c66",
	},
	{
		OS:          "darwin",
		Arch:        "arm64",
		ArchiveName: "uv-aarch64-apple-darwin.tar.gz",
		SHA256:      "743f85035a1996ecb350659e01cd9faea9709829be09b1b4b03c73eaf3c9cd73",
	},
	{
		OS:          "linux",
		Arch:        "amd64",
		ArchiveName: "uv-x86_64-unknown-linux-gnu.tar.gz",
		SHA256:      "f68d291c75783122dad58ab77def0e13f3233f358731db5d6d7e8715603b928f",
	},
	{
		OS:          "linux",
		Arch:        "arm64",
		ArchiveName: "uv-aarch64-unknown-linux-gnu.tar.gz",
		SHA256:      "4bb69cf95ed13f23713bb7bc09f241896ea0c75b7c557e615a20604b82f9c403",
	},
}

func (m *Manager) EnsureUVToolDependency(ctx context.Context) (UVToolDependencyStatus, error) {
	// Multiple admitted Python consumers share this exact executable. Keep
	// verification and first materialization in one Manager-owned critical
	// section so a later consumer cannot replace uv.exe after an earlier
	// consumer has started using the verified payload.
	m.uvToolMu.Lock()
	defer m.uvToolMu.Unlock()

	// The uv tool is a standalone downloaded dependency payload
	// (python.tool.uv -> managed_root: dependencies in
	// local-environment-dependencies.yaml), so it installs under the
	// data-plane `dependencies` root, not the `environments` engine tree.
	uvRoot := filepath.Join(m.depsDir, "uv")
	spec, ok := managedUVArchiveSpecForCurrentHost()
	if !ok {
		return UVToolDependencyStatus{}, fmt.Errorf("no published Runtime-managed uv package is available for %s/%s", currentGOOS(), currentGOARCH())
	}
	if status, ok := verifiedManagedUVToolStatus(uvRoot, spec); ok {
		return status, nil
	}
	if err := installManagedUVTool(ctx, uvRoot, spec); err != nil {
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
	return fmt.Sprintf("https://releases.astral.sh/github/uv/releases/download/%s/%s", ManagedUVVersion, strings.TrimSpace(spec.ArchiveName))
}

func verifiedManagedUVToolStatus(root string, spec managedUVArchiveSpec) (UVToolDependencyStatus, bool) {
	executablePath := managedUVPath(root)
	if _, err := os.Stat(executablePath); err != nil || !verifyManagedUVManifest(root, spec) {
		return UVToolDependencyStatus{}, false
	}
	return UVToolDependencyStatus{
		Version:          ManagedUVVersion,
		ExecutablePath:   executablePath,
		SourceRoot:       strings.TrimSpace(root),
		ArchiveURL:       managedUVArchiveURL(spec),
		ArchiveSHA256:    strings.TrimSpace(spec.SHA256),
		ArchiveAssetName: strings.TrimSpace(spec.ArchiveName),
		Platform:         currentGOOS() + "/" + currentGOARCH(),
		Detail:           "Runtime-managed uv tool verified from pinned official archive",
	}, true
}

func installManagedUVTool(ctx context.Context, root string, spec managedUVArchiveSpec) error {
	if strings.TrimSpace(root) == "" {
		return fmt.Errorf("uv install root is required")
	}
	tmpDir, err := os.MkdirTemp(filepath.Dir(root), ".uv-tool-*")
	if err != nil {
		return fmt.Errorf("install uv tool: create temp dir: %w", err)
	}
	defer func() { _ = os.RemoveAll(tmpDir) }()

	archivePath := filepath.Join(tmpDir, strings.TrimSpace(spec.ArchiveName))
	archiveHash, err := downloadURLToFileWithProgress(ctx, managedUVArchiveURL(spec), archivePath, downloadProgressFromContext(ctx))
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
	if err := writeManagedUVManifest(stagedDir, spec); err != nil {
		return fmt.Errorf("install uv tool: write owner manifest: %w", err)
	}
	if err := installManagedBinaryPayload(root, stagedDir); err != nil {
		return fmt.Errorf("install uv tool: %w", err)
	}
	return nil
}

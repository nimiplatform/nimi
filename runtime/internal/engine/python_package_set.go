package engine

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
)

type pythonPackageSetManifest struct {
	ID           string
	Packages     []string
	ImportProbes []string
	ExtraArgs    []string
}

func resolvePythonPackageSetManifest(consumer string) (pythonPackageSetManifest, error) {
	trimmed := strings.TrimSpace(consumer)
	switch {
	case strings.HasPrefix(trimmed, "media."):
		return pythonPackageSetManifest{
			ID:           "media-python-pipeline-core",
			Packages:     append([]string{}, mediaPythonPipelinePackages...),
			ImportProbes: []string{"diffusers", "transformers", "accelerate", "safetensors", "PIL", "imageio"},
		}, nil
	case strings.HasPrefix(trimmed, "speech."):
		return pythonPackageSetManifest{
			ID:           "speech-qwen3-python-core",
			Packages:     append([]string{}, nimiSpeechPackages...),
			ImportProbes: []string{"fastapi", "uvicorn", "multipart"},
		}, nil
	default:
		return pythonPackageSetManifest{}, fmt.Errorf("python package set dependency is not admitted for consumer %s", consumer)
	}
}

func pythonPackageSetLockHash(manifest pythonPackageSetManifest) string {
	lines := []string{"package_set_id=" + strings.TrimSpace(manifest.ID)}
	for _, pkg := range manifest.Packages {
		lines = append(lines, "package="+strings.TrimSpace(pkg))
	}
	for _, probe := range manifest.ImportProbes {
		lines = append(lines, "import_probe="+strings.TrimSpace(probe))
	}
	sort.Strings(lines[1:])
	sum := sha256.Sum256([]byte(strings.Join(lines, "\n") + "\n"))
	return hex.EncodeToString(sum[:])
}

func verifyPythonImportProbe(ctx context.Context, interpreterPath string, probe string) error {
	module := strings.TrimSpace(probe)
	if module == "" {
		return fmt.Errorf("python import probe module is required")
	}
	_, err := runCommandOutput(ctx, "", nil, interpreterPath, "-c", "import "+module)
	if err != nil {
		return fmt.Errorf("verify python import probe %s: %w", module, err)
	}
	return nil
}

func (m *Manager) EnsurePythonPackageSetDependency(ctx context.Context, uvPath string, venvRoot string, consumer string) (PythonPackageSetDependencyStatus, error) {
	manifest, err := resolvePythonPackageSetManifest(consumer)
	if err != nil {
		return PythonPackageSetDependencyStatus{}, err
	}
	trimmedVenvRoot := strings.TrimSpace(venvRoot)
	if trimmedVenvRoot == "" {
		return PythonPackageSetDependencyStatus{}, fmt.Errorf("python package set venv root is required")
	}
	interpreterPath := managedPythonPath(trimmedVenvRoot)
	lockHash := pythonPackageSetLockHash(manifest)
	args := append([]string{}, manifest.ExtraArgs...)
	if err := uvPipInstall(ctx, uvPath, interpreterPath, manifest.Packages, args...); err != nil {
		return PythonPackageSetDependencyStatus{}, err
	}
	freezeOutput, err := runCommandOutput(ctx, "", nil, strings.TrimSpace(uvPath), "pip", "freeze", "--python", interpreterPath)
	if err != nil {
		return PythonPackageSetDependencyStatus{}, fmt.Errorf("verify python package set distributions: %w", err)
	}
	distributions := normalizePackageFreezeLines(freezeOutput)
	if len(distributions) == 0 {
		return PythonPackageSetDependencyStatus{}, fmt.Errorf("verify python package set distributions: empty installed distribution set")
	}
	for _, probe := range manifest.ImportProbes {
		if err := verifyPythonImportProbe(ctx, interpreterPath, probe); err != nil {
			return PythonPackageSetDependencyStatus{}, err
		}
	}
	return PythonPackageSetDependencyStatus{
		PackageSetID:           manifest.ID,
		LockHash:               lockHash,
		VenvRoot:               trimmedVenvRoot,
		InterpreterPath:        interpreterPath,
		UVExecutable:           strings.TrimSpace(uvPath),
		Packages:               append([]string{}, manifest.Packages...),
		InstalledDistributions: distributions,
		ImportProbes:           append([]string{}, manifest.ImportProbes...),
		Detail:                 "Runtime-managed Python package set verified from declared lock manifest",
	}, nil
}

func normalizePackageFreezeLines(output string) []string {
	lines := strings.Split(strings.TrimSpace(output), "\n")
	result := make([]string, 0, len(lines))
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		result = append(result, filepath.ToSlash(trimmed))
	}
	sort.Strings(result)
	return result
}

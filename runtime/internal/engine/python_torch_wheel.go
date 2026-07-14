package engine

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
)

const defaultMediaTorchCPUIndexURL = "https://download.pytorch.org/whl/cpu"

type pythonTorchWheelManifest struct {
	Packages         []string
	ImportProbes     []string
	AcceleratorPlane string
	CUDAABI          string
	WheelIndex       string
}

func resolvePythonTorchWheelManifest(consumer string) (pythonTorchWheelManifest, error) {
	trimmed := strings.TrimSpace(consumer)
	switch {
	case strings.HasPrefix(trimmed, "media.") && strings.HasSuffix(trimmed, ".cuda"):
		return pythonTorchWheelManifest{
			Packages:         append([]string{}, mediaPackages[:2]...),
			ImportProbes:     []string{"torch", "torchvision"},
			AcceleratorPlane: "cuda",
			CUDAABI:          "cu126",
			WheelIndex:       defaultMediaTorchIndexURL,
		}, nil
	case strings.HasPrefix(trimmed, "media.") && strings.HasSuffix(trimmed, ".cpu"):
		return pythonTorchWheelManifest{
			Packages:         append([]string{}, mediaPackages[:2]...),
			ImportProbes:     []string{"torch", "torchvision"},
			AcceleratorPlane: "cpu",
			CUDAABI:          "none",
			WheelIndex:       defaultMediaTorchCPUIndexURL,
		}, nil
	default:
		return pythonTorchWheelManifest{}, fmt.Errorf("python torch wheel dependency is not admitted for consumer %s", consumer)
	}
}

func pythonTorchWheelLockHash(manifest pythonTorchWheelManifest) string {
	lines := []string{
		"accelerator_plane=" + strings.TrimSpace(manifest.AcceleratorPlane),
		"cuda_abi=" + strings.TrimSpace(manifest.CUDAABI),
		"wheel_index=" + strings.TrimSpace(manifest.WheelIndex),
	}
	for _, pkg := range manifest.Packages {
		lines = append(lines, "package="+strings.TrimSpace(pkg))
	}
	for _, probe := range manifest.ImportProbes {
		lines = append(lines, "import_probe="+strings.TrimSpace(probe))
	}
	sum := sha256.Sum256([]byte(strings.Join(lines, "\n") + "\n"))
	return hex.EncodeToString(sum[:])
}

func (m *Manager) EnsurePythonTorchWheelDependency(ctx context.Context, uvPath string, venvRoot string, consumer string) (PythonTorchWheelDependencyStatus, error) {
	manifest, err := resolvePythonTorchWheelManifest(consumer)
	if err != nil {
		return PythonTorchWheelDependencyStatus{}, err
	}
	trimmedVenvRoot := strings.TrimSpace(venvRoot)
	if trimmedVenvRoot == "" {
		return PythonTorchWheelDependencyStatus{}, fmt.Errorf("python torch wheel venv root is required")
	}
	interpreterPath := managedPythonPath(trimmedVenvRoot)
	extraArgs := []string{"--index-url", manifest.WheelIndex}
	if err := uvPipInstall(ctx, uvPath, trimmedVenvRoot, interpreterPath, manifest.Packages, extraArgs...); err != nil {
		return PythonTorchWheelDependencyStatus{}, err
	}
	for _, probe := range manifest.ImportProbes {
		if err := verifyPythonImportProbe(ctx, trimmedVenvRoot, interpreterPath, probe); err != nil {
			return PythonTorchWheelDependencyStatus{}, err
		}
	}
	torchVersion, err := runCommandOutput(
		ctx,
		trimmedVenvRoot,
		managedPythonRuntimeEnv(trimmedVenvRoot),
		interpreterPath,
		"-c", "import torch; print(torch.__version__); print(torch.version.cuda or 'cpu')",
	)
	if err != nil {
		return PythonTorchWheelDependencyStatus{}, fmt.Errorf("verify torch version and accelerator ABI: %w", err)
	}
	observed := strings.Fields(strings.TrimSpace(torchVersion))
	if len(observed) == 0 {
		return PythonTorchWheelDependencyStatus{}, fmt.Errorf("verify torch version and accelerator ABI: empty output")
	}
	observedCUDA := ""
	if len(observed) > 1 {
		observedCUDA = observed[1]
	}
	if manifest.AcceleratorPlane == "cuda" && strings.TrimSpace(observedCUDA) == "" {
		return PythonTorchWheelDependencyStatus{}, fmt.Errorf("verify torch CUDA ABI: empty CUDA version")
	}
	return PythonTorchWheelDependencyStatus{
		TorchVersion:     observed[0],
		TorchvisionSpec:  "torchvision==0.22.1",
		AcceleratorPlane: manifest.AcceleratorPlane,
		CUDAABI:          manifest.CUDAABI,
		WheelIndex:       manifest.WheelIndex,
		WheelLockHash:    pythonTorchWheelLockHash(manifest),
		VenvRoot:         trimmedVenvRoot,
		InterpreterPath:  interpreterPath,
		UVExecutable:     strings.TrimSpace(uvPath),
		ImportProbes:     append([]string{}, manifest.ImportProbes...),
		Detail:           "Runtime-managed Python torch wheel set verified from declared wheel index",
	}, nil
}

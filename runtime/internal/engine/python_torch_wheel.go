package engine

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
)

const (
	defaultMediaTorchCPUIndexURL   = "https://download.pytorch.org/whl/cpu"
	defaultSpeechTorchCUDAIndexURL = "https://download.pytorch.org/whl/cu128"
	speechTorchVersion             = "2.11.0"
)

type pythonTorchWheelManifest struct {
	Packages         []string
	ImportProbes     []string
	AcceleratorPlane string
	CUDAABI          string
	WheelIndex       string
}

type PythonTorchWheelDependencyIdentity struct {
	TorchVersion     string
	AcceleratorPlane string
	CUDAABI          string
	WheelLockHash    string
}

func ResolvePythonTorchWheelDependencyIdentity(consumer string) (PythonTorchWheelDependencyIdentity, error) {
	manifest, err := resolvePythonTorchWheelManifest(consumer)
	if err != nil {
		return PythonTorchWheelDependencyIdentity{}, err
	}
	torchVersion := ""
	for _, pkg := range manifest.Packages {
		if strings.HasPrefix(strings.TrimSpace(pkg), "torch==") {
			torchVersion = strings.TrimPrefix(strings.TrimSpace(pkg), "torch==")
			break
		}
	}
	if torchVersion == "" || strings.TrimSpace(manifest.AcceleratorPlane) == "" || strings.TrimSpace(manifest.CUDAABI) == "" {
		return PythonTorchWheelDependencyIdentity{}, fmt.Errorf("python torch wheel dependency identity is incomplete for consumer %s", consumer)
	}
	return PythonTorchWheelDependencyIdentity{
		TorchVersion:     torchVersion,
		AcceleratorPlane: strings.TrimSpace(manifest.AcceleratorPlane),
		CUDAABI:          strings.TrimSpace(manifest.CUDAABI),
		WheelLockHash:    pythonTorchWheelLockHash(manifest),
	}, nil
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
	case strings.HasPrefix(trimmed, "speech.") && strings.HasSuffix(trimmed, ".cuda"):
		packages := []string{"torch==" + speechTorchVersion}
		probes := []string{"torch"}
		if strings.HasPrefix(trimmed, "speech.qwen3-tts.python.") {
			packages = append(packages, "torchaudio=="+speechTorchVersion)
			probes = append(probes, "torchaudio")
		}
		return pythonTorchWheelManifest{
			Packages:         packages,
			ImportProbes:     probes,
			AcceleratorPlane: "cuda",
			CUDAABI:          "cu128",
			WheelIndex:       defaultSpeechTorchCUDAIndexURL,
		}, nil
	case strings.HasPrefix(trimmed, "speech.") && strings.HasSuffix(trimmed, ".cpu"):
		packages := []string{"torch==" + speechTorchVersion}
		probes := []string{"torch"}
		if strings.HasPrefix(trimmed, "speech.qwen3-tts.python.") {
			packages = append(packages, "torchaudio=="+speechTorchVersion)
			probes = append(probes, "torchaudio")
		}
		return pythonTorchWheelManifest{
			Packages:         packages,
			ImportProbes:     probes,
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

func pythonTorchWheelPackageSpec(manifest pythonTorchWheelManifest, packageName string) string {
	prefix := strings.TrimSpace(packageName) + "=="
	for _, pkg := range manifest.Packages {
		if strings.HasPrefix(strings.TrimSpace(pkg), prefix) {
			return strings.TrimSpace(pkg)
		}
	}
	return ""
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
	if manifest.AcceleratorPlane == "cuda" {
		if _, err := runCommandOutput(
			ctx,
			trimmedVenvRoot,
			managedPythonRuntimeEnv(trimmedVenvRoot),
			interpreterPath,
			"-c", "import torch; assert torch.cuda.is_available(), 'CUDA unavailable'; value = torch.ones(1, device='cuda'); print(torch.cuda.get_device_name(0)); print(float(value.item()))",
		); err != nil {
			return PythonTorchWheelDependencyStatus{}, fmt.Errorf("verify torch CUDA execution: %w", err)
		}
	}
	return PythonTorchWheelDependencyStatus{
		TorchVersion:     observed[0],
		TorchvisionSpec:  pythonTorchWheelPackageSpec(manifest, "torchvision"),
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

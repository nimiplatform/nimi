package engine

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
)

const (
	defaultMediaTorchCPUIndexURL   = "https://download.pytorch.org/whl/cpu"
	defaultSpeechTorchCUDAIndexURL = "https://download.pytorch.org/whl/cu128"
	pythonTorchPackageSource       = "pytorch-official-wheel-index"
	speechTorchVersion             = "2.11.0"
)

type pythonTorchWheelManifest struct {
	Packages         []string
	ImportProbes     []string
	AcceleratorPlane string
	CUDAABI          string
	WheelIndex       string
	PackageSource    string
}

type PythonTorchWheelDependencyIdentity struct {
	TorchVersion     string
	AcceleratorPlane string
	CUDAABI          string
	WheelLockHash    string
	WheelIndex       string
	PackageSource    string
	ImportProbes     []string
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
	if torchVersion == "" || strings.TrimSpace(manifest.AcceleratorPlane) == "" || strings.TrimSpace(manifest.CUDAABI) == "" || strings.TrimSpace(manifest.WheelIndex) == "" || strings.TrimSpace(manifest.PackageSource) == "" {
		return PythonTorchWheelDependencyIdentity{}, fmt.Errorf("python torch wheel dependency identity is incomplete for consumer %s", consumer)
	}
	return PythonTorchWheelDependencyIdentity{
		TorchVersion:     torchVersion,
		AcceleratorPlane: strings.TrimSpace(manifest.AcceleratorPlane),
		CUDAABI:          strings.TrimSpace(manifest.CUDAABI),
		WheelLockHash:    pythonTorchWheelLockHash(manifest),
		WheelIndex:       strings.TrimSpace(manifest.WheelIndex),
		PackageSource:    strings.TrimSpace(manifest.PackageSource),
		ImportProbes:     append([]string(nil), manifest.ImportProbes...),
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
			PackageSource:    pythonTorchPackageSource,
		}, nil
	case strings.HasPrefix(trimmed, "media.") && strings.HasSuffix(trimmed, ".cpu"):
		return pythonTorchWheelManifest{
			Packages:         append([]string{}, mediaPackages[:2]...),
			ImportProbes:     []string{"torch", "torchvision"},
			AcceleratorPlane: "cpu",
			CUDAABI:          "none",
			WheelIndex:       defaultMediaTorchCPUIndexURL,
			PackageSource:    pythonTorchPackageSource,
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
			PackageSource:    pythonTorchPackageSource,
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
			PackageSource:    pythonTorchPackageSource,
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
		"package_source=" + strings.TrimSpace(manifest.PackageSource),
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

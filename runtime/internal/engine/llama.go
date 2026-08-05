package engine

import (
	"fmt"
	"os/exec"
	"strconv"
	"strings"
)

// llamaDownloadURL builds the GitHub Releases download URL for a llama pack.
func llamaDownloadURL(version string) (string, error) {
	asset, err := llamaReleaseAsset(version)
	if err != nil {
		return "", err
	}
	return asset.DownloadURL, nil
}

// llamaAssetName returns the expected official llama.cpp release asset name for
// the current platform.
func llamaAssetName(version string) (string, error) {
	candidates, err := llamaAssetNameCandidates(version, currentGOOS(), currentGOARCH(), detectLocalGPUVendor())
	if err != nil {
		return "", err
	}
	return candidates[0], nil
}

func llamaAssetNameFor(version string, goos string, goarch string) (string, error) {
	trimmedVersion := strings.TrimSpace(version)
	if trimmedVersion == "" {
		return "", fmt.Errorf("llama version is required")
	}
	assetSuffix, ok := llamaSupervisedAssetNameSuffix(goos, goarch)
	if ok {
		return fmt.Sprintf("llama-%s-%s", trimmedVersion, assetSuffix), nil
	}
	return "", fmt.Errorf("unsupported platform: %s/%s", strings.TrimSpace(goos), strings.TrimSpace(goarch))
}

func llamaAssetNameCandidates(version string, goos string, goarch string, gpuVendor string) ([]string, error) {
	cpuAssetName, err := llamaAssetNameFor(version, goos, goarch)
	if err != nil {
		return nil, err
	}
	if strings.EqualFold(strings.TrimSpace(goos), "windows") &&
		strings.EqualFold(strings.TrimSpace(goarch), "amd64") &&
		strings.EqualFold(strings.TrimSpace(gpuVendor), "nvidia") {
		trimmedVersion := strings.TrimSpace(version)
		return []string{
			fmt.Sprintf("llama-%s-bin-win-cuda-12.4-x64.zip", trimmedVersion),
			cpuAssetName,
		}, nil
	}
	return []string{cpuAssetName}, nil
}

func preferredLlamaAssetNameForCurrentHost(version string) (string, error) {
	candidates, err := llamaAssetNameCandidates(version, currentGOOS(), currentGOARCH(), detectLocalGPUVendor())
	if err != nil {
		return "", err
	}
	return candidates[0], nil
}

func llamaAcceleratorPlaneForAsset(assetName string) string {
	lower := strings.ToLower(strings.TrimSpace(assetName))
	switch {
	case strings.Contains(lower, "cuda"):
		return "cuda"
	case strings.Contains(lower, "vulkan"):
		return "vulkan"
	default:
		return "cpu"
	}
}

func llamaRegistryEntryUsesCUDA(entry *RegistryEntry) bool {
	if entry == nil {
		return false
	}
	if strings.EqualFold(strings.TrimSpace(entry.AcceleratorPlane), "cuda") {
		return true
	}
	return strings.Contains(strings.ToLower(strings.TrimSpace(entry.AssetName)), "cuda")
}

func llamaRegistryEntryRequiresReplacement(entry *RegistryEntry, preferredAssetName string) bool {
	if entry == nil {
		return true
	}
	trimmedPreferred := strings.TrimSpace(preferredAssetName)
	if trimmedPreferred == "" {
		return false
	}
	registeredAsset := strings.TrimSpace(entry.AssetName)
	if registeredAsset == "" {
		return strings.Contains(strings.ToLower(trimmedPreferred), "cuda")
	}
	return registeredAsset != trimmedPreferred
}

// llamaCommand builds a host process from Driver-produced opaque arguments.
// Binary, loopback host, and port are Host facts; model and llama option
// semantics must already be fully projected by capabilitydriver.
func llamaCommand(cfg EngineConfig) (*exec.Cmd, error) {
	binaryPath := strings.TrimSpace(cfg.BinaryPath)
	if binaryPath == "" {
		return nil, fmt.Errorf("llama binary path is required")
	}
	if len(cfg.CommandArgs) == 0 {
		return nil, fmt.Errorf("llama Driver invocation arguments are required")
	}
	args := []string{"--host", "127.0.0.1", "--port", strconv.Itoa(cfg.Port)}
	args = append(args, cfg.CommandArgs...)
	return exec.Command(binaryPath, args...), nil
}

// llamaBinaryName returns the expected binary name within the engines directory.
func llamaBinaryName() string {
	if currentGOOS() == "windows" {
		return "llama-server.exe"
	}
	return "llama-server"
}

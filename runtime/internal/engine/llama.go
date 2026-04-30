package engine

import (
	"fmt"
	"os"
	"os/exec"
	"path"
	"path/filepath"
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

// llamaCommand builds the exec.Cmd for starting llama-server.
func llamaCommand(cfg EngineConfig) (*exec.Cmd, error) {
	args := []string{
		"--host", "127.0.0.1",
		"--port", strconv.Itoa(cfg.Port),
		"--reasoning", "off",
	}
	if cfg.ManagedLlamaTarget == nil && strings.TrimSpace(cfg.ModelsConfigPath) != "" {
		args = append(args, "--models-preset", strings.TrimSpace(cfg.ModelsConfigPath))
		return exec.Command(cfg.BinaryPath, args...), nil
	}

	modelPath, modelAlias, params, err := resolveManagedLlamaModelEntry(cfg)
	if err != nil {
		return nil, err
	}
	args = append(args, "--model", modelPath)
	if modelAlias != "" {
		args = append(args, "--alias", modelAlias)
	}
	engineArgs, err := projectLlamaEngineParams(cfg.ModelsPath, params)
	if err != nil {
		return nil, fmt.Errorf("project llama engine params: %w", err)
	}
	args = append(args, engineArgs...)
	return exec.Command(cfg.BinaryPath, args...), nil
}

func resolveManagedLlamaModelEntry(cfg EngineConfig) (string, string, llamaModelsConfigParameter, error) {
	if target := normalizeManagedLlamaTarget(cfg.ManagedLlamaTarget, cfg.ModelsPath); target != nil {
		return target.ModelPath, target.ModelAlias, managedLlamaTargetParams(target), nil
	}

	configPath := strings.TrimSpace(cfg.ModelsConfigPath)
	if configPath == "" {
		return "", "", llamaModelsConfigParameter{}, fmt.Errorf("llama models config path is required")
	}

	raw, err := os.ReadFile(configPath)
	if err != nil {
		return "", "", llamaModelsConfigParameter{}, fmt.Errorf("read llama models config %s: %w", configPath, err)
	}

	entries, err := parseLlamaModelsConfigEntries(raw)
	if err != nil {
		return "", "", llamaModelsConfigParameter{}, fmt.Errorf("parse llama models config %s: %w", configPath, err)
	}

	modelsRoot := strings.TrimSpace(cfg.ModelsPath)
	for _, entry := range entries {
		backend := strings.TrimSpace(entry.Backend)
		if backend != "" && !strings.EqualFold(backend, "llama-cpp") {
			continue
		}
		modelPath := strings.TrimSpace(entry.Parameters.Model)
		if modelPath == "" {
			continue
		}
		if !filepath.IsAbs(modelPath) && !path.IsAbs(filepath.ToSlash(modelPath)) && modelsRoot != "" {
			modelPath = filepath.Join(modelsRoot, filepath.FromSlash(modelPath))
		}
		return modelPath, strings.TrimSpace(entry.Name), entry.Parameters, nil
	}

	return "", "", llamaModelsConfigParameter{}, fmt.Errorf("llama models config %s does not contain a managed llama-cpp model entry", configPath)
}

func normalizeManagedLlamaTarget(target *ManagedLlamaTarget, modelsRoot string) *ManagedLlamaTarget {
	if target == nil {
		return nil
	}
	modelPath := strings.TrimSpace(target.ModelPath)
	if modelPath == "" {
		return nil
	}
	if !filepath.IsAbs(modelPath) && strings.TrimSpace(modelsRoot) != "" {
		modelPath = filepath.Join(strings.TrimSpace(modelsRoot), filepath.FromSlash(modelPath))
	}
	return &ManagedLlamaTarget{
		ModelPath:    modelPath,
		ModelAlias:   strings.TrimSpace(target.ModelAlias),
		EngineConfig: target.EngineConfig,
	}
}

func managedLlamaTargetParams(target *ManagedLlamaTarget) llamaModelsConfigParameter {
	if target == nil {
		return llamaModelsConfigParameter{}
	}
	return llamaModelsConfigParameter{
		Model:      strings.TrimSpace(target.ModelPath),
		Mmproj:     strings.TrimSpace(target.EngineConfig.Mmproj),
		CtxSize:    target.EngineConfig.CtxSize,
		CacheTypeK: strings.TrimSpace(target.EngineConfig.CacheTypeK),
		CacheTypeV: strings.TrimSpace(target.EngineConfig.CacheTypeV),
		FlashAttn:  strings.TrimSpace(target.EngineConfig.FlashAttn),
		NGPULayers: target.EngineConfig.NGPULayers,
	}
}

// llamaBinaryName returns the expected binary name within the engines directory.
func llamaBinaryName() string {
	if currentGOOS() == "windows" {
		return "llama-server.exe"
	}
	return "llama-server"
}

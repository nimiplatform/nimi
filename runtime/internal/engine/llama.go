package engine

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
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
	return llamaAssetNameFor(version, currentGOOS(), currentGOARCH())
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

// llamaCommand builds the exec.Cmd for starting llama-server.
func llamaCommand(cfg EngineConfig) (*exec.Cmd, error) {
	modelPath, modelAlias, err := resolveManagedLlamaModelEntry(cfg)
	if err != nil {
		return nil, err
	}
	args := []string{
		"--host", "127.0.0.1",
		"--port", strconv.Itoa(cfg.Port),
		"--model", modelPath,
	}
	if modelAlias != "" {
		args = append(args, "--alias", modelAlias)
	}
	return exec.Command(cfg.BinaryPath, args...), nil
}

func resolveManagedLlamaModelEntry(cfg EngineConfig) (string, string, error) {
	configPath := strings.TrimSpace(cfg.ModelsConfigPath)
	if configPath == "" {
		return "", "", fmt.Errorf("llama models config path is required")
	}

	raw, err := os.ReadFile(configPath)
	if err != nil {
		return "", "", fmt.Errorf("read llama models config %s: %w", configPath, err)
	}

	var entries []llamaModelsConfigEntry
	if err := yaml.Unmarshal(raw, &entries); err != nil {
		return "", "", fmt.Errorf("parse llama models config %s: %w", configPath, err)
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
		if !filepath.IsAbs(modelPath) && modelsRoot != "" {
			modelPath = filepath.Join(modelsRoot, filepath.FromSlash(modelPath))
		}
		return modelPath, strings.TrimSpace(entry.Name), nil
	}

	return "", "", fmt.Errorf("llama models config %s does not contain a managed llama-cpp model entry", configPath)
}

// llamaBinaryName returns the expected binary name within the engines directory.
func llamaBinaryName() string {
	if currentGOOS() == "windows" {
		return "llama-server.exe"
	}
	return "llama-server"
}

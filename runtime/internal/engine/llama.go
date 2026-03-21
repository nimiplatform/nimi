package engine

import (
	"fmt"
	"os/exec"
	"sort"
	"strings"
)

// llamaDownloadURL builds the GitHub Releases download URL for a llama binary.
func llamaDownloadURL(version string) (string, error) {
	asset, err := llamaAssetName(version)
	if err != nil {
		return "", err
	}
	return llamaReleaseAssetURL(version, asset), nil
}

// llamaAssetName returns the expected binary asset name for the current platform.
func llamaAssetName(version string) (string, error) {
	trimmedVersion := strings.TrimSpace(version)
	if trimmedVersion == "" {
		return "", fmt.Errorf("llama version is required")
	}
	assetSuffix, ok := llamaSupervisedAssetSuffix(currentGOOS(), currentGOARCH())
	if ok {
		return fmt.Sprintf("local-ai-v%s-%s", trimmedVersion, assetSuffix), nil
	}
	return "", fmt.Errorf("unsupported platform: %s", PlatformString())
}

// llamaCommand builds the exec.Cmd for starting llama.
func llamaCommand(cfg EngineConfig) *exec.Cmd {
	args := []string{
		"run",
		"--address", ":" + itoa(cfg.Port),
		"--disable-web-ui",
		"--log-level", "info",
	}
	if cfg.ModelsPath != "" {
		args = append(args, "--models-path", cfg.ModelsPath)
	}
	if cfg.ModelsConfigPath != "" {
		args = append(args, "--models-config-file", cfg.ModelsConfigPath)
	}
	if cfg.BackendsPath != "" {
		args = append(args, "--backends-path", cfg.BackendsPath)
	}
	if len(cfg.ExternalBackends) > 0 {
		args = append(args, "--external-backends", strings.Join(cfg.ExternalBackends, ","))
	}
	if len(cfg.ExternalGRPCBackends) > 0 {
		args = append(args, "--external-grpc-backends", strings.Join(normalizeLlamaExternalGRPCBackends(cfg.ExternalGRPCBackends), ","))
	}
	return exec.Command(cfg.BinaryPath, args...)
}

// llamaBinaryName returns the expected binary name within the engines directory.
func llamaBinaryName() string {
	if currentGOOS() == "windows" {
		return "local-ai.exe"
	}
	return "local-ai"
}

func normalizeLlamaExternalGRPCBackends(backends []string) []string {
	seen := make(map[string]struct{}, len(backends))
	result := make([]string, 0, len(backends))
	for _, backend := range backends {
		trimmed := strings.TrimSpace(backend)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		result = append(result, trimmed)
	}
	sort.Strings(result)
	return result
}

package engine

import (
	"fmt"
	"os/exec"
	"runtime"
	"sort"
	"strings"
)

// localAIDownloadURL builds the GitHub Releases download URL for a LocalAI binary.
func localAIDownloadURL(version string) (string, error) {
	asset, err := localAIAssetName(version)
	if err != nil {
		return "", err
	}
	return localAIReleaseAssetURL(version, asset), nil
}

// localAIAssetName returns the expected binary asset name for the current platform.
func localAIAssetName(version string) (string, error) {
	trimmedVersion := strings.TrimSpace(version)
	if trimmedVersion == "" {
		return "", fmt.Errorf("localai version is required")
	}
	switch runtime.GOOS {
	case "darwin":
		switch runtime.GOARCH {
		case "arm64":
			return fmt.Sprintf("local-ai-v%s-darwin-arm64", trimmedVersion), nil
		case "amd64":
			return fmt.Sprintf("local-ai-v%s-darwin-amd64", trimmedVersion), nil
		}
	case "linux":
		switch runtime.GOARCH {
		case "amd64":
			return fmt.Sprintf("local-ai-v%s-linux-amd64", trimmedVersion), nil
		case "arm64":
			return fmt.Sprintf("local-ai-v%s-linux-arm64", trimmedVersion), nil
		}
	}
	return "", fmt.Errorf("unsupported platform: %s/%s", runtime.GOOS, runtime.GOARCH)
}

// localAICommand builds the exec.Cmd for starting LocalAI.
func localAICommand(cfg EngineConfig) *exec.Cmd {
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
		args = append(args, "--external-grpc-backends", strings.Join(normalizeLocalAIExternalGRPCBackends(cfg.ExternalGRPCBackends), ","))
	}
	return exec.Command(cfg.BinaryPath, args...)
}

// localAIBinaryName returns the expected binary name within the engines directory.
func localAIBinaryName() string {
	if runtime.GOOS == "windows" {
		return "local-ai.exe"
	}
	return "local-ai"
}

func normalizeLocalAIExternalGRPCBackends(backends []string) []string {
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

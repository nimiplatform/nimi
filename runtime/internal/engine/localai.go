package engine

import (
	"fmt"
	"os/exec"
	"runtime"
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
		"--disable-webui",
		"--log-level", "info",
	}
	if cfg.ModelsPath != "" {
		args = append(args, "--models-path", cfg.ModelsPath)
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

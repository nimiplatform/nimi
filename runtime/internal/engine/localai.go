package engine

import (
	"fmt"
	"os/exec"
	"runtime"
)

// localAIDownloadURL builds the GitHub Releases download URL for a LocalAI binary.
func localAIDownloadURL(version string) (string, error) {
	asset, err := localAIAssetName()
	if err != nil {
		return "", err
	}
	return fmt.Sprintf(
		"https://github.com/mudler/LocalAI/releases/download/v%s/%s",
		version, asset,
	), nil
}

// localAIAssetName returns the expected binary asset name for the current platform.
func localAIAssetName() (string, error) {
	switch runtime.GOOS {
	case "darwin":
		switch runtime.GOARCH {
		case "arm64":
			return "local-ai-Darwin-arm64", nil
		case "amd64":
			return "local-ai-Darwin-x86_64", nil
		}
	case "linux":
		switch runtime.GOARCH {
		case "amd64":
			return "local-ai-Linux-x86_64", nil
		case "arm64":
			return "local-ai-Linux-aarch64", nil
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

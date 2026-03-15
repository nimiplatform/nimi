package engine

import (
	"context"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const managedNexaPackageSpec = "nexaai"

// nexaLookPath finds the Nexa binary in the system PATH.
func nexaLookPath() (string, error) {
	path, err := exec.LookPath("nexa")
	if err != nil {
		return "", fmt.Errorf("nexa not found in PATH: %w (install via pip install nexaai or see https://docs.nexaai.com)", err)
	}
	return path, nil
}

func managedNexaBinary(root string) string {
	return filepath.Join(managedBinDir(root), executableName("nexa"))
}

func ensureManagedNexa(ctx context.Context, baseDir string, cfg EngineConfig) (EngineConfig, error) {
	root := engineVersionDir(baseDir, EngineNexa, cfg.Version)
	uvRoot := filepath.Join(baseDir, "uv")
	uvPath, err := ensureUV(ctx, uvRoot)
	if err != nil {
		return cfg, fmt.Errorf("ensure uv for nexa: %w", err)
	}
	pythonPath, err := ensureManagedPython(ctx, uvPath, root, defaultManagedPythonVersion)
	if err != nil {
		return cfg, fmt.Errorf("ensure managed python for nexa: %w", err)
	}
	binaryPath := managedNexaBinary(root)
	if _, err := os.Stat(binaryPath); err != nil {
		if installErr := uvPipInstall(ctx, uvPath, pythonPath, []string{managedNexaPackageSpec}); installErr != nil {
			return cfg, fmt.Errorf("install nexaai: %w", installErr)
		}
	}
	if _, err := os.Stat(binaryPath); err != nil {
		return cfg, fmt.Errorf("managed nexa binary missing at %s: %w", binaryPath, err)
	}
	cfg.BinaryPath = binaryPath
	cfg.WorkingDir = root
	return cfg, nil
}

// nexaCommand builds the exec.Cmd for starting Nexa serve.
func nexaCommand(cfg EngineConfig) *exec.Cmd {
	host := "127.0.0.1"
	if address := strings.TrimSpace(cfg.Address); address != "" && !containsScheme(address) {
		if parsedHost, _, err := net.SplitHostPort(address); err == nil && strings.TrimSpace(parsedHost) != "" {
			host = parsedHost
		}
	}
	args := []string{
		"serve",
		"--host", host,
		"--port", itoa(cfg.Port),
	}
	return exec.Command(cfg.BinaryPath, args...)
}

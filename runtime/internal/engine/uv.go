package engine

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const defaultManagedPythonVersion = "3.12"

func engineVersionDir(baseDir string, kind EngineKind, version string) string {
	normalizedVersion := strings.TrimSpace(version)
	if normalizedVersion == "" {
		normalizedVersion = "current"
	}
	return filepath.Join(baseDir, string(kind), normalizedVersion)
}

func executableName(base string) string {
	if currentGOOS() == "windows" {
		return base + ".exe"
	}
	return base
}

func managedBinDir(root string) string {
	if currentGOOS() == "windows" {
		return filepath.Join(root, "Scripts")
	}
	return filepath.Join(root, "bin")
}

func managedPythonPath(root string) string {
	return filepath.Join(managedBinDir(root), executableName("python"))
}

func managedUVPath(root string) string {
	return filepath.Join(root, executableName("uv"))
}

func runCommand(ctx context.Context, dir string, env map[string]string, bin string, args ...string) error {
	cmd := exec.CommandContext(ctx, bin, args...)
	if strings.TrimSpace(dir) != "" {
		cmd.Dir = dir
	}
	if len(env) > 0 {
		commandEnv := os.Environ()
		for key, value := range env {
			key = strings.TrimSpace(key)
			if key == "" {
				continue
			}
			commandEnv = append(commandEnv, key+"="+value)
		}
		cmd.Env = commandEnv
	}
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s %s failed: %w (%s)", bin, strings.Join(args, " "), err, strings.TrimSpace(string(output)))
	}
	return nil
}

func ensureUV(ctx context.Context, installDir string) (string, error) {
	_ = ctx
	if path, err := exec.LookPath("uv"); err == nil {
		return path, nil
	}
	if strings.TrimSpace(installDir) == "" {
		return "", fmt.Errorf("uv install directory is required")
	}
	if err := os.MkdirAll(installDir, 0o755); err != nil {
		return "", fmt.Errorf("create uv install directory: %w", err)
	}
	binaryPath := managedUVPath(installDir)
	if _, err := os.Stat(binaryPath); err == nil {
		return binaryPath, nil
	}
	return "", fmt.Errorf("uv is required but is not installed; install it via a verified local package manager and place it on PATH or at %s", binaryPath)
}

func ensureManagedPython(ctx context.Context, uvPath string, root string, version string) (string, error) {
	pythonVersion := strings.TrimSpace(version)
	if pythonVersion == "" {
		pythonVersion = defaultManagedPythonVersion
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return "", fmt.Errorf("create managed python root: %w", err)
	}
	pythonPath := managedPythonPath(root)
	if _, err := os.Stat(pythonPath); err == nil {
		return pythonPath, nil
	}
	if err := runCommand(ctx, root, nil, uvPath, "python", "install", pythonVersion); err != nil {
		return "", err
	}
	if err := runCommand(ctx, root, nil, uvPath, "venv", "--python", pythonVersion, root); err != nil {
		return "", err
	}
	if _, err := os.Stat(pythonPath); err != nil {
		return "", fmt.Errorf("managed python missing at %s: %w", pythonPath, err)
	}
	return pythonPath, nil
}

func uvPipInstall(ctx context.Context, uvPath string, pythonPath string, packages []string, extraArgs ...string) error {
	args := []string{"pip", "install", "--python", pythonPath}
	args = append(args, extraArgs...)
	args = append(args, packages...)
	return runCommand(ctx, "", nil, uvPath, args...)
}

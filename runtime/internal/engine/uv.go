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
	_, err := runCommandOutput(ctx, dir, env, bin, args...)
	return err
}

func runCommandOutput(ctx context.Context, dir string, env map[string]string, bin string, args ...string) (string, error) {
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
		return "", fmt.Errorf("%s %s failed: %w (%s)", bin, strings.Join(args, " "), err, strings.TrimSpace(string(output)))
	}
	return strings.TrimSpace(string(output)), nil
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
	return "", fmt.Errorf("python.tool.uv local environment dependency is not ready; confirm or repair the Runtime-managed uv dependency for managed executable %s", binaryPath)
}

func managedPythonInstallationDir(root string) string {
	parent := filepath.Dir(filepath.Clean(root))
	return filepath.Join(parent, "_python-installations")
}

func managedPythonRuntimeEnv(root string) map[string]string {
	parent := filepath.Dir(filepath.Clean(root))
	return map[string]string{
		"UV_NO_MODIFY_PATH":      "1",
		"UV_PYTHON_INSTALL_DIR":  managedPythonInstallationDir(root),
		"UV_CACHE_DIR":           filepath.Join(parent, "_uv-cache"),
		"UV_PYTHON_PREFERENCE":   "only-managed",
		"UV_LINK_MODE":           "copy",
		"UV_PROJECT_ENVIRONMENT": "",
	}
}

func ensureManagedPythonRuntime(ctx context.Context, uvPath string, root string, version string) (string, string, error) {
	pythonVersion := strings.TrimSpace(version)
	if pythonVersion == "" {
		pythonVersion = defaultManagedPythonVersion
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return "", "", fmt.Errorf("create managed python root: %w", err)
	}
	if err := os.MkdirAll(managedPythonInstallationDir(root), 0o755); err != nil {
		return "", "", fmt.Errorf("create managed python installation root: %w", err)
	}
	env := managedPythonRuntimeEnv(root)
	if err := runCommand(ctx, root, env, uvPath, "python", "install", "--managed-python", "--install-dir", managedPythonInstallationDir(root), pythonVersion); err != nil {
		return "", "", err
	}
	interpreterPath, err := runCommandOutput(ctx, root, env, uvPath, "python", "find", "--managed-python", pythonVersion)
	if err != nil {
		return "", "", err
	}
	interpreterPath = strings.TrimSpace(interpreterPath)
	if interpreterPath == "" {
		return "", "", fmt.Errorf("managed python runtime finder returned empty interpreter path")
	}
	versionOutput, err := runCommandOutput(ctx, "", env, interpreterPath, "--version")
	if err != nil {
		return "", "", fmt.Errorf("verify managed python runtime: %w", err)
	}
	if strings.TrimSpace(versionOutput) == "" {
		return "", "", fmt.Errorf("verify managed python runtime: empty version output")
	}
	return interpreterPath, strings.TrimSpace(versionOutput), nil
}

func ensureManagedPythonVenv(ctx context.Context, uvPath string, pythonRuntimePath string, root string) (string, error) {
	if strings.TrimSpace(pythonRuntimePath) == "" {
		return "", fmt.Errorf("managed python runtime path is required")
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return "", fmt.Errorf("create managed python venv root: %w", err)
	}
	pythonPath := managedPythonPath(root)
	if _, err := os.Stat(pythonPath); err == nil {
		return pythonPath, nil
	}
	if err := runCommand(ctx, root, managedPythonRuntimeEnv(root), uvPath, "venv", "--python", pythonRuntimePath, root); err != nil {
		return "", err
	}
	if _, err := os.Stat(pythonPath); err != nil {
		return "", fmt.Errorf("managed python venv missing at %s: %w", pythonPath, err)
	}
	return pythonPath, nil
}

func ensureManagedPython(ctx context.Context, uvPath string, root string, version string) (string, error) {
	interpreterPath, _, err := ensureManagedPythonRuntime(ctx, uvPath, root, version)
	if err != nil {
		return "", err
	}
	return ensureManagedPythonVenv(ctx, uvPath, interpreterPath, root)
}

func (m *Manager) EnsurePythonRuntimeDependency(ctx context.Context, uvPath string, engineName string, version string, pythonVersion string) (PythonRuntimeDependencyStatus, error) {
	kind, err := parseEngineKind(engineName)
	if err != nil {
		return PythonRuntimeDependencyStatus{}, err
	}
	switch kind {
	case EngineMedia, EngineSpeech:
	default:
		return PythonRuntimeDependencyStatus{}, fmt.Errorf("python runtime dependency is not admitted for engine %s", engineName)
	}
	root := engineVersionDir(m.baseDir, kind, version)
	interpreterPath, observedVersion, err := ensureManagedPythonRuntime(ctx, uvPath, root, pythonVersion)
	if err != nil {
		return PythonRuntimeDependencyStatus{}, err
	}
	return PythonRuntimeDependencyStatus{
		PythonVersion:   observedVersion,
		InterpreterPath: interpreterPath,
		RuntimeRoot:     root,
		UVExecutable:    strings.TrimSpace(uvPath),
		Detail:          "Runtime-managed Python runtime verified through selected uv tool",
	}, nil
}

func (m *Manager) EnsurePythonVenvDependency(ctx context.Context, uvPath string, pythonRuntimePath string, engineName string, version string) (PythonVenvDependencyStatus, error) {
	kind, err := parseEngineKind(engineName)
	if err != nil {
		return PythonVenvDependencyStatus{}, err
	}
	switch kind {
	case EngineMedia, EngineSpeech:
	default:
		return PythonVenvDependencyStatus{}, fmt.Errorf("python venv dependency is not admitted for engine %s", engineName)
	}
	root := engineVersionDir(m.baseDir, kind, version)
	interpreterPath, err := ensureManagedPythonVenv(ctx, uvPath, pythonRuntimePath, root)
	if err != nil {
		return PythonVenvDependencyStatus{}, err
	}
	versionOutput, err := runCommandOutput(ctx, "", managedPythonRuntimeEnv(root), interpreterPath, "--version")
	if err != nil {
		return PythonVenvDependencyStatus{}, fmt.Errorf("verify managed python venv: %w", err)
	}
	if strings.TrimSpace(versionOutput) == "" {
		return PythonVenvDependencyStatus{}, fmt.Errorf("verify managed python venv: empty version output")
	}
	return PythonVenvDependencyStatus{
		VenvRoot:        root,
		InterpreterPath: interpreterPath,
		PythonRuntime:   strings.TrimSpace(pythonRuntimePath),
		UVExecutable:    strings.TrimSpace(uvPath),
		Detail:          "Runtime-managed Python venv verified through selected uv tool and Python runtime",
	}, nil
}

func uvPipInstall(ctx context.Context, uvPath string, pythonPath string, packages []string, extraArgs ...string) error {
	args := []string{"pip", "install", "--python", pythonPath}
	args = append(args, extraArgs...)
	args = append(args, packages...)
	return runCommand(ctx, "", nil, uvPath, args...)
}

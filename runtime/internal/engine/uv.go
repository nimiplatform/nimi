package engine

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const defaultManagedPythonVersion = "3.12"

var (
	managedPythonCommandTimeout        = 2 * time.Minute
	managedPythonInstallCommandTimeout = 30 * time.Minute
	managedPythonPipCommandTimeout     = 45 * time.Minute
)

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
	commandCtx, cancel := contextWithManagedCommandTimeout(ctx, managedCommandTimeout(args))
	defer cancel()
	commandExecutable := managedCommandExecutablePath(bin)
	commandArguments := managedCommandArguments(args)
	cmd := exec.CommandContext(commandCtx, commandExecutable, commandArguments...)
	configureManagedCommand(cmd)
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
		if commandCtx.Err() != nil {
			return "", fmt.Errorf("%s %s timed out: %w", bin, strings.Join(args, " "), commandCtx.Err())
		}
		return "", fmt.Errorf("%s %s failed: %w (%s)", bin, strings.Join(args, " "), err, strings.TrimSpace(string(output)))
	}
	return strings.TrimSpace(string(output)), nil
}

func contextWithManagedCommandTimeout(ctx context.Context, timeout time.Duration) (context.Context, context.CancelFunc) {
	if ctx == nil {
		ctx = context.Background()
	}
	if timeout <= 0 {
		return context.WithCancel(ctx)
	}
	if _, ok := ctx.Deadline(); ok {
		return context.WithCancel(ctx)
	}
	return context.WithTimeout(ctx, timeout)
}

func managedCommandTimeout(args []string) time.Duration {
	if len(args) >= 2 && args[0] == "python" && args[1] == "install" {
		return managedPythonInstallCommandTimeout
	}
	if len(args) >= 2 && args[0] == "pip" && args[1] == "install" {
		return managedPythonPipCommandTimeout
	}
	return managedPythonCommandTimeout
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
	find := func() (string, error) {
		return runCommandOutput(ctx, root, env, uvPath, "python", "find", pythonVersion)
	}
	verify := func(interpreterPath string) (string, error) {
		return runCommandOutput(ctx, "", env, interpreterPath, "--version")
	}
	if interpreterPath, found, err := discoverManagedPythonRuntime(root, pythonVersion); err != nil {
		return "", "", err
	} else if found {
		return verifyManagedPythonRuntime(interpreterPath, pythonVersion, verify)
	}
	install := func() error {
		// Managed-only Python preference is carried by UV_PYTHON_PREFERENCE in
		// env; the --managed-python CLI flag is its alias and uv rejects both.
		return runCommand(ctx, root, env, uvPath, "python", "install", "--install-dir", managedPythonInstallationDir(root), pythonVersion)
	}
	return ensureManagedPythonRuntimeWithCommands(pythonVersion, find, verify, install)
}

func ensureManagedPythonRuntimeWithCommands(
	pythonVersion string,
	find func() (string, error),
	verify func(string) (string, error),
	install func() error,
) (string, string, error) {
	interpreterPath, findErr := find()
	if findErr == nil {
		return verifyManagedPythonRuntime(interpreterPath, pythonVersion, verify)
	}
	if !isManagedPythonRuntimeMissing(findErr) {
		return "", "", fmt.Errorf("find managed python runtime: %w", findErr)
	}
	if err := install(); err != nil {
		return "", "", err
	}
	interpreterPath, err := find()
	if err != nil {
		return "", "", err
	}
	return verifyManagedPythonRuntime(interpreterPath, pythonVersion, verify)
}

func verifyManagedPythonRuntime(
	interpreterPath string,
	pythonVersion string,
	verify func(string) (string, error),
) (string, string, error) {
	interpreterPath = strings.TrimSpace(interpreterPath)
	if interpreterPath == "" {
		return "", "", fmt.Errorf("managed python runtime finder returned empty interpreter path")
	}
	versionOutput, err := verify(interpreterPath)
	if err != nil {
		return "", "", fmt.Errorf("verify managed python runtime: %w", err)
	}
	versionOutput = strings.TrimSpace(versionOutput)
	if versionOutput == "" {
		return "", "", fmt.Errorf("verify managed python runtime: empty version output")
	}
	expectedVersion := "Python " + strings.TrimSpace(pythonVersion)
	if expectedVersion != "Python " && versionOutput != expectedVersion && !strings.HasPrefix(versionOutput, expectedVersion+".") {
		return "", "", fmt.Errorf("verify managed python runtime: version %q does not match %q", versionOutput, expectedVersion)
	}
	return interpreterPath, versionOutput, nil
}

func discoverManagedPythonRuntime(root string, pythonVersion string) (string, bool, error) {
	versionParts := strings.Split(strings.TrimSpace(pythonVersion), ".")
	if len(versionParts) < 2 || versionParts[0] == "" || versionParts[1] == "" {
		return "", false, fmt.Errorf("managed python runtime requires a major.minor version, got %q", pythonVersion)
	}
	installationRoot := managedPythonInstallationDir(root)
	candidates, err := filepath.Glob(filepath.Join(
		installationRoot,
		"cpython-"+versionParts[0]+"."+versionParts[1]+".*",
	))
	if err != nil {
		return "", false, fmt.Errorf("discover managed python runtime: %w", err)
	}
	if len(candidates) == 0 {
		return "", false, nil
	}
	sort.Sort(sort.Reverse(sort.StringSlice(candidates)))
	var rejected []string
	for _, candidate := range candidates {
		interpreterPath := filepath.Join(candidate, executableName("python"))
		requiredPaths := []string{interpreterPath}
		if currentGOOS() == "windows" {
			requiredPaths = append(requiredPaths,
				filepath.Join(candidate, "python3.dll"),
				filepath.Join(candidate, "python"+versionParts[0]+versionParts[1]+".dll"),
			)
		}
		missing := ""
		for _, requiredPath := range requiredPaths {
			info, statErr := os.Stat(requiredPath)
			if statErr != nil || info.IsDir() {
				missing = requiredPath
				break
			}
		}
		if missing == "" {
			return interpreterPath, true, nil
		}
		rejected = append(rejected, missing)
	}
	return "", false, fmt.Errorf(
		"managed python payload under %s is incomplete; required files missing: %s",
		installationRoot,
		strings.Join(rejected, ", "),
	)
}

func isManagedPythonRuntimeMissing(err error) bool {
	if err == nil {
		return false
	}
	detail := strings.ToLower(err.Error())
	return strings.Contains(detail, "no interpreter found") ||
		strings.Contains(detail, "no managed python installation found") ||
		strings.Contains(detail, "managed python missing")
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
	trimmedEngine := strings.TrimSpace(engineName)
	trimmedVersion := strings.TrimSpace(version)
	if trimmedVersion == "" {
		trimmedVersion = strings.TrimSpace(pythonVersion)
	}
	kind := EngineKind("python")
	if trimmedEngine != "" && trimmedEngine != "python" {
		parsedKind, err := parseEngineKind(trimmedEngine)
		if err != nil {
			return PythonRuntimeDependencyStatus{}, err
		}
		switch parsedKind {
		case EngineMedia, EngineSpeech:
			kind = parsedKind
		default:
			return PythonRuntimeDependencyStatus{}, fmt.Errorf("python runtime dependency is not admitted for engine %s", engineName)
		}
	}
	root := engineVersionDir(m.baseDir, kind, trimmedVersion)
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

func uvPipInstall(ctx context.Context, uvPath string, venvRoot string, pythonPath string, packages []string, extraArgs ...string) error {
	if !pythonPackageSetHasPackages(packages) {
		return fmt.Errorf("uv pip install requires at least one declared package")
	}
	trimmedVenvRoot := strings.TrimSpace(venvRoot)
	if trimmedVenvRoot == "" {
		return fmt.Errorf("uv pip install requires a managed venv root")
	}
	args := []string{"pip", "install", "--python", pythonPath}
	args = append(args, extraArgs...)
	args = append(args, packages...)
	return runCommand(ctx, trimmedVenvRoot, managedPythonRuntimeEnv(trimmedVenvRoot), uvPath, args...)
}

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

const defaultManagedPythonVersion = ManagedPythonVersion

const (
	managedPythonHomeEnvironmentKey = "PYTHONHOME"
	managedPythonPathEnvironmentKey = "PYTHONPATH"
)

var (
	managedPythonCommandTimeout        = 2 * time.Minute
	managedPythonInstallCommandTimeout = 2 * time.Minute
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

func managedPythonLaunchPath(root string) string {
	return managedCommandPreferredPath(managedPythonPath(root))
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
	if err := prepareManagedCommandEnvironment(env); err != nil {
		return "", err
	}
	commandExecutable := managedCommandExecutablePath(bin)
	commandArguments := managedCommandArguments(args)
	cmd := exec.CommandContext(commandCtx, commandExecutable, commandArguments...)
	configureManagedCommand(cmd)
	if strings.TrimSpace(dir) != "" {
		cmd.Dir = dir
	}
	cmd.Env = managedCommandProcessEnvironment(os.Environ(), env)
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

func managedPythonInstallationDir(root string) string {
	parent := filepath.Dir(filepath.Clean(root))
	return filepath.Join(parent, "_python-installations")
}

func managedPythonInterpreterPath(installationRoot string) string {
	if currentGOOS() == "windows" {
		return filepath.Join(installationRoot, executableName("python"))
	}
	return filepath.Join(installationRoot, "bin", executableName("python"))
}

func managedPythonTempDir(root string) string {
	parent := filepath.Dir(filepath.Clean(root))
	return filepath.Join(parent, "_tmp")
}

func managedPythonRuntimeEnv(root string) map[string]string {
	parent := filepath.Dir(filepath.Clean(root))
	tempDir := managedPythonTempDir(root)
	env := map[string]string{
		"TMP":                    tempDir,
		"TEMP":                   tempDir,
		"TMPDIR":                 tempDir,
		"UV_NO_MODIFY_PATH":      "1",
		"UV_PYTHON_INSTALL_DIR":  managedPythonInstallationDir(root),
		"UV_CACHE_DIR":           filepath.Join(parent, "_uv-cache"),
		"UV_PYTHON_PREFERENCE":   "only-managed",
		"UV_LINK_MODE":           "copy",
		"UV_PROJECT_ENVIRONMENT": "",
	}
	if currentGOOS() == "windows" {
		// Windows SYSTEM processes use GetTempPath2, which ignores TMP/TEMP
		// and consults SystemTemp instead. Keep that process-only override on
		// the same Runtime-managed root as uv's documented temp variables.
		env["SystemTemp"] = tempDir
	}
	neutralizeAmbientPythonEnvironment(env)
	return env
}

func neutralizeAmbientPythonEnvironment(env map[string]string) {
	if env == nil {
		return
	}
	env[managedPythonHomeEnvironmentKey] = ""
	env[managedPythonPathEnvironmentKey] = ""
}

func managedCommandProcessEnvironment(base []string, overrides map[string]string) []string {
	env := make([]string, 0, len(base)+len(overrides))
	for _, entry := range base {
		key, _, ok := strings.Cut(entry, "=")
		if ok && isAmbientPythonEnvironmentKey(key) {
			continue
		}
		env = append(env, entry)
	}
	type environmentOverride struct {
		key   string
		value string
	}
	values := make([]environmentOverride, 0, len(overrides))
	for key, value := range overrides {
		key = strings.TrimSpace(key)
		if key == "" || isAmbientPythonEnvironmentKey(key) {
			continue
		}
		values = append(values, environmentOverride{key: key, value: value})
	}
	sort.Slice(values, func(left int, right int) bool {
		return values[left].key < values[right].key
	})
	for _, override := range values {
		env = append(env, override.key+"="+managedCommandEnvironmentValue(override.value))
	}
	return env
}

func isAmbientPythonEnvironmentKey(key string) bool {
	trimmedKey := strings.TrimSpace(key)
	return strings.EqualFold(trimmedKey, managedPythonHomeEnvironmentKey) ||
		strings.EqualFold(trimmedKey, managedPythonPathEnvironmentKey)
}

func managedCommandTempEnvironmentKeys() []string {
	keys := []string{"TMP", "TEMP", "TMPDIR"}
	if currentGOOS() == "windows" {
		keys = append(keys, "SystemTemp")
	}
	return keys
}

func prepareManagedCommandEnvironment(env map[string]string) error {
	tempKeys := managedCommandTempEnvironmentKeys()
	tempRoots := make([]string, 0, len(tempKeys))
	for _, key := range tempKeys {
		if value := strings.TrimSpace(env[key]); value != "" {
			tempRoots = append(tempRoots, filepath.Clean(value))
		}
	}
	if len(tempRoots) == 0 {
		return nil
	}
	canonicalRoot := tempRoots[0]
	if !filepath.IsAbs(canonicalRoot) {
		return fmt.Errorf("managed command temp root must be absolute: %s", canonicalRoot)
	}
	for _, candidate := range tempRoots[1:] {
		if candidate != canonicalRoot {
			return fmt.Errorf("managed command temp roots must resolve to one directory")
		}
	}
	if err := os.MkdirAll(canonicalRoot, 0o700); err != nil {
		return fmt.Errorf("create managed command temp root: %w", err)
	}
	return nil
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
	findInstalled := func() (string, error) {
		interpreterPath, found, err := discoverManagedPythonRuntime(root, pythonVersion)
		if err != nil {
			return "", err
		}
		if !found {
			return "", fmt.Errorf("managed python installation missing after uv install")
		}
		return interpreterPath, nil
	}
	return ensureManagedPythonRuntimeWithCommands(pythonVersion, find, verify, install, findInstalled)
}

func ensureManagedPythonRuntimeWithCommands(
	pythonVersion string,
	find func() (string, error),
	verify func(string) (string, error),
	install func() error,
	findInstalled func() (string, error),
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
	interpreterPath, err := findInstalled()
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
	versionPattern := versionParts[0] + "." + versionParts[1] + ".*"
	if len(versionParts) >= 3 && versionParts[2] != "" {
		versionPattern = versionParts[0] + "." + versionParts[1] + "." + versionParts[2] + "-*"
	}
	installationRoot := managedPythonInstallationDir(root)
	candidates, err := filepath.Glob(filepath.Join(
		installationRoot,
		"cpython-"+versionPattern,
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
		interpreterPath := managedPythonInterpreterPath(candidate)
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

func (m *Manager) EnsurePythonRuntimeDependency(ctx context.Context, uvPath string, engineName string, version string, pythonVersion string) (PythonRuntimeDependencyStatus, error) {
	// The managed interpreter is one consumer-independent Runtime source.
	// Dependency isolation begins at immutable Python profiles, never in
	// engine- or consumer-named interpreter roots.
	m.pythonRuntimeMu.Lock()
	defer m.pythonRuntimeMu.Unlock()

	trimmedEngine := strings.TrimSpace(engineName)
	if trimmedEngine != "" && trimmedEngine != "python" {
		return PythonRuntimeDependencyStatus{}, fmt.Errorf("python runtime dependency is not admitted for engine %s", engineName)
	}
	trimmedVersion := strings.TrimSpace(version)
	if trimmedVersion == "" {
		trimmedVersion = strings.TrimSpace(pythonVersion)
	}
	kind := EngineKind("python")
	root := engineVersionDir(m.baseDir, kind, trimmedVersion)
	interpreterPath, observedVersion, err := ensureManagedPythonRuntime(ctx, uvPath, root, pythonVersion)
	if err != nil {
		return PythonRuntimeDependencyStatus{}, err
	}
	if err := writeManagedPythonRuntimeManifest(root, interpreterPath, observedVersion); err != nil {
		return PythonRuntimeDependencyStatus{}, fmt.Errorf("write managed Python owner manifest: %w", err)
	}
	return PythonRuntimeDependencyStatus{
		PythonVersion:   observedVersion,
		InterpreterPath: interpreterPath,
		RuntimeRoot:     root,
		UVExecutable:    strings.TrimSpace(uvPath),
		Detail:          "Runtime-managed Python runtime verified through selected uv tool",
	}, nil
}

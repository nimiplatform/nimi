package engine

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	pythonDependencyProfileInputDir               = "_profile-input"
	pythonDependencyProfileMaterializationTimeout = 10 * time.Minute
)

// PythonDependencyProfileStatus is the verified projection of one immutable
// Runtime-owned dependency profile. Identity is computed from the complete
// product input; consumer remains only the selector used to resolve that input.
type PythonDependencyProfileStatus struct {
	Identity               PythonDependencyProfileIdentity
	ProfileRoot            string
	InterpreterPath        string
	PackageCacheRoot       string
	UVExecutable           string
	InstalledDistributions []string
	ImportProbes           []string
	DriverCommands         map[string]string
	DriverScripts          []string
	ObservedPythonVersion  string
	ObservedTorchVersion   string
	ObservedCUDAABI        string
	Reused                 bool
	Detail                 string
}

// PythonDependencyProfileVerificationError is a fail-closed proof that an
// existing immutable profile generation does not match its canonical identity.
// Callers must surface Mismatch and require an explicit repair/new generation;
// retrying the same unchanged generation cannot make it valid.
type PythonDependencyProfileVerificationError struct {
	ProfileDigest string
	ProfileRoot   string
	Mismatch      string
	Err           error
}

func (e *PythonDependencyProfileVerificationError) Error() string {
	if e == nil {
		return "python dependency profile verification failed"
	}
	return fmt.Sprintf(
		"python dependency profile verification failed: profile_digest=%s profile_root=%s mismatch=%s",
		strings.TrimSpace(e.ProfileDigest),
		strings.TrimSpace(e.ProfileRoot),
		strings.TrimSpace(e.Mismatch),
	)
}

func (e *PythonDependencyProfileVerificationError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

type pythonDependencyProfileVerificationCacheEntry struct {
	ProfileRoot      string
	GenerationDigest string
	Status           PythonDependencyProfileStatus
	Failure          *PythonDependencyProfileVerificationError
}

type pythonDependencyProfileCommandRunner func(
	ctx context.Context,
	dir string,
	env map[string]string,
	bin string,
	args ...string,
) (string, error)

type pythonDependencyProfileProbe struct {
	PythonVersion          string   `json:"python_version"`
	PythonCacheTag         string   `json:"python_cache_tag"`
	PythonSOABI            string   `json:"python_soabi"`
	PythonPlatform         string   `json:"python_platform"`
	PythonMachine          string   `json:"python_machine"`
	PythonPointerBits      int      `json:"python_pointer_bits"`
	TorchVersion           string   `json:"torch_version"`
	CUDAABI                string   `json:"cuda_abi"`
	Device                 string   `json:"device"`
	DeviceName             string   `json:"device_name"`
	Allocation             float64  `json:"allocation"`
	InstalledDistributions []string `json:"installed_distributions"`
}

// EnsurePythonDependencyProfile materializes one exact dependency profile in
// a sibling staging directory and atomically promotes it. An existing valid
// profile first takes a cheap metadata-generation proof; a cache miss performs
// one read-only exact verification. Any mismatch is cached as a typed,
// fail-closed result for that unchanged generation. Ensure never rebuilds or
// mutates an existing promoted identity root.
func (m *Manager) EnsurePythonDependencyProfile(
	ctx context.Context,
	uvPath string,
	pythonRuntimePath string,
	consumer string,
	platformTuple string,
	acceleratorPlane string,
) (PythonDependencyProfileStatus, error) {
	return m.ensurePythonDependencyProfile(
		ctx,
		uvPath,
		pythonRuntimePath,
		consumer,
		platformTuple,
		acceleratorPlane,
		runCommandOutput,
	)
}

func (m *Manager) ensurePythonDependencyProfile(
	ctx context.Context,
	uvPath string,
	pythonRuntimePath string,
	consumer string,
	platformTuple string,
	acceleratorPlane string,
	run pythonDependencyProfileCommandRunner,
) (PythonDependencyProfileStatus, error) {
	if m == nil || run == nil {
		return PythonDependencyProfileStatus{}, fmt.Errorf("python dependency profile materializer is unavailable")
	}
	trimmedConsumer := strings.TrimSpace(consumer)
	trimmedPlatform := strings.ToLower(strings.TrimSpace(platformTuple))
	trimmedPlane := strings.ToLower(strings.TrimSpace(acceleratorPlane))
	actualPlatform := currentGOOS() + "/" + currentGOARCH()
	if trimmedPlatform != actualPlatform {
		return PythonDependencyProfileStatus{}, fmt.Errorf(
			"python dependency profile platform %s does not match current host %s",
			trimmedPlatform,
			actualPlatform,
		)
	}
	identity, err := ResolvePythonDependencyProfileIdentity(trimmedConsumer, trimmedPlatform, trimmedPlane)
	if err != nil {
		return PythonDependencyProfileStatus{}, err
	}
	return m.ensureResolvedPythonDependencyProfile(ctx, uvPath, pythonRuntimePath, trimmedConsumer, identity, run)
}

func (m *Manager) ensureResolvedPythonDependencyProfile(
	ctx context.Context,
	uvPath string,
	pythonRuntimePath string,
	consumer string,
	identity PythonDependencyProfileIdentity,
	run pythonDependencyProfileCommandRunner,
) (PythonDependencyProfileStatus, error) {
	if m == nil || run == nil {
		return PythonDependencyProfileStatus{}, fmt.Errorf("python dependency profile materializer is unavailable")
	}
	trimmedConsumer := strings.TrimSpace(consumer)
	expectedIdentity, err := ResolvePythonDependencyProfileIdentity(trimmedConsumer, identity.PlatformTuple, identity.AcceleratorPlane)
	if err != nil {
		return PythonDependencyProfileStatus{}, err
	}
	if expectedIdentity != identity {
		return PythonDependencyProfileStatus{}, fmt.Errorf("python dependency profile identity does not match canonical inputs")
	}
	if err := m.validatePythonDependencyProfileTools(uvPath, pythonRuntimePath); err != nil {
		return PythonDependencyProfileStatus{}, err
	}

	profileCtx, profileCancel := context.WithTimeout(ctx, pythonDependencyProfileMaterializationTimeout)
	defer profileCancel()
	unlock, err := m.lockPythonDependencyProfile(profileCtx, identity.ProfileDigest)
	if err != nil {
		return PythonDependencyProfileStatus{}, err
	}
	defer unlock()

	profileRoot := filepath.Join(m.baseDir, "python-profiles", identity.ProfileDigest)
	cacheRoot := filepath.Join(m.depsDir, "python-package-cache")
	if info, statErr := os.Lstat(profileRoot); statErr == nil {
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return PythonDependencyProfileStatus{}, newPythonDependencyProfileVerificationError(
				identity,
				profileRoot,
				fmt.Errorf("promoted root must be a non-symlink directory"),
			)
		}
		generationDigest, generationErr := pythonDependencyProfileGenerationDigest(profileRoot)
		if generationErr != nil {
			return PythonDependencyProfileStatus{}, newPythonDependencyProfileVerificationError(identity, profileRoot, generationErr)
		}
		if cached, ok := m.cachedPythonDependencyProfileVerification(identity.ProfileDigest, profileRoot, generationDigest); ok {
			if cached.Failure != nil {
				return PythonDependencyProfileStatus{}, clonePythonDependencyProfileVerificationError(cached.Failure)
			}
			status := clonePythonDependencyProfileStatus(cached.Status)
			status.Reused = true
			status.Detail = "Runtime-managed immutable Python dependency profile reused from verified generation cache"
			return status, nil
		}

		status, verifyErr := verifyPythonDependencyProfile(profileCtx, run, profileRoot, cacheRoot, uvPath, trimmedConsumer, identity, true)
		if verifyErr != nil {
			if ctxErr := profileCtx.Err(); ctxErr != nil {
				return PythonDependencyProfileStatus{}, ctxErr
			}
			failure := newPythonDependencyProfileVerificationError(identity, profileRoot, verifyErr)
			if currentGeneration, stampErr := pythonDependencyProfileGenerationDigest(profileRoot); stampErr == nil {
				m.cachePythonDependencyProfileVerification(identity.ProfileDigest, pythonDependencyProfileVerificationCacheEntry{
					ProfileRoot: profileRoot, GenerationDigest: currentGeneration, Failure: failure,
				})
			}
			return PythonDependencyProfileStatus{}, clonePythonDependencyProfileVerificationError(failure)
		}
		currentGeneration, generationErr := pythonDependencyProfileGenerationDigest(profileRoot)
		if generationErr != nil {
			return PythonDependencyProfileStatus{}, newPythonDependencyProfileVerificationError(identity, profileRoot, generationErr)
		}
		m.cachePythonDependencyProfileVerification(identity.ProfileDigest, pythonDependencyProfileVerificationCacheEntry{
			ProfileRoot: profileRoot, GenerationDigest: currentGeneration, Status: status,
		})
		return status, nil
	} else if !errors.Is(statErr, os.ErrNotExist) {
		return PythonDependencyProfileStatus{}, fmt.Errorf("inspect python dependency profile root %s: %w", profileRoot, statErr)
	}

	status, err := m.materializePythonDependencyProfile(
		profileCtx,
		run,
		uvPath,
		pythonRuntimePath,
		trimmedConsumer,
		identity,
		profileRoot,
		cacheRoot,
	)
	if err != nil {
		return PythonDependencyProfileStatus{}, err
	}
	generationDigest, generationErr := pythonDependencyProfileGenerationDigest(profileRoot)
	if generationErr != nil {
		return PythonDependencyProfileStatus{}, newPythonDependencyProfileVerificationError(identity, profileRoot, generationErr)
	}
	m.cachePythonDependencyProfileVerification(identity.ProfileDigest, pythonDependencyProfileVerificationCacheEntry{
		ProfileRoot: profileRoot, GenerationDigest: generationDigest, Status: status,
	})
	return status, nil
}

func (m *Manager) validatePythonDependencyProfileTools(uvPath string, pythonRuntimePath string) error {
	trimmedUVPath := strings.TrimSpace(uvPath)
	expectedUVPath := managedUVPath(filepath.Join(m.depsDir, "uv"))
	if !sameManagedPath(trimmedUVPath, expectedUVPath) {
		return fmt.Errorf("python dependency profile requires Runtime-managed uv at %s", expectedUVPath)
	}
	trimmedRuntimePath := strings.TrimSpace(pythonRuntimePath)
	if trimmedRuntimePath == "" || !filepath.IsAbs(trimmedRuntimePath) || !managedPathWithin(m.baseDir, trimmedRuntimePath) {
		return fmt.Errorf("python dependency profile requires a Runtime-managed Python interpreter beneath %s", m.baseDir)
	}
	return nil
}

func (m *Manager) lockPythonDependencyProfile(ctx context.Context, profileDigest string) (func(), error) {
	m.pythonProfileMu.Lock()
	if m.pythonProfileLocks == nil {
		m.pythonProfileLocks = make(map[string]chan struct{})
	}
	profileLock := m.pythonProfileLocks[strings.TrimSpace(profileDigest)]
	if profileLock == nil {
		profileLock = make(chan struct{}, 1)
		profileLock <- struct{}{}
		m.pythonProfileLocks[strings.TrimSpace(profileDigest)] = profileLock
	}
	m.pythonProfileMu.Unlock()
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-profileLock:
		return func() { profileLock <- struct{}{} }, nil
	}
}

func (m *Manager) cachedPythonDependencyProfileVerification(profileDigest string, profileRoot string, generationDigest string) (pythonDependencyProfileVerificationCacheEntry, bool) {
	m.pythonProfileMu.Lock()
	defer m.pythonProfileMu.Unlock()
	cached, ok := m.pythonProfileVerifications[strings.TrimSpace(profileDigest)]
	if !ok || !sameManagedPath(cached.ProfileRoot, profileRoot) || cached.GenerationDigest != generationDigest {
		return pythonDependencyProfileVerificationCacheEntry{}, false
	}
	cached.Status = clonePythonDependencyProfileStatus(cached.Status)
	cached.Failure = clonePythonDependencyProfileVerificationError(cached.Failure)
	return cached, true
}

func (m *Manager) cachePythonDependencyProfileVerification(profileDigest string, entry pythonDependencyProfileVerificationCacheEntry) {
	m.pythonProfileMu.Lock()
	defer m.pythonProfileMu.Unlock()
	if m.pythonProfileVerifications == nil {
		m.pythonProfileVerifications = make(map[string]pythonDependencyProfileVerificationCacheEntry)
	}
	entry.Status = clonePythonDependencyProfileStatus(entry.Status)
	entry.Failure = clonePythonDependencyProfileVerificationError(entry.Failure)
	m.pythonProfileVerifications[strings.TrimSpace(profileDigest)] = entry
}

func pythonDependencyProfileGenerationDigest(profileRoot string) (string, error) {
	trimmedRoot := strings.TrimSpace(profileRoot)
	var facts strings.Builder
	err := filepath.Walk(trimmedRoot, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(trimmedRoot, path)
		if err != nil {
			return err
		}
		_, _ = fmt.Fprintf(
			&facts,
			"%s\x00%d\x00%d\x00%d\x00%d\n",
			filepath.ToSlash(relative),
			info.Mode(),
			info.Size(),
			info.ModTime().UnixNano(),
			info.Mode()&os.ModeSymlink,
		)
		return nil
	})
	if err != nil {
		return "", fmt.Errorf("capture python dependency profile generation metadata: %w", err)
	}
	return sha256Hex([]byte(facts.String())), nil
}

func clonePythonDependencyProfileStatus(status PythonDependencyProfileStatus) PythonDependencyProfileStatus {
	status.InstalledDistributions = append([]string(nil), status.InstalledDistributions...)
	status.ImportProbes = append([]string(nil), status.ImportProbes...)
	status.DriverScripts = append([]string(nil), status.DriverScripts...)
	if status.DriverCommands != nil {
		commands := make(map[string]string, len(status.DriverCommands))
		for key, value := range status.DriverCommands {
			commands[key] = value
		}
		status.DriverCommands = commands
	}
	return status
}

func clonePythonDependencyProfileVerificationError(value *PythonDependencyProfileVerificationError) *PythonDependencyProfileVerificationError {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}

func newPythonDependencyProfileVerificationError(identity PythonDependencyProfileIdentity, profileRoot string, err error) *PythonDependencyProfileVerificationError {
	mismatch := "verification mismatch"
	if err != nil && strings.TrimSpace(err.Error()) != "" {
		mismatch = strings.TrimSpace(err.Error())
	}
	return &PythonDependencyProfileVerificationError{
		ProfileDigest: strings.TrimSpace(identity.ProfileDigest),
		ProfileRoot:   strings.TrimSpace(profileRoot),
		Mismatch:      mismatch,
		Err:           err,
	}
}

func (m *Manager) materializePythonDependencyProfile(
	ctx context.Context,
	run pythonDependencyProfileCommandRunner,
	uvPath string,
	pythonRuntimePath string,
	consumer string,
	identity PythonDependencyProfileIdentity,
	profileRoot string,
	cacheRoot string,
) (PythonDependencyProfileStatus, error) {
	uvVersion, err := run(ctx, "", nil, uvPath, "--version")
	if err != nil {
		return PythonDependencyProfileStatus{}, fmt.Errorf("verify Runtime-managed uv: %w", err)
	}
	if err := verifyManagedUVVersion(uvVersion); err != nil {
		return PythonDependencyProfileStatus{}, err
	}
	pythonVersion, err := run(ctx, "", pythonDependencyProfileReadOnlyEnv(), pythonRuntimePath, "--version")
	if err != nil {
		return PythonDependencyProfileStatus{}, fmt.Errorf("verify Runtime-managed Python: %w", err)
	}
	if err := verifyExactPythonVersion(pythonVersion, identity.PythonVersion); err != nil {
		return PythonDependencyProfileStatus{}, err
	}

	profileParent := filepath.Dir(profileRoot)
	if currentGOOS() == "windows" && !strings.EqualFold(filepath.VolumeName(profileRoot), filepath.VolumeName(cacheRoot)) {
		return PythonDependencyProfileStatus{}, fmt.Errorf("Windows python dependency profile and package cache must share one volume for hardlink materialization")
	}
	if err := os.MkdirAll(profileParent, 0o755); err != nil {
		return PythonDependencyProfileStatus{}, fmt.Errorf("create python dependency profile root: %w", err)
	}
	if err := os.MkdirAll(cacheRoot, 0o755); err != nil {
		return PythonDependencyProfileStatus{}, fmt.Errorf("create python dependency package cache: %w", err)
	}
	stagingRoot, err := os.MkdirTemp(profileParent, "."+identity.ProfileDigest+".staging-")
	if err != nil {
		return PythonDependencyProfileStatus{}, fmt.Errorf("create python dependency profile staging root: %w", err)
	}
	defer func() { _ = os.RemoveAll(stagingRoot) }()
	tempRoot := stagingRoot + ".tmp"
	defer func() { _ = os.RemoveAll(tempRoot) }()
	projectRoot, err := os.MkdirTemp(profileParent, "."+identity.ProfileDigest+".project-")
	if err != nil {
		return PythonDependencyProfileStatus{}, fmt.Errorf("create python dependency profile project root: %w", err)
	}
	defer func() { _ = removePythonDependencyProfileTree(projectRoot) }()

	linkMode, err := pythonDependencyProfileLinkMode(identity.PlatformTuple)
	if err != nil {
		return PythonDependencyProfileStatus{}, err
	}
	materializeEnv := pythonDependencyProfileMaterializeEnv(stagingRoot, cacheRoot, tempRoot, linkMode)
	if _, err := run(
		ctx,
		profileParent,
		materializeEnv,
		uvPath,
		"venv",
		"--python", pythonRuntimePath,
		"--no-python-downloads",
		stagingRoot,
	); err != nil {
		return PythonDependencyProfileStatus{}, fmt.Errorf("create staged python dependency profile venv: %w", err)
	}
	if _, err := os.Stat(managedPythonPath(stagingRoot)); err != nil {
		return PythonDependencyProfileStatus{}, fmt.Errorf("staged python dependency profile interpreter missing at %s: %w", managedPythonPath(stagingRoot), err)
	}

	if err := writePythonDependencyProfileInputs(projectRoot, identity); err != nil {
		return PythonDependencyProfileStatus{}, err
	}
	lockArgs := []string{
		"lock", "--check", "--offline", "--no-python-downloads",
		"--python", pythonRuntimePath,
		"--project", projectRoot,
	}
	if _, err := run(ctx, projectRoot, materializeEnv, uvPath, lockArgs...); err != nil {
		return PythonDependencyProfileStatus{}, fmt.Errorf("verify frozen python dependency profile lock: %w", err)
	}

	syncArgs := []string{
		"sync", "--frozen", "--no-dev", "--no-install-project", "--no-python-downloads",
		"--python", managedPythonPath(stagingRoot),
		"--link-mode", linkMode,
		"--project", projectRoot,
	}
	syncCtx, cancel := contextWithManagedCommandTimeout(ctx, managedPythonPipCommandTimeout)
	if _, err := run(syncCtx, projectRoot, materializeEnv, uvPath, syncArgs...); err != nil {
		cancel()
		return PythonDependencyProfileStatus{}, fmt.Errorf("sync frozen python dependency profile: %w", err)
	}
	cancel()
	offlineSyncArgs := append(append([]string{}, syncArgs...), "--offline")
	offlineCtx, offlineCancel := contextWithManagedCommandTimeout(ctx, managedPythonPipCommandTimeout)
	if _, err := run(offlineCtx, projectRoot, materializeEnv, uvPath, offlineSyncArgs...); err != nil {
		offlineCancel()
		return PythonDependencyProfileStatus{}, fmt.Errorf("verify offline frozen python dependency profile sync: %w", err)
	}
	offlineCancel()

	if err := writePythonDependencyProfileInputs(filepath.Join(stagingRoot, pythonDependencyProfileInputDir), identity); err != nil {
		return PythonDependencyProfileStatus{}, err
	}
	if err := materializePythonPipelineServerScript(stagingRoot, consumer); err != nil {
		return PythonDependencyProfileStatus{}, err
	}
	if err := writePythonDependencyProfileManifest(stagingRoot, consumer, identity); err != nil {
		return PythonDependencyProfileStatus{}, err
	}
	if _, err := verifyPythonDependencyProfile(ctx, run, stagingRoot, cacheRoot, uvPath, consumer, identity, false); err != nil {
		return PythonDependencyProfileStatus{}, fmt.Errorf(
			"verify staged python dependency profile: %w",
			newPythonDependencyProfileVerificationError(identity, stagingRoot, err),
		)
	}
	if info, statErr := os.Lstat(profileRoot); statErr == nil {
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return PythonDependencyProfileStatus{}, fmt.Errorf("concurrent python dependency profile promotion produced an invalid root at %s", profileRoot)
		}
		status, verifyErr := verifyPythonDependencyProfile(ctx, run, profileRoot, cacheRoot, uvPath, consumer, identity, true)
		if verifyErr != nil {
			return PythonDependencyProfileStatus{}, newPythonDependencyProfileVerificationError(identity, profileRoot, verifyErr)
		}
		return status, nil
	} else if !errors.Is(statErr, os.ErrNotExist) {
		return PythonDependencyProfileStatus{}, fmt.Errorf("inspect python dependency profile promotion target %s: %w", profileRoot, statErr)
	}
	if err := os.Rename(stagingRoot, profileRoot); err != nil {
		if info, statErr := os.Lstat(profileRoot); statErr == nil && info.IsDir() && info.Mode()&os.ModeSymlink == 0 {
			status, verifyErr := verifyPythonDependencyProfile(ctx, run, profileRoot, cacheRoot, uvPath, consumer, identity, true)
			if verifyErr != nil {
				return PythonDependencyProfileStatus{}, newPythonDependencyProfileVerificationError(identity, profileRoot, verifyErr)
			}
			return status, nil
		}
		return PythonDependencyProfileStatus{}, fmt.Errorf("atomically promote python dependency profile %s: %w", identity.ProfileDigest, err)
	}
	status, err := verifyPythonDependencyProfile(ctx, run, profileRoot, cacheRoot, uvPath, consumer, identity, false)
	if err != nil {
		failure := newPythonDependencyProfileVerificationError(identity, profileRoot, err)
		if removeErr := os.RemoveAll(profileRoot); removeErr != nil {
			return PythonDependencyProfileStatus{}, fmt.Errorf("verify promoted python dependency profile: %v; remove failed candidate: %w", failure, removeErr)
		}
		return PythonDependencyProfileStatus{}, fmt.Errorf("verify promoted python dependency profile: %w", failure)
	}
	return status, nil
}

func removePythonDependencyProfileTree(root string) error {
	trimmedRoot := strings.TrimSpace(root)
	if trimmedRoot == "" {
		return nil
	}
	if err := os.RemoveAll(trimmedRoot); err == nil {
		return nil
	} else if currentGOOS() != "windows" {
		return err
	}
	if err := filepath.Walk(trimmedRoot, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return nil
		}
		mode := info.Mode().Perm()
		if info.IsDir() {
			mode |= 0o700
		} else {
			mode |= 0o600
		}
		return os.Chmod(path, mode)
	}); err != nil {
		return err
	}
	return os.RemoveAll(trimmedRoot)
}

func verifyPythonDependencyProfile(
	ctx context.Context,
	run pythonDependencyProfileCommandRunner,
	profileRoot string,
	cacheRoot string,
	uvPath string,
	consumer string,
	identity PythonDependencyProfileIdentity,
	reused bool,
) (PythonDependencyProfileStatus, error) {
	if err := VerifyPythonDependencyProfileStaticContent(profileRoot, consumer, identity); err != nil {
		return PythonDependencyProfileStatus{}, err
	}

	interpreterPath := managedPythonPath(profileRoot)
	if info, statErr := os.Stat(interpreterPath); statErr != nil || info.IsDir() {
		if statErr == nil {
			statErr = fmt.Errorf("path is a directory")
		}
		return PythonDependencyProfileStatus{}, fmt.Errorf("verify python dependency profile interpreter %s: %w", interpreterPath, statErr)
	}
	if reused {
		if err := verifyPythonDependencyProfileEnvironment(ctx, run, profileRoot, cacheRoot, uvPath, interpreterPath, identity); err != nil {
			return PythonDependencyProfileStatus{}, err
		}
	}
	readOnlyEnv := pythonDependencyProfileReadOnlyEnv()
	pythonVersion, err := run(ctx, profileRoot, readOnlyEnv, managedCommandPreferredPath(interpreterPath), "--version")
	if err != nil {
		return PythonDependencyProfileStatus{}, fmt.Errorf("verify python dependency profile interpreter: %w", err)
	}
	if err := verifyExactPythonVersion(pythonVersion, identity.PythonVersion); err != nil {
		return PythonDependencyProfileStatus{}, err
	}

	importProbes, err := pythonDependencyProfileImportProbes(consumer, identity)
	if err != nil {
		return PythonDependencyProfileStatus{}, err
	}
	for _, module := range importProbes {
		probeScript := fmt.Sprintf("import importlib; importlib.import_module(%q)", module)
		if _, err := run(ctx, profileRoot, readOnlyEnv, managedCommandPreferredPath(interpreterPath), "-c", probeScript); err != nil {
			return PythonDependencyProfileStatus{}, fmt.Errorf("verify python dependency profile import %s: %w", module, err)
		}
	}
	torchProbe, err := run(
		ctx,
		profileRoot,
		readOnlyEnv,
		managedCommandPreferredPath(interpreterPath),
		"-c",
		pythonDependencyProfileTorchProbeScript(identity.AcceleratorPlane),
	)
	if err != nil {
		return PythonDependencyProfileStatus{}, fmt.Errorf("verify python dependency profile Torch allocation: %w", err)
	}
	observed, err := parsePythonDependencyProfileProbe(torchProbe)
	if err != nil {
		return PythonDependencyProfileStatus{}, err
	}
	if err := verifyPythonDependencyProfileTorchProbe(observed, identity); err != nil {
		return PythonDependencyProfileStatus{}, err
	}
	if err := verifyPythonDependencyProfileInterpreterProbe(observed, identity); err != nil {
		return PythonDependencyProfileStatus{}, err
	}

	detail := "Runtime-managed immutable Python dependency profile materialized and verified"
	if reused {
		detail = "Runtime-managed immutable Python dependency profile reused after read-only verification"
	}
	return PythonDependencyProfileStatus{
		Identity:               identity,
		ProfileRoot:            profileRoot,
		InterpreterPath:        interpreterPath,
		PackageCacheRoot:       cacheRoot,
		UVExecutable:           strings.TrimSpace(uvPath),
		InstalledDistributions: append([]string{}, observed.InstalledDistributions...),
		ImportProbes:           append([]string{}, importProbes...),
		DriverCommands:         pythonDependencyProfileDriverCommands(profileRoot, consumer),
		DriverScripts:          pythonDependencyProfileDriverScripts(profileRoot, consumer),
		ObservedPythonVersion:  observed.PythonVersion,
		ObservedTorchVersion:   observed.TorchVersion,
		ObservedCUDAABI:        observed.CUDAABI,
		Reused:                 reused,
		Detail:                 detail,
	}, nil
}

// verifyPythonDependencyProfileEnvironment asks the pinned materializer to
// compare the promoted environment with the embedded exact lock. --check is
// read-only: drift enters the existing staged rebuild path instead of mutating
// the promoted profile in place.
func verifyPythonDependencyProfileEnvironment(
	ctx context.Context,
	run pythonDependencyProfileCommandRunner,
	profileRoot string,
	cacheRoot string,
	uvPath string,
	interpreterPath string,
	identity PythonDependencyProfileIdentity,
) error {
	linkMode, err := pythonDependencyProfileLinkMode(identity.PlatformTuple)
	if err != nil {
		return err
	}
	env := pythonDependencyProfileReadOnlyEnv()
	env["UV_CACHE_DIR"] = cacheRoot
	env["UV_LINK_MODE"] = linkMode
	env["UV_PROJECT_ENVIRONMENT"] = profileRoot
	env["UV_PYTHON_DOWNLOADS"] = "never"
	checkCtx, cancel := contextWithManagedCommandTimeout(ctx, managedPythonPipCommandTimeout)
	defer cancel()
	projectRoot, err := os.MkdirTemp(filepath.Dir(profileRoot), "."+identity.ProfileDigest+".check-")
	if err != nil {
		return fmt.Errorf("create python dependency profile check project: %w", err)
	}
	defer func() { _ = removePythonDependencyProfileTree(projectRoot) }()
	if err := writePythonDependencyProfileInputs(projectRoot, identity); err != nil {
		return err
	}
	if _, err := run(
		checkCtx,
		projectRoot,
		env,
		uvPath,
		"sync", "--check", "--frozen", "--offline", "--no-dev", "--no-install-project", "--no-python-downloads",
		"--python", interpreterPath,
		"--link-mode", linkMode,
		"--project", projectRoot,
	); err != nil {
		return fmt.Errorf("verify promoted python dependency profile against exact lock: %w", err)
	}
	return nil
}

// VerifyPythonDependencyProfileStaticContent verifies only immutable embedded
// profile inputs and Driver bytes. It never starts Python or invokes uv.
func VerifyPythonDependencyProfileStaticContent(profileRoot string, consumer string, identity PythonDependencyProfileIdentity) error {
	trimmedRoot := strings.TrimSpace(profileRoot)
	rootInfo, err := os.Lstat(trimmedRoot)
	if err != nil {
		return fmt.Errorf("inspect python dependency profile root %s: %w", trimmedRoot, err)
	}
	if !rootInfo.IsDir() || rootInfo.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("python dependency profile root must be a non-symlink directory: %s", trimmedRoot)
	}
	files, err := PythonDependencyProfileStaticFiles(consumer, identity)
	if err != nil {
		return err
	}
	for _, file := range files {
		path := filepath.Join(trimmedRoot, file.RelativePath)
		info, err := os.Lstat(path)
		if err != nil {
			return fmt.Errorf("inspect python dependency profile static file %s: %w", path, err)
		}
		if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("python dependency profile static file must be a regular non-symlink file: %s", path)
		}
		content, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("read python dependency profile static file %s: %w", path, err)
		}
		if !bytes.Equal(content, file.Content) {
			return fmt.Errorf(
				"python dependency profile static content drift at %s: expected_sha256=%s actual_sha256=%s expected_size=%d actual_size=%d",
				path,
				sha256Hex(file.Content),
				sha256Hex(content),
				len(file.Content),
				len(content),
			)
		}
	}
	return nil
}

func writePythonDependencyProfileInputs(projectRoot string, identity PythonDependencyProfileIdentity) error {
	if err := os.MkdirAll(projectRoot, 0o755); err != nil {
		return fmt.Errorf("create python dependency profile input root: %w", err)
	}
	for _, name := range []string{"pyproject.toml", "uv.lock"} {
		content, err := pythonDependencyProfileInput(identity.SourceLabel, name)
		if err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(projectRoot, name), content, 0o444); err != nil {
			return fmt.Errorf("write python dependency profile input %s: %w", name, err)
		}
	}
	return verifyPythonDependencyProfileInputs(projectRoot, identity)
}

func verifyPythonDependencyProfileInputs(projectRoot string, identity PythonDependencyProfileIdentity) error {
	for _, input := range []struct {
		name       string
		wantDigest string
	}{
		{name: "pyproject.toml", wantDigest: identity.ProjectInputDigest},
		{name: "uv.lock", wantDigest: identity.ExactLockDigest},
	} {
		path := filepath.Join(projectRoot, input.name)
		info, err := os.Lstat(path)
		if err != nil {
			return fmt.Errorf("inspect python dependency profile input %s: %w", path, err)
		}
		if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("python dependency profile input must be a regular non-symlink file: %s", path)
		}
		content, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("read python dependency profile input %s: %w", path, err)
		}
		actualDigest := sha256Hex(content)
		if !strings.EqualFold(actualDigest, input.wantDigest) {
			return fmt.Errorf(
				"python dependency profile input digest drift at %s: expected_sha256=%s actual_sha256=%s",
				path,
				strings.ToLower(strings.TrimSpace(input.wantDigest)),
				actualDigest,
			)
		}
		embedded, err := pythonDependencyProfileInput(identity.SourceLabel, input.name)
		if err != nil {
			return err
		}
		if !bytes.Equal(content, embedded) {
			return fmt.Errorf("python dependency profile input content drift at %s", path)
		}
	}
	return nil
}

func pythonDependencyProfileImportProbes(consumer string, identity PythonDependencyProfileIdentity) ([]string, error) {
	packageManifest, err := resolvePythonPackageSetManifest(consumer)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(consumer) == "speech.voxcpm.python" {
		switch {
		case strings.HasPrefix(identity.SourceLabel, "speech-voxcpm-standard-"):
			packageManifest.ImportProbes = append(packageManifest.ImportProbes, "voxcpm")
		case identity.SourceLabel == "speech-voxcpm-mlx-cpu":
			packageManifest.ImportProbes = append(packageManifest.ImportProbes, "mlx", "mlx_audio")
		default:
			return nil, fmt.Errorf("VoxCPM dependency profile backend is not admitted for source %s", identity.SourceLabel)
		}
	}
	torchManifest, err := resolvePythonTorchWheelManifest(strings.TrimSpace(consumer) + "." + strings.TrimSpace(identity.AcceleratorPlane))
	if err != nil {
		return nil, err
	}
	seen := make(map[string]struct{})
	for _, probe := range append(append([]string{}, packageManifest.ImportProbes...), torchManifest.ImportProbes...) {
		trimmed := strings.TrimSpace(probe)
		if trimmed != "" {
			seen[trimmed] = struct{}{}
		}
	}
	result := make([]string, 0, len(seen))
	for probe := range seen {
		result = append(result, probe)
	}
	sort.Strings(result)
	return result, nil
}

func verifyPythonDependencyProfileDriverBundle(root string, consumer string) error {
	trimmedConsumer := strings.TrimSpace(consumer)
	if strings.HasPrefix(trimmedConsumer, "speech.") {
		return verifySpeechPipelineScripts(root, trimmedConsumer)
	}
	if strings.HasPrefix(trimmedConsumer, "media.") || strings.HasPrefix(trimmedConsumer, "stable-diffusion.cpp.") {
		return verifyRegularEmbeddedFile(filepath.Join(root, "media_server.py"), []byte(mediaServerScript), "media pipeline script")
	}
	return fmt.Errorf("python dependency profile Driver bundle is not admitted for consumer %s", consumer)
}

func pythonDependencyProfileDriverCommands(root string, consumer string) map[string]string {
	if strings.HasPrefix(strings.TrimSpace(consumer), "speech.") {
		return speechDriverCommandsForConsumer(root, consumer)
	}
	return nil
}

func pythonDependencyProfileDriverScripts(root string, consumer string) []string {
	trimmedConsumer := strings.TrimSpace(consumer)
	if strings.HasPrefix(trimmedConsumer, "speech.") {
		return speechDriverScriptsForConsumer(root, trimmedConsumer)
	}
	if strings.HasPrefix(trimmedConsumer, "media.") || strings.HasPrefix(trimmedConsumer, "stable-diffusion.cpp.") {
		return []string{filepath.Join(strings.TrimSpace(root), "media_server.py")}
	}
	return nil
}

func verifyRegularEmbeddedFile(path string, want []byte, description string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return fmt.Errorf("inspect promoted %s %s: %w", description, path, err)
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("promoted %s must be a regular non-symlink file: %s", description, path)
	}
	contents, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read promoted %s %s: %w", description, path, err)
	}
	if !bytes.Equal(contents, want) {
		return fmt.Errorf("promoted %s content drift at %s", description, path)
	}
	return nil
}

func pythonDependencyProfileMaterializeEnv(profileRoot string, cacheRoot string, tempRoot string, linkMode string) map[string]string {
	env := managedPythonRuntimeEnv(profileRoot)
	for _, key := range managedCommandTempEnvironmentKeys() {
		env[key] = tempRoot
	}
	env["UV_CACHE_DIR"] = cacheRoot
	env["UV_LINK_MODE"] = linkMode
	env["UV_PROJECT_ENVIRONMENT"] = profileRoot
	env["UV_PYTHON_DOWNLOADS"] = "never"
	env["PYTHONDONTWRITEBYTECODE"] = "1"
	env["PYTHONNOUSERSITE"] = "1"
	return env
}

func pythonDependencyProfileReadOnlyEnv() map[string]string {
	return map[string]string{
		"PYTHONDONTWRITEBYTECODE": "1",
		"PYTHONNOUSERSITE":        "1",
		"HF_HUB_OFFLINE":          "1",
		"TRANSFORMERS_OFFLINE":    "1",
	}
}

func pythonDependencyProfileLinkMode(platformTuple string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(platformTuple)) {
	case "windows/amd64":
		return "hardlink", nil
	case "darwin/arm64", "linux/amd64":
		return "clone", nil
	default:
		return "", fmt.Errorf("python dependency profile has no admitted link mode for %s", platformTuple)
	}
}

func verifyManagedUVVersion(output string) error {
	fields := strings.Fields(strings.TrimSpace(output))
	if len(fields) < 2 || fields[0] != "uv" || fields[1] != ManagedUVVersion {
		return fmt.Errorf("Runtime-managed uv version %q does not match pinned %s", strings.TrimSpace(output), ManagedUVVersion)
	}
	return nil
}

func verifyExactPythonVersion(output string, expected string) error {
	want := "Python " + strings.TrimSpace(expected)
	for _, line := range strings.Split(strings.TrimSpace(output), "\n") {
		if strings.TrimSpace(line) == want {
			return nil
		}
	}
	return fmt.Errorf("python dependency profile interpreter version %q does not match exact %q", strings.TrimSpace(output), want)
}

func pythonDependencyProfileTorchProbeScript(acceleratorPlane string) string {
	return fmt.Sprintf(`import importlib.metadata as metadata
import json
import platform
import struct
import sys
import sysconfig
import torch

device = %q
if device == "cuda":
    assert torch.cuda.is_available(), "CUDA unavailable"
value = torch.ones(1, device=device)
distributions = []
for distribution in metadata.distributions():
    name = distribution.metadata.get("Name")
    version = distribution.version
    if name and version:
        distributions.append(f"{name}=={version}")
distributions.sort(key=str.casefold)
print(json.dumps({
    "python_version": platform.python_version(),
    "python_cache_tag": str(sys.implementation.cache_tag or ""),
    "python_soabi": str(sysconfig.get_config_var("SOABI") or ""),
    "python_platform": str(sys.platform),
    "python_machine": str(platform.machine()),
    "python_pointer_bits": struct.calcsize("P") * 8,
    "torch_version": str(torch.__version__),
    "cuda_abi": str(torch.version.cuda or "none"),
    "device": device,
    "device_name": torch.cuda.get_device_name(0) if device == "cuda" else "cpu",
    "allocation": float(value.item()),
    "installed_distributions": distributions,
}, sort_keys=True))`, strings.TrimSpace(acceleratorPlane))
}

func verifyPythonDependencyProfileInterpreterProbe(observed pythonDependencyProfileProbe, identity PythonDependencyProfileIdentity) error {
	if strings.TrimSpace(observed.PythonVersion) != strings.TrimSpace(identity.PythonVersion) {
		return fmt.Errorf("python dependency profile observed Python version %q does not match exact %s", observed.PythonVersion, identity.PythonVersion)
	}
	abiDigits := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(identity.PythonABI)), "cp")
	expectedCacheTag := "cpython-" + abiDigits
	if abiDigits == "" || strings.ToLower(strings.TrimSpace(observed.PythonCacheTag)) != expectedCacheTag {
		return fmt.Errorf("python dependency profile cache tag %q does not match ABI %s", observed.PythonCacheTag, identity.PythonABI)
	}
	if soabi := strings.ToLower(strings.TrimSpace(observed.PythonSOABI)); soabi != "" && !strings.Contains(soabi, expectedCacheTag) && !strings.Contains(soabi, strings.ToLower(identity.PythonABI)) {
		return fmt.Errorf("python dependency profile SOABI %q does not match ABI %s", observed.PythonSOABI, identity.PythonABI)
	}
	platform := strings.ToLower(strings.TrimSpace(observed.PythonPlatform))
	machine := strings.ToLower(strings.TrimSpace(observed.PythonMachine))
	if observed.PythonPointerBits != 64 {
		return fmt.Errorf("python dependency profile pointer width %d does not match admitted 64-bit platform %s", observed.PythonPointerBits, identity.PlatformTuple)
	}
	switch strings.ToLower(strings.TrimSpace(identity.PlatformTuple)) {
	case "windows/amd64":
		if platform != "win32" || (machine != "amd64" && machine != "x86_64") {
			return fmt.Errorf("python dependency profile observed platform %s/%s does not match windows/amd64", observed.PythonPlatform, observed.PythonMachine)
		}
	case "darwin/arm64":
		if platform != "darwin" || (machine != "arm64" && machine != "aarch64") {
			return fmt.Errorf("python dependency profile observed platform %s/%s does not match darwin/arm64", observed.PythonPlatform, observed.PythonMachine)
		}
	default:
		return fmt.Errorf("python dependency profile interpreter proof is not admitted for platform %s", identity.PlatformTuple)
	}
	return nil
}

func parsePythonDependencyProfileProbe(output string) (pythonDependencyProfileProbe, error) {
	lines := strings.Split(strings.TrimSpace(output), "\n")
	for index := len(lines) - 1; index >= 0; index-- {
		var probe pythonDependencyProfileProbe
		if err := json.Unmarshal([]byte(strings.TrimSpace(lines[index])), &probe); err == nil {
			sort.Strings(probe.InstalledDistributions)
			return probe, nil
		}
	}
	return pythonDependencyProfileProbe{}, fmt.Errorf("verify python dependency profile Torch allocation returned no JSON result")
}

func verifyPythonDependencyProfileTorchProbe(observed pythonDependencyProfileProbe, identity PythonDependencyProfileIdentity) error {
	baseVersion := strings.SplitN(strings.TrimSpace(observed.TorchVersion), "+", 2)[0]
	if baseVersion != strings.TrimSpace(identity.TorchVersion) {
		return fmt.Errorf("python dependency profile Torch version %q does not match exact %s", observed.TorchVersion, identity.TorchVersion)
	}
	if observed.Device != identity.AcceleratorPlane || observed.Allocation != 1 {
		return fmt.Errorf("python dependency profile Torch allocation did not execute on %s", identity.AcceleratorPlane)
	}
	if identity.AcceleratorPlane == "cuda" {
		if !strings.HasSuffix(strings.ToLower(observed.TorchVersion), "+"+strings.ToLower(identity.CUDAABI)) {
			return fmt.Errorf("python dependency profile Torch build %q does not match %s", observed.TorchVersion, identity.CUDAABI)
		}
		expectedRuntimeABI, err := torchRuntimeCUDAABI(identity.CUDAABI)
		if err != nil {
			return err
		}
		if strings.TrimSpace(observed.CUDAABI) != expectedRuntimeABI || strings.TrimSpace(observed.DeviceName) == "" {
			return fmt.Errorf("python dependency profile CUDA ABI %q does not match %s", observed.CUDAABI, expectedRuntimeABI)
		}
	} else if strings.TrimSpace(observed.CUDAABI) != "none" {
		return fmt.Errorf("python dependency profile CPU Torch unexpectedly exposes CUDA ABI %q", observed.CUDAABI)
	}
	if len(observed.InstalledDistributions) == 0 {
		return fmt.Errorf("python dependency profile installed distribution projection is empty")
	}
	return nil
}

func torchRuntimeCUDAABI(canonicalABI string) (string, error) {
	digits := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(canonicalABI)), "cu")
	if len(digits) != 3 {
		return "", fmt.Errorf("unsupported canonical CUDA ABI %q", canonicalABI)
	}
	return digits[:2] + "." + digits[2:], nil
}

func sameManagedPath(left string, right string) bool {
	left = filepath.Clean(strings.TrimSpace(left))
	right = filepath.Clean(strings.TrimSpace(right))
	if currentGOOS() == "windows" {
		return strings.EqualFold(left, right)
	}
	return left == right
}

func managedPathWithin(root string, candidate string) bool {
	relative, err := filepath.Rel(filepath.Clean(root), filepath.Clean(candidate))
	if err != nil || filepath.IsAbs(relative) {
		return false
	}
	return relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

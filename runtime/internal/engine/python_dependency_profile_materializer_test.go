package engine

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"
)

type pythonDependencyProfileTestCommand struct {
	Bin         string
	Args        []string
	Dir         string
	Env         map[string]string
	HasDeadline bool
}

type pythonDependencyProfileTestRunner struct {
	t                  *testing.T
	uvPath             string
	runtimePath        string
	commands           []pythonDependencyProfileTestCommand
	failTorchProbe     bool
	failProbeRoot      string
	failProbeCount     int
	failSyncCheckCount int
	torchVersion       string
}

func TestVerifyPythonDependencyProfileStaticContentRejectsLockAndDriverDrift(t *testing.T) {
	platform := currentGOOS() + "/" + currentGOARCH()
	identity, err := ResolvePythonDependencyProfileIdentity("speech.qwen3-tts.python", platform, "cpu")
	if err != nil {
		t.Skipf("current host has no admitted CPU dependency profile: %v", err)
	}

	for _, test := range []struct {
		name       string
		relative   string
		wantDetail string
	}{
		{name: "lock", relative: filepath.Join(pythonDependencyProfileInputDir, "uv.lock"), wantDetail: "static content drift"},
		{name: "driver", relative: "qwen3_tts_driver.py", wantDetail: "static content drift"},
	} {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			writePythonDependencyProfileStaticFilesForTest(t, root, "speech.qwen3-tts.python", identity)
			if err := VerifyPythonDependencyProfileStaticContent(root, "speech.qwen3-tts.python", identity); err != nil {
				t.Fatalf("verify canonical static content: %v", err)
			}
			driftPath := filepath.Join(root, test.relative)
			if err := os.Chmod(driftPath, 0o600); err != nil {
				t.Fatalf("make static file writable for drift test: %v", err)
			}
			if err := os.WriteFile(driftPath, []byte("drift"), 0o444); err != nil {
				t.Fatalf("write drifted static file: %v", err)
			}
			if err := VerifyPythonDependencyProfileStaticContent(root, "speech.qwen3-tts.python", identity); err == nil || !strings.Contains(err.Error(), test.wantDetail) {
				t.Fatalf("static drift verification error = %v", err)
			}
		})
	}
}

func TestPythonDependencyProfileLockHonorsCancelledWaiter(t *testing.T) {
	manager, _, _ := newPythonDependencyProfileTestManager(t)
	release, err := manager.lockPythonDependencyProfile(context.Background(), "shared-profile")
	if err != nil {
		t.Fatalf("acquire first dependency-profile lock: %v", err)
	}
	defer release()

	waitCtx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := manager.lockPythonDependencyProfile(waitCtx, "shared-profile"); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled dependency-profile lock wait error = %v, want context.Canceled", err)
	}
}

func writePythonDependencyProfileStaticFilesForTest(t *testing.T, root string, consumer string, identity PythonDependencyProfileIdentity) {
	t.Helper()
	files, err := PythonDependencyProfileStaticFiles(consumer, identity)
	if err != nil {
		t.Fatalf("resolve canonical dependency-profile static files: %v", err)
	}
	for _, file := range files {
		path := filepath.Join(root, file.RelativePath)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatalf("create dependency-profile static file parent: %v", err)
		}
		if err := os.WriteFile(path, file.Content, 0o444); err != nil {
			t.Fatalf("write dependency-profile static file: %v", err)
		}
	}
}

func (runner *pythonDependencyProfileTestRunner) run(
	ctx context.Context,
	dir string,
	env map[string]string,
	bin string,
	args ...string,
) (string, error) {
	runner.t.Helper()
	envCopy := make(map[string]string, len(env))
	for key, value := range env {
		envCopy[key] = value
	}
	runner.commands = append(runner.commands, pythonDependencyProfileTestCommand{
		Bin:         bin,
		Args:        append([]string{}, args...),
		Dir:         dir,
		Env:         envCopy,
		HasDeadline: func() bool { _, ok := ctx.Deadline(); return ok }(),
	})
	if sameManagedPath(bin, runner.uvPath) {
		if len(args) == 1 && args[0] == "--version" {
			return "uv " + ManagedUVVersion + " (test)", nil
		}
		if len(args) > 0 && args[0] == "venv" {
			root := args[len(args)-1]
			if err := os.MkdirAll(filepath.Dir(managedPythonPath(root)), 0o755); err != nil {
				return "", err
			}
			if err := os.WriteFile(managedPythonPath(root), []byte("test interpreter"), 0o755); err != nil {
				return "", err
			}
			return "", nil
		}
		if len(args) > 1 && args[0] == "sync" && args[1] == "--check" && runner.failSyncCheckCount != 0 {
			if runner.failSyncCheckCount > 0 {
				runner.failSyncCheckCount--
			}
			return "", errors.New("test environment is not synchronized with exact lock")
		}
		if len(args) > 0 && args[0] == "sync" && managedPathWithin(env["UV_PROJECT_ENVIRONMENT"], dir) {
			return "", errors.New("test sync project must remain outside the target environment")
		}
		if len(args) > 0 && (args[0] == "lock" || args[0] == "sync") {
			return "", nil
		}
		return "", fmt.Errorf("unexpected uv command: %v", args)
	}
	if sameManagedPath(bin, runner.runtimePath) && len(args) == 1 && args[0] == "--version" {
		return "Python " + ManagedPythonVersion, nil
	}
	if len(args) == 1 && args[0] == "--version" {
		return "Python " + ManagedPythonVersion, nil
	}
	if len(args) == 2 && args[0] == "-c" {
		if strings.Contains(args[1], "importlib.import_module") {
			return "", nil
		}
		if strings.Contains(args[1], "installed_distributions") {
			failAtRoot := strings.TrimSpace(runner.failProbeRoot) != "" &&
				(managedPathWithin(runner.failProbeRoot, dir) || managedPathWithin(runner.failProbeRoot, bin)) &&
				runner.failProbeCount != 0
			if failAtRoot && runner.failProbeCount > 0 {
				runner.failProbeCount--
			}
			if runner.failTorchProbe || failAtRoot {
				return "", errors.New("test Torch allocation failure")
			}
			torchVersion := strings.TrimSpace(runner.torchVersion)
			if torchVersion == "" {
				torchVersion = "2.11.0+cpu"
			}
			pythonPlatform := "win32"
			pythonMachine := "AMD64"
			if currentGOOS() == "darwin" {
				pythonPlatform = "darwin"
				pythonMachine = "arm64"
			}
			return fmt.Sprintf(`{"allocation":1,"cuda_abi":"none","device":"cpu","device_name":"cpu","installed_distributions":["fastapi==0.121.1","torch==%s"],"python_cache_tag":"cpython-312","python_machine":"%s","python_platform":"%s","python_pointer_bits":64,"python_soabi":"","python_version":"%s","torch_version":"%s"}`, torchVersion, pythonMachine, pythonPlatform, ManagedPythonVersion, torchVersion), nil
		}
	}
	return "", fmt.Errorf("unexpected profile command: %s %v", bin, args)
}

func TestVerifyPythonDependencyProfileInterpreterProbeRejectsIdentityDrift(t *testing.T) {
	identity, err := ResolvePythonDependencyProfileIdentity("speech.qwen3-tts.python", currentGOOS()+"/"+currentGOARCH(), "cpu")
	if err != nil {
		t.Skipf("current host has no admitted CPU dependency profile: %v", err)
	}
	valid := pythonDependencyProfileProbe{
		PythonVersion:     ManagedPythonVersion,
		PythonCacheTag:    "cpython-312",
		PythonPointerBits: 64,
	}
	if currentGOOS() == "windows" {
		valid.PythonPlatform = "win32"
		valid.PythonMachine = "AMD64"
	} else {
		valid.PythonPlatform = "darwin"
		valid.PythonMachine = "arm64"
	}
	if err := verifyPythonDependencyProfileInterpreterProbe(valid, identity); err != nil {
		t.Fatalf("valid interpreter proof rejected: %v", err)
	}
	for name, mutate := range map[string]func(*pythonDependencyProfileProbe){
		"version":  func(probe *pythonDependencyProfileProbe) { probe.PythonVersion = "3.12.14" },
		"abi":      func(probe *pythonDependencyProfileProbe) { probe.PythonCacheTag = "cpython-313" },
		"platform": func(probe *pythonDependencyProfileProbe) { probe.PythonPlatform = "linux" },
		"bits":     func(probe *pythonDependencyProfileProbe) { probe.PythonPointerBits = 32 },
	} {
		t.Run(name, func(t *testing.T) {
			observed := valid
			mutate(&observed)
			if err := verifyPythonDependencyProfileInterpreterProbe(observed, identity); err == nil {
				t.Fatalf("drifted interpreter proof passed: %+v", observed)
			}
		})
	}
}

func TestEnsurePythonDependencyProfileReusesConsumerIndependentMediaProfile(t *testing.T) {
	platform := currentGOOS() + "/" + currentGOARCH()
	imageIdentity, err := ResolvePythonDependencyProfileIdentity("media.diffusers.cpu", platform, "cpu")
	if err != nil {
		t.Skipf("current host has no admitted CPU dependency profile: %v", err)
	}
	videoIdentity, err := ResolvePythonDependencyProfileIdentity("media.video-python.cpu", platform, "cpu")
	if err != nil {
		t.Fatal(err)
	}
	if imageIdentity.ProfileDigest != videoIdentity.ProfileDigest {
		t.Fatalf("media consumers with equal complete inputs do not share a profile: image=%s video=%s", imageIdentity.ProfileDigest, videoIdentity.ProfileDigest)
	}
	manager, uvPath, runtimePath := newPythonDependencyProfileTestManager(t)
	runner := &pythonDependencyProfileTestRunner{
		t:            t,
		uvPath:       uvPath,
		runtimePath:  runtimePath,
		torchVersion: "2.7.1+cpu",
	}
	imageStatus, err := manager.ensurePythonDependencyProfile(
		context.Background(), uvPath, runtimePath, "media.diffusers.cpu", platform, "cpu", runner.run,
	)
	if err != nil {
		t.Fatalf("materialize shared media profile: %v", err)
	}
	uvCalls := countPythonDependencyProfileCommands(runner.commands, uvPath)
	videoStatus, err := manager.ensurePythonDependencyProfile(
		context.Background(), uvPath, runtimePath, "media.video-python.cpu", platform, "cpu", runner.run,
	)
	if err != nil {
		t.Fatalf("reuse shared media profile: %v", err)
	}
	if !videoStatus.Reused || videoStatus.ProfileRoot != imageStatus.ProfileRoot {
		t.Fatalf("shared media profile reuse = %+v", videoStatus)
	}
	if got := countPythonDependencyProfileCommands(runner.commands, uvPath); got != uvCalls+1 {
		t.Fatalf("second media consumer exact-lock checks = %d, want %d", got, uvCalls+1)
	}
	if len(videoStatus.DriverScripts) != 1 || filepath.Base(videoStatus.DriverScripts[0]) != "media_server.py" {
		t.Fatalf("media Driver scripts = %v", videoStatus.DriverScripts)
	}
	if err := verifyRegularEmbeddedFile(videoStatus.DriverScripts[0], []byte(mediaServerScript), "media pipeline script"); err != nil {
		t.Fatal(err)
	}
}

func TestEnsurePythonDependencyProfileStagesPromotesAndReusesReadOnly(t *testing.T) {
	platform := currentGOOS() + "/" + currentGOARCH()
	identity, err := ResolvePythonDependencyProfileIdentity("speech.qwen3-tts.python", platform, "cpu")
	if err != nil {
		t.Skipf("current host has no admitted CPU dependency profile: %v", err)
	}
	manager, uvPath, runtimePath := newPythonDependencyProfileTestManager(t)
	runner := &pythonDependencyProfileTestRunner{t: t, uvPath: uvPath, runtimePath: runtimePath}

	status, err := manager.ensurePythonDependencyProfile(
		context.Background(),
		uvPath,
		runtimePath,
		"speech.qwen3-tts.python",
		platform,
		"cpu",
		runner.run,
	)
	if err != nil {
		t.Fatalf("materialize Python dependency profile: %v", err)
	}
	if status.Reused {
		t.Fatal("first materialization was reported as reused")
	}
	if status.Identity.ProfileDigest != identity.ProfileDigest {
		t.Fatalf("profile digest = %q, want %q", status.Identity.ProfileDigest, identity.ProfileDigest)
	}
	wantRoot := filepath.Join(manager.baseDir, "python-profiles", identity.ProfileDigest)
	if status.ProfileRoot != wantRoot || status.PackageCacheRoot != filepath.Join(manager.depsDir, "python-package-cache") {
		t.Fatalf("profile roots = (%q, %q), want (%q, shared cache)", status.ProfileRoot, status.PackageCacheRoot, wantRoot)
	}
	if status.ObservedTorchVersion != "2.11.0+cpu" || status.ObservedCUDAABI != "none" {
		t.Fatalf("observed Torch status = (%q, %q)", status.ObservedTorchVersion, status.ObservedCUDAABI)
	}
	if err := verifyPythonDependencyProfileInputs(filepath.Join(status.ProfileRoot, pythonDependencyProfileInputDir), identity); err != nil {
		t.Fatalf("verify promoted exact inputs: %v", err)
	}
	if err := verifySpeechPipelineScripts(status.ProfileRoot, "speech.qwen3-tts.python"); err != nil {
		t.Fatalf("verify promoted Driver bundle: %v", err)
	}
	assertPythonDependencyProfileUVCommands(t, runner.commands, uvPath, status.PackageCacheRoot, platform)
	for _, command := range runner.commands {
		if !command.HasDeadline {
			t.Fatalf("profile materialization command has no shared 10-minute deadline: %+v", command)
		}
	}
	if matches, globErr := filepath.Glob(filepath.Join(filepath.Dir(status.ProfileRoot), ".*.staging-*")); globErr != nil || len(matches) != 0 {
		t.Fatalf("staging roots after promotion = %v, err=%v", matches, globErr)
	}

	before := snapshotPythonDependencyProfileFiles(t, status.ProfileRoot)
	uvCallsBefore := countPythonDependencyProfileCommands(runner.commands, uvPath)
	runtimeCallsBefore := countPythonDependencyProfileCommands(runner.commands, runtimePath)
	reused, err := manager.ensurePythonDependencyProfile(
		context.Background(),
		uvPath,
		runtimePath,
		"speech.qwen3-tts.python",
		platform,
		"cpu",
		runner.run,
	)
	if err != nil {
		t.Fatalf("reuse Python dependency profile: %v", err)
	}
	if !reused.Reused || reused.ProfileRoot != status.ProfileRoot {
		t.Fatalf("reuse status = %+v", reused)
	}
	if got := countPythonDependencyProfileCommands(runner.commands, uvPath); got != uvCallsBefore+1 {
		t.Fatalf("profile reuse exact-lock checks = %d, want %d", got, uvCallsBefore+1)
	}
	if got := countPythonDependencyProfileCommands(runner.commands, runtimePath); got != runtimeCallsBefore {
		t.Fatalf("profile reuse invoked shared Python runtime: before=%d after=%d", runtimeCallsBefore, got)
	}
	after := snapshotPythonDependencyProfileFiles(t, status.ProfileRoot)
	if !reflect.DeepEqual(after, before) {
		t.Fatalf("profile reuse changed promoted files:\nbefore=%v\nafter=%v", before, after)
	}
}

func TestEnsurePythonDependencyProfileRebuildsWhenExactEnvironmentCheckFails(t *testing.T) {
	platform := currentGOOS() + "/" + currentGOARCH()
	manager, uvPath, runtimePath := newPythonDependencyProfileTestManager(t)
	runner := &pythonDependencyProfileTestRunner{t: t, uvPath: uvPath, runtimePath: runtimePath}

	status, err := manager.ensurePythonDependencyProfile(
		context.Background(), uvPath, runtimePath, "speech.qwen3-tts.python", platform, "cpu", runner.run,
	)
	if err != nil {
		t.Fatalf("materialize Python dependency profile: %v", err)
	}
	uvCallsBefore := countPythonDependencyProfileCommands(runner.commands, uvPath)
	runner.failSyncCheckCount = 1

	rebuilt, err := manager.ensurePythonDependencyProfile(
		context.Background(), uvPath, runtimePath, "speech.qwen3-tts.python", platform, "cpu", runner.run,
	)
	if err != nil {
		t.Fatalf("rebuild drifted Python dependency profile: %v", err)
	}
	if rebuilt.Reused || rebuilt.ProfileRoot != status.ProfileRoot {
		t.Fatalf("exact-lock drift rebuild status = %+v", rebuilt)
	}
	if got := countPythonDependencyProfileCommands(runner.commands, uvPath); got != uvCallsBefore+6 {
		t.Fatalf("exact-lock drift rebuild uv calls = %d, want %d", got, uvCallsBefore+6)
	}
	uvCommands := pythonDependencyProfileCommandsForBin(runner.commands, uvPath)
	checkCommand := uvCommands[uvCallsBefore]
	if got := strings.Join(checkCommand.Args, " "); !strings.Contains(got, "sync --check --frozen --offline") {
		t.Fatalf("exact environment check command = %q", got)
	}
	if checkCommand.Env["UV_PROJECT_ENVIRONMENT"] != status.ProfileRoot || checkCommand.Env["UV_CACHE_DIR"] != status.PackageCacheRoot {
		t.Fatalf("exact environment check roots = %+v", checkCommand.Env)
	}
}

func TestEnsurePythonDependencyProfileRebuildsDamagedPromotedProfile(t *testing.T) {
	platform := currentGOOS() + "/" + currentGOARCH()
	identity, err := ResolvePythonDependencyProfileIdentity("speech.qwen3-tts.python", platform, "cpu")
	if err != nil {
		t.Skipf("current host has no admitted CPU dependency profile: %v", err)
	}
	manager, uvPath, runtimePath := newPythonDependencyProfileTestManager(t)
	runner := &pythonDependencyProfileTestRunner{t: t, uvPath: uvPath, runtimePath: runtimePath}

	status, err := manager.ensurePythonDependencyProfile(
		context.Background(), uvPath, runtimePath, "speech.qwen3-tts.python", platform, "cpu", runner.run,
	)
	if err != nil {
		t.Fatalf("materialize Python dependency profile: %v", err)
	}
	driftPath := filepath.Join(status.ProfileRoot, "qwen3_tts_driver.py")
	if err := os.Chmod(driftPath, 0o600); err != nil {
		t.Fatalf("make promoted Driver writable: %v", err)
	}
	if err := os.WriteFile(driftPath, []byte("drift"), 0o444); err != nil {
		t.Fatalf("drift promoted Driver: %v", err)
	}
	if err := VerifyPythonDependencyProfileStaticContent(status.ProfileRoot, "speech.qwen3-tts.python", identity); err == nil {
		t.Fatal("damaged promoted profile passed static verification")
	}
	uvCallsBefore := countPythonDependencyProfileCommands(runner.commands, uvPath)

	rebuilt, err := manager.ensurePythonDependencyProfile(
		context.Background(), uvPath, runtimePath, "speech.qwen3-tts.python", platform, "cpu", runner.run,
	)
	if err != nil {
		t.Fatalf("rebuild damaged Python dependency profile: %v", err)
	}
	if rebuilt.Reused {
		t.Fatalf("rebuilt profile reported reuse: %+v", rebuilt)
	}
	if rebuilt.ProfileRoot != status.ProfileRoot {
		t.Fatalf("rebuilt profile root = %q, want stable identity root %q", rebuilt.ProfileRoot, status.ProfileRoot)
	}
	if err := VerifyPythonDependencyProfileStaticContent(rebuilt.ProfileRoot, "speech.qwen3-tts.python", identity); err != nil {
		t.Fatalf("verify rebuilt profile static content: %v", err)
	}
	if got := countPythonDependencyProfileCommands(runner.commands, uvPath); got != uvCallsBefore+5 {
		t.Fatalf("rebuild uv calls = %d, want %d", got, uvCallsBefore+5)
	}
}

func TestEnsurePythonDependencyProfileRebuildsAfterRuntimeVerificationFailure(t *testing.T) {
	platform := currentGOOS() + "/" + currentGOARCH()
	manager, uvPath, runtimePath := newPythonDependencyProfileTestManager(t)
	runner := &pythonDependencyProfileTestRunner{t: t, uvPath: uvPath, runtimePath: runtimePath}

	status, err := manager.ensurePythonDependencyProfile(
		context.Background(), uvPath, runtimePath, "speech.qwen3-tts.python", platform, "cpu", runner.run,
	)
	if err != nil {
		t.Fatalf("materialize Python dependency profile: %v", err)
	}
	uvCallsBefore := countPythonDependencyProfileCommands(runner.commands, uvPath)
	runner.failProbeRoot = status.ProfileRoot
	runner.failProbeCount = 1

	rebuilt, err := manager.ensurePythonDependencyProfile(
		context.Background(), uvPath, runtimePath, "speech.qwen3-tts.python", platform, "cpu", runner.run,
	)
	if err != nil {
		t.Fatalf("rebuild after promoted runtime verification failure: %v", err)
	}
	if rebuilt.Reused {
		t.Fatalf("runtime-rebuilt profile reported reuse: %+v", rebuilt)
	}
	if got := countPythonDependencyProfileCommands(runner.commands, uvPath); got != uvCallsBefore+6 {
		t.Fatalf("runtime rebuild uv calls = %d, want %d", got, uvCallsBefore+6)
	}
}

func TestEnsurePythonDependencyProfileRestoresPreviousRootWhenReplacementVerificationFails(t *testing.T) {
	platform := currentGOOS() + "/" + currentGOARCH()
	identity, err := ResolvePythonDependencyProfileIdentity("speech.qwen3-tts.python", platform, "cpu")
	if err != nil {
		t.Skipf("current host has no admitted CPU dependency profile: %v", err)
	}
	manager, uvPath, runtimePath := newPythonDependencyProfileTestManager(t)
	runner := &pythonDependencyProfileTestRunner{t: t, uvPath: uvPath, runtimePath: runtimePath}

	status, err := manager.ensurePythonDependencyProfile(
		context.Background(), uvPath, runtimePath, "speech.qwen3-tts.python", platform, "cpu", runner.run,
	)
	if err != nil {
		t.Fatalf("materialize Python dependency profile: %v", err)
	}
	driftPath := filepath.Join(status.ProfileRoot, pythonDependencyProfileInputDir, "uv.lock")
	if err := os.Chmod(driftPath, 0o600); err != nil {
		t.Fatalf("make promoted lock writable: %v", err)
	}
	if err := os.WriteFile(driftPath, []byte("drift"), 0o444); err != nil {
		t.Fatalf("drift promoted lock: %v", err)
	}
	previous := snapshotPythonDependencyProfileFiles(t, status.ProfileRoot)
	runner.failProbeRoot = status.ProfileRoot
	runner.failProbeCount = -1

	_, err = manager.ensurePythonDependencyProfile(
		context.Background(), uvPath, runtimePath, "speech.qwen3-tts.python", platform, "cpu", runner.run,
	)
	if err == nil || !strings.Contains(err.Error(), "test Torch allocation failure") {
		t.Fatalf("replacement verification error = %v, want Torch probe failure", err)
	}
	after := snapshotPythonDependencyProfileFiles(t, status.ProfileRoot)
	if !reflect.DeepEqual(after, previous) {
		t.Fatalf("failed replacement did not restore previous profile:\nprevious=%v\nafter=%v", previous, after)
	}
	if err := VerifyPythonDependencyProfileStaticContent(status.ProfileRoot, "speech.qwen3-tts.python", identity); err == nil {
		t.Fatal("failed replacement left rebuilt profile instead of restoring damaged previous root")
	}
	for _, pattern := range []string{
		filepath.Join(filepath.Dir(status.ProfileRoot), ".*.staging-*"),
		filepath.Join(filepath.Dir(status.ProfileRoot), ".*.previous"),
		filepath.Join(filepath.Dir(status.ProfileRoot), ".*.failed"),
	} {
		matches, globErr := filepath.Glob(pattern)
		if globErr != nil || len(matches) != 0 {
			t.Fatalf("replacement leftovers for %q = %v, err=%v", pattern, matches, globErr)
		}
	}
}

func TestEnsurePythonDependencyProfileDoesNotPromoteFailedProbe(t *testing.T) {
	platform := currentGOOS() + "/" + currentGOARCH()
	identity, err := ResolvePythonDependencyProfileIdentity("speech.qwen3-asr.python", platform, "cpu")
	if err != nil {
		t.Skipf("current host has no admitted CPU dependency profile: %v", err)
	}
	manager, uvPath, runtimePath := newPythonDependencyProfileTestManager(t)
	runner := &pythonDependencyProfileTestRunner{
		t:              t,
		uvPath:         uvPath,
		runtimePath:    runtimePath,
		failTorchProbe: true,
	}

	_, err = manager.ensurePythonDependencyProfile(
		context.Background(),
		uvPath,
		runtimePath,
		"speech.qwen3-asr.python",
		platform,
		"cpu",
		runner.run,
	)
	if err == nil || !strings.Contains(err.Error(), "test Torch allocation failure") {
		t.Fatalf("materialization error = %v, want Torch probe failure", err)
	}
	profileRoot := filepath.Join(manager.baseDir, "python-profiles", identity.ProfileDigest)
	if _, statErr := os.Lstat(profileRoot); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("failed candidate was promoted at %s: %v", profileRoot, statErr)
	}
	if matches, globErr := filepath.Glob(filepath.Join(filepath.Dir(profileRoot), ".*.staging-*")); globErr != nil || len(matches) != 0 {
		t.Fatalf("failed staging roots = %v, err=%v", matches, globErr)
	}
	if matches, globErr := filepath.Glob(filepath.Join(filepath.Dir(profileRoot), ".*.staging-*.tmp")); globErr != nil || len(matches) != 0 {
		t.Fatalf("failed staging temp roots = %v, err=%v", matches, globErr)
	}
}

func newPythonDependencyProfileTestManager(t *testing.T) (*Manager, string, string) {
	t.Helper()
	root := t.TempDir()
	manager, err := NewManager(slog.Default(), ManagedRoots{
		Environments: filepath.Join(root, "environments"),
		Dependencies: filepath.Join(root, "dependencies"),
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	uvPath := managedUVPath(filepath.Join(manager.depsDir, "uv"))
	runtimeRoot := filepath.Join(manager.baseDir, "python", ManagedPythonVersion+"-"+ManagedPythonABI)
	runtimePath := managedPythonInterpreterPath(runtimeRoot)
	for _, path := range []string{uvPath, runtimePath} {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("test executable"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	return manager, uvPath, runtimePath
}

func assertPythonDependencyProfileUVCommands(t *testing.T, commands []pythonDependencyProfileTestCommand, uvPath string, cacheRoot string, platform string) {
	t.Helper()
	var uvCommands []pythonDependencyProfileTestCommand
	for _, command := range commands {
		if sameManagedPath(command.Bin, uvPath) {
			uvCommands = append(uvCommands, command)
		}
	}
	if len(uvCommands) != 5 {
		t.Fatalf("uv commands = %v, want version + venv + lock + two frozen syncs", uvCommands)
	}
	if got := strings.Join(uvCommands[2].Args, " "); !strings.Contains(got, "lock --check --offline") || !strings.Contains(got, "--no-python-downloads") {
		t.Fatalf("lock command = %q", got)
	}
	wantLinkMode, err := pythonDependencyProfileLinkMode(platform)
	if err != nil {
		t.Fatal(err)
	}
	firstSync := strings.Join(uvCommands[3].Args, " ")
	secondSync := strings.Join(uvCommands[4].Args, " ")
	for _, command := range []string{firstSync, secondSync} {
		for _, required := range []string{"sync", "--frozen", "--no-dev", "--no-install-project", "--no-python-downloads", "--link-mode " + wantLinkMode} {
			if !strings.Contains(command, required) {
				t.Fatalf("sync command %q missing %q", command, required)
			}
		}
	}
	if strings.Contains(firstSync, "--offline") || !strings.Contains(secondSync, "--offline") {
		t.Fatalf("sync commands do not preserve first confirmed materialization then offline verification: first=%q second=%q", firstSync, secondSync)
	}
	for _, command := range uvCommands[1:] {
		if command.Env["UV_CACHE_DIR"] != cacheRoot {
			t.Fatalf("uv cache root = %q, want %q", command.Env["UV_CACHE_DIR"], cacheRoot)
		}
		if managedPathWithin(command.Env["UV_PROJECT_ENVIRONMENT"], command.Dir) {
			t.Fatalf("uv project root %q is nested inside target environment %q", command.Dir, command.Env["UV_PROJECT_ENVIRONMENT"])
		}
	}
}

func countPythonDependencyProfileCommands(commands []pythonDependencyProfileTestCommand, bin string) int {
	return len(pythonDependencyProfileCommandsForBin(commands, bin))
}

func pythonDependencyProfileCommandsForBin(commands []pythonDependencyProfileTestCommand, bin string) []pythonDependencyProfileTestCommand {
	matched := make([]pythonDependencyProfileTestCommand, 0)
	for _, command := range commands {
		if sameManagedPath(command.Bin, bin) {
			matched = append(matched, command)
		}
	}
	return matched
}

func snapshotPythonDependencyProfileFiles(t *testing.T, root string) []string {
	t.Helper()
	var snapshot []string
	err := filepath.Walk(root, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if info.IsDir() {
			return nil
		}
		contents, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		snapshot = append(snapshot, fmt.Sprintf("%s|%o|%s|%s", filepath.ToSlash(relative), info.Mode(), sha256Hex(contents), info.ModTime().UTC().Format(time.RFC3339Nano)))
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(snapshot)
	return snapshot
}

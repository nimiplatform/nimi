package engine

import (
	"context"
	"errors"
	"log/slog"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestStableDiffusionCPPPackageSetDeclaresNoExternalPackages(t *testing.T) {
	manifest, err := resolvePythonPackageSetManifest("stable-diffusion.cpp.cuda")
	if err != nil {
		t.Fatalf("resolvePythonPackageSetManifest: %v", err)
	}
	if manifest.ID != "media-proxy-execution-core" {
		t.Fatalf("manifest id = %q, want media-proxy-execution-core", manifest.ID)
	}
	if pythonPackageSetHasPackages(manifest.Packages) {
		t.Fatalf("stable-diffusion.cpp package set must not declare uv-managed packages: %v", manifest.Packages)
	}
	if len(manifest.ImportProbes) != 1 || manifest.ImportProbes[0] != "json" {
		t.Fatalf("import probes = %v, want json probe", manifest.ImportProbes)
	}
}

func TestTransformersNativeQwen3ASRPackageSetIsSeparateAndPinned(t *testing.T) {
	manifest, err := resolvePythonPackageSetManifest("speech.qwen3-asr-transformers.python")
	if err != nil {
		t.Fatalf("resolve Transformers-native Qwen3-ASR package set: %v", err)
	}
	if manifest.ID != "speech-qwen3-asr-transformers-python-core" {
		t.Fatalf("manifest id = %q", manifest.ID)
	}
	joined := strings.Join(manifest.Packages, "\n")
	if !strings.Contains(joined, "transformers==5.13.0") || !strings.Contains(joined, "torch") || !strings.Contains(joined, "librosa") || strings.Contains(joined, "qwen-asr") {
		t.Fatalf("Transformers-native packages = %v", manifest.Packages)
	}
	packageNative, err := resolvePythonPackageSetManifest("speech.qwen3-asr.python")
	if err != nil {
		t.Fatalf("resolve package-native Qwen3-ASR package set: %v", err)
	}
	if packageNative.ID == manifest.ID || !strings.Contains(strings.Join(packageNative.Packages, "\n"), "qwen-asr") {
		t.Fatalf("package-native manifest must remain distinct: %+v", packageNative)
	}
}

func TestEnsurePythonPackageSetDependencySerializesSharedUVBuildCache(t *testing.T) {
	root := t.TempDir()
	manager, err := NewManager(slog.Default(), ManagedRoots{
		Environments: filepath.Join(root, "environments"),
		Dependencies: filepath.Join(root, "dependencies"),
	}, nil)
	if err != nil {
		t.Fatal(err)
	}

	manager.pythonPackageSetMu.Lock()
	locked := true
	defer func() {
		if locked {
			manager.pythonPackageSetMu.Unlock()
		}
	}()
	started := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		close(started)
		_, ensureErr := manager.EnsurePythonPackageSetDependency(
			context.Background(),
			filepath.Join(root, "missing-uv"),
			filepath.Join(root, "missing-venv"),
			"speech.qwen3-asr.python",
		)
		done <- ensureErr
	}()
	<-started
	select {
	case ensureErr := <-done:
		t.Fatalf("Python package set bypassed shared uv build-cache lock: %v", ensureErr)
	case <-time.After(50 * time.Millisecond):
	}
	manager.pythonPackageSetMu.Unlock()
	locked = false
	select {
	case ensureErr := <-done:
		if ensureErr == nil {
			t.Fatal("missing uv unexpectedly materialized a Python package set")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Python package set did not resume after shared uv build-cache lock release")
	}
}

func TestUVPipInstallRejectsEmptyPackageList(t *testing.T) {
	err := uvPipInstall(context.Background(), "uv", "managed-venv", "python", nil)
	if err == nil {
		t.Fatal("uvPipInstall accepted an empty package list")
	}
	if !strings.Contains(err.Error(), "requires at least one declared package") {
		t.Fatalf("error = %q, want declared package guard", err.Error())
	}
}

func TestUVPipInstallRejectsMissingManagedVenvRoot(t *testing.T) {
	err := uvPipInstall(context.Background(), "uv", "", "python", []string{"package"})
	if err == nil || !strings.Contains(err.Error(), "managed venv root") {
		t.Fatalf("error = %v, want managed venv root guard", err)
	}
}

func TestVerifyPythonImportProbeRejectsMissingManagedVenvRoot(t *testing.T) {
	err := verifyPythonImportProbe(context.Background(), "", "python", "json")
	if err == nil || !strings.Contains(err.Error(), "managed venv root") {
		t.Fatalf("error = %v, want managed venv root guard", err)
	}
}

func TestRunCommandOutputAppliesManagedCommandTimeout(t *testing.T) {
	previous := managedPythonCommandTimeout
	managedPythonCommandTimeout = 20 * time.Millisecond
	t.Cleanup(func() {
		managedPythonCommandTimeout = previous
	})

	bin := "sh"
	args := []string{"-c", "sleep 2"}
	if runtime.GOOS == "windows" {
		bin = "cmd"
		args = []string{"/c", "ping -n 3 127.0.0.1 >NUL"}
	}
	_, err := runCommandOutput(context.Background(), "", nil, bin, args...)
	if err == nil {
		t.Fatal("expected managed command timeout")
	}
	if !strings.Contains(err.Error(), "timed out") {
		t.Fatalf("error = %q, want timeout detail", err.Error())
	}
	if !errors.Is(err, context.DeadlineExceeded) && !errors.Is(err, exec.ErrNotFound) {
		// The command should normally hit DeadlineExceeded. Keep the assertion
		// tolerant of stripped test shells while still requiring the timeout
		// detail above.
		t.Fatalf("error = %v, want timeout-derived error", err)
	}
}

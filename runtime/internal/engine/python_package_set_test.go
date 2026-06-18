package engine

import (
	"context"
	"errors"
	"os/exec"
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

func TestUVPipInstallRejectsEmptyPackageList(t *testing.T) {
	err := uvPipInstall(context.Background(), "uv", "python", nil)
	if err == nil {
		t.Fatal("uvPipInstall accepted an empty package list")
	}
	if !strings.Contains(err.Error(), "requires at least one declared package") {
		t.Fatalf("error = %q, want declared package guard", err.Error())
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

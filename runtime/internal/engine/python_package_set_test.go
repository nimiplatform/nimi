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
	if len(manifest.ImportProbes) != 1 || manifest.ImportProbes[0] != "json" {
		t.Fatalf("import probes = %v, want json probe", manifest.ImportProbes)
	}
}

func TestTransformersNativeQwen3ASRPackageSetKeepsDistinctConsumptionProbes(t *testing.T) {
	manifest, err := resolvePythonPackageSetManifest("speech.qwen3-asr-transformers.python")
	if err != nil {
		t.Fatalf("resolve Transformers-native Qwen3-ASR package set: %v", err)
	}
	if manifest.ID != "speech-qwen3-asr-transformers-python-core" {
		t.Fatalf("manifest id = %q", manifest.ID)
	}
	joined := strings.Join(manifest.ImportProbes, "\n")
	if !strings.Contains(joined, "transformers") || !strings.Contains(joined, "torch") || !strings.Contains(joined, "imageio_ffmpeg") || !strings.Contains(joined, "librosa") || strings.Contains(joined, "qwen_asr") {
		t.Fatalf("Transformers-native import probes = %v", manifest.ImportProbes)
	}
	packageNative, err := resolvePythonPackageSetManifest("speech.qwen3-asr.python")
	if err != nil {
		t.Fatalf("resolve package-native Qwen3-ASR package set: %v", err)
	}
	if packageNative.ID == manifest.ID || !strings.Contains(strings.Join(packageNative.ImportProbes, "\n"), "qwen_asr") {
		t.Fatalf("package-native manifest must remain distinct: %+v", packageNative)
	}
}

func TestVerifyPythonImportProbeRejectsMissingDependencyProfileRoot(t *testing.T) {
	err := verifyPythonImportProbe(context.Background(), "", "python", "json")
	if err == nil || !strings.Contains(err.Error(), "dependency profile root") {
		t.Fatalf("error = %v, want dependency profile root guard", err)
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

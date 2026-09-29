package engine

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestPythonPackageSetRejectsNativeAndRetiredMediaConsumers(t *testing.T) {
	root := t.TempDir()
	for _, consumer := range []string{"stable-diffusion.cpp.cuda", "stable-diffusion.cpp.metal", "media.diffusers.cuda", "media.video-python.cpu"} {
		if manifest, err := resolvePythonPackageSetManifest(consumer); err == nil {
			t.Fatalf("consumer %s resolved a Python package set: %+v", consumer, manifest)
		}
		if err := materializePythonPipelineServerScript(root, consumer); err == nil {
			t.Fatalf("consumer %s materialized a Python pipeline Driver", consumer)
		}
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("rejected consumers left Driver files behind: %v", entries)
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
	if !strings.Contains(joined, "transformers") || !strings.Contains(joined, "torch") || !strings.Contains(joined, "imageio_ffmpeg") || !strings.Contains(joined, "librosa") || !strings.Contains(joined, "nagisa") || !strings.Contains(joined, "soynlp") || strings.Contains(joined, "qwen_asr") {
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

package engine

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func TestTextAnnotationProfileIsCPUWithoutTorch(t *testing.T) {
	for _, platform := range []string{"windows/amd64", "darwin/arm64"} {
		identity, err := ResolvePythonDependencyProfileIdentity(TextAnnotationConsumerID, platform, "cpu")
		if err != nil {
			t.Fatal(err)
		}
		if identity.TorchVersion != "" || identity.CUDAABI != "" || identity.TorchWheelIndex != "" || identity.SourceLabel != "text-spacy-cpu" {
			t.Fatalf("NLP profile pulled an unrelated acceleration environment: %+v", identity)
		}
		probes, err := pythonDependencyProfileImportProbes(TextAnnotationConsumerID, identity)
		if err != nil || !slices.Contains(probes, "spacy") || !slices.Contains(probes, "spacy_text_annotation") || slices.Contains(probes, "torch") {
			t.Fatalf("unexpected profile probes: %v, %v", probes, err)
		}
		files, err := PythonDependencyProfileStaticFiles(TextAnnotationConsumerID, identity)
		if err != nil {
			t.Fatal(err)
		}
		var lock string
		for _, file := range files {
			if filepath.Base(file.RelativePath) == "uv.lock" {
				lock = string(file.Content)
			}
		}
		if lock == "" || strings.Contains(lock, "name = \"torch\"") || !strings.Contains(lock, "version = \"3.8.16\"") {
			t.Fatal("NLP profile does not contain its exact independent lock")
		}
		if _, err := ResolvePythonDependencyProfileIdentity(TextAnnotationConsumerID, platform, "cuda"); err == nil {
			t.Fatal("NLP profile admitted an unsupported accelerator")
		}
	}
}

func TestTextAnnotationProfileRejectsDriverDrift(t *testing.T) {
	identity, err := ResolvePythonDependencyProfileIdentity(TextAnnotationConsumerID, "windows/amd64", "cpu")
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	if err := materializePythonPipelineServerScript(root, TextAnnotationConsumerID); err != nil {
		t.Fatal(err)
	}
	if err := verifyTextAnnotationDriverBundle(root); err != nil {
		t.Fatal(err)
	}
	root = t.TempDir()
	writePythonDependencyProfileStaticFilesForTest(t, root, TextAnnotationConsumerID, identity)
	if err := verifyTextAnnotationDriverBundle(root); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "spacy_text_annotation.py")
	if err := os.Chmod(path, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("changed"), 0o444); err != nil {
		t.Fatal(err)
	}
	if err := verifyTextAnnotationDriverBundle(root); err == nil {
		t.Fatal("changed NLP Driver was accepted")
	}
}

func TestTextAnnotationProfileRequiresCPUExecution(t *testing.T) {
	identity, err := ResolvePythonDependencyProfileIdentity(TextAnnotationConsumerID, "windows/amd64", "cpu")
	if err != nil {
		t.Fatal(err)
	}
	probe := pythonDependencyProfileProbe{Device: "cpu", Allocation: 1, InstalledDistributions: []string{"spacy==3.8.16"}}
	if err := verifyTextAnnotationProfileProbe(probe, identity); err != nil {
		t.Fatal(err)
	}
	probe.Allocation = 0
	if err := verifyTextAnnotationProfileProbe(probe, identity); err == nil {
		t.Fatal("profile accepted an unsuccessful CPU allocation")
	}
}

package engine

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestVerifiedSystemNVIDIACUDARuntimeRootDoesNotAdmitArtifactOnlyProof(t *testing.T) {
	t.Setenv("NIMI_RUNTIME_GPU_VENDOR", "nvidia")
	t.Setenv("NIMI_RUNTIME_GPU_CUDA_READY", "true")

	if currentGOOS() == "windows" {
		root := t.TempDir()
		for _, artifact := range nvidiaCUDAUserSpaceRuntimeRequiredArtifacts {
			if err := os.WriteFile(filepath.Join(root, artifact), []byte("dll"), 0o600); err != nil {
				t.Fatalf("write artifact %s: %v", artifact, err)
			}
		}
		t.Setenv("CUDA_PATH", root)
	}

	canonicalRoot, ok, detail := verifiedSystemNVIDIACUDARuntimeRoot()
	if ok {
		t.Fatalf("system CUDA artifact-name presence must not be admitted as ready: root=%q detail=%q", canonicalRoot, detail)
	}
	if currentGOOS() == "windows" && !strings.Contains(detail, "lacks admitted") {
		t.Fatalf("expected missing compatibility proof detail, got %q", detail)
	}
}

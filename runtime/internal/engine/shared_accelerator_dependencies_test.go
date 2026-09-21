package engine

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestVerifiedSystemNVIDIACUDARuntimeRootDoesNotAdmitArtifactOnlyProof(t *testing.T) {
	setMediaHostGPUProbeForTest(t, "nvidia", true)

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

func TestCUDA13AudioCppDependencyHasIndependentIdentityAndSource(t *testing.T) {
	spec, ok := sharedAcceleratorDependencySpecForID(NVIDIACUDA13UserSpaceRuntimeDependencyID)
	if !ok {
		t.Fatal("expected CUDA 13 audio.cpp dependency spec")
	}
	if spec.DependencyID != NVIDIACUDA13UserSpaceRuntimeDependencyID || spec.Version != "cuda_major=13;audio.cpp=v0.8.1;cuda_minor=3" {
		t.Fatalf("CUDA 13 dependency identity = %+v", spec)
	}
	if spec.ManagedSource.ArchiveURL != "https://github.com/0xShug0/audio.cpp/releases/download/v0.8.1/audio-v0.8.1-cudart-windows-x64-cuda13.3.zip" ||
		spec.ManagedSource.ArchiveSHA256 != "5c0a8b1022500b2df2062b7215584408ad07d43358f38a1a3ace0ac6daa441a9" || // pragma: allowlist secret -- public archive checksum
		spec.ManagedSource.InstallDirName == NVIDIACUDAUserSpaceRuntimeDependencyID {
		t.Fatalf("CUDA 13 managed source = %+v", spec.ManagedSource)
	}
	want := []string{"cublas64_13.dll", "cublasLt64_13.dll", "cufft64_12.dll", "cudart64_13.dll"}
	if strings.Join(spec.RequiredArtifacts, ",") != strings.Join(want, ",") {
		t.Fatalf("CUDA 13 artifacts = %v, want %v", spec.RequiredArtifacts, want)
	}
}

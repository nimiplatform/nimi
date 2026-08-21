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

func TestCUDA13AudioCppDependencyHasIndependentIdentityAndSource(t *testing.T) {
	spec, ok := sharedAcceleratorDependencySpecForID(NVIDIACUDA13UserSpaceRuntimeDependencyID)
	if !ok {
		t.Fatal("expected CUDA 13 audio.cpp dependency spec")
	}
	if spec.DependencyID != NVIDIACUDA13UserSpaceRuntimeDependencyID || spec.Version != "cuda_major=13;audio.cpp=release-0.6.1" {
		t.Fatalf("CUDA 13 dependency identity = %+v", spec)
	}
	if spec.ManagedSource.ArchiveURL != "https://github.com/0xShug0/audio.cpp/releases/download/release-0.6.1/audiocpp-windows-cuda-runtime.zip" ||
		spec.ManagedSource.ArchiveSHA256 != "4104167de457dd3d20bd6e2de172c41f84cd15d0b3e8835649849710a863d10d" ||
		spec.ManagedSource.InstallDirName == NVIDIACUDAUserSpaceRuntimeDependencyID {
		t.Fatalf("CUDA 13 managed source = %+v", spec.ManagedSource)
	}
	want := []string{"cublas64_13.dll", "cublasLt64_13.dll", "cufft64_12.dll"}
	if strings.Join(spec.RequiredArtifacts, ",") != strings.Join(want, ",") {
		t.Fatalf("CUDA 13 artifacts = %v, want %v", spec.RequiredArtifacts, want)
	}
}

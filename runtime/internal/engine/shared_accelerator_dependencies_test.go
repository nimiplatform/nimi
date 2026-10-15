package engine

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSharedAcceleratorInstallWaitIsCancellableAndDependencyScoped(t *testing.T) {
	setHostGPUProbeForTest(t, "unknown", false)
	m := &Manager{cuda12Install: make(chan struct{}, 1)}
	m.cuda12Install <- struct{}{}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if _, err := m.EnsureSharedAcceleratorDependency(ctx, NVIDIACUDAUserSpaceRuntimeDependencyID); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("blocked installer did not honor cancellation: %v", err)
	}
	other, stop := context.WithTimeout(context.Background(), time.Second)
	defer stop()
	if _, err := m.EnsureSharedAcceleratorDependency(other, NVIDIACUDA13UserSpaceRuntimeDependencyID); err == nil || errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("independent dependency must reach its own unsupported-host check: %v", err)
	}
	<-m.cuda12Install
}

func TestVerifiedSystemNVIDIACUDARuntimeRootDoesNotAdmitArtifactOnlyProof(t *testing.T) {
	setHostGPUProbeForTest(t, "nvidia", true)

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
	if spec.DependencyID != NVIDIACUDA13UserSpaceRuntimeDependencyID || spec.Version != "cuda_major=13;audio.cpp=v0.9.1;cuda_minor=3" {
		t.Fatalf("CUDA 13 dependency identity = %+v", spec)
	}
	if spec.ManagedSource.ArchiveURL != "https://github.com/0xShug0/audio.cpp/releases/download/v0.9.1/audio-v0.9.1-cudart-windows-x64-cuda13.3.zip" ||
		spec.ManagedSource.ArchiveSHA256 != "fa0fb817540c578bad085c7befb9d25b5a7634548e47955bff7b732b04b8a84b" || // pragma: allowlist secret -- public archive checksum
		spec.ManagedSource.InstallDirName == NVIDIACUDAUserSpaceRuntimeDependencyID {
		t.Fatalf("CUDA 13 managed source = %+v", spec.ManagedSource)
	}
	want := []string{"cublas64_13.dll", "cublasLt64_13.dll", "cufft64_12.dll", "cudart64_13.dll"}
	if strings.Join(spec.RequiredArtifacts, ",") != strings.Join(want, ",") {
		t.Fatalf("CUDA 13 artifacts = %v, want %v", spec.RequiredArtifacts, want)
	}
}

func TestRetiredCUDAInstallCannotSatisfyUpgradedSource(t *testing.T) {
	for _, dependencyID := range []string{NVIDIACUDAUserSpaceRuntimeDependencyID, NVIDIACUDA13UserSpaceRuntimeDependencyID} {
		t.Run(dependencyID, func(t *testing.T) {
			spec, _ := sharedAcceleratorDependencySpecForID(dependencyID)
			root := t.TempDir()
			retired := filepath.Join(root, dependencyID)
			if err := os.MkdirAll(retired, 0700); err != nil {
				t.Fatal(err)
			}
			for _, name := range spec.RequiredArtifacts {
				if err := os.WriteFile(filepath.Join(retired, name), []byte("old release"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			if _, ready, _ := verifiedManagedNVIDIACUDARuntimeRootForSpec(root, spec); ready {
				t.Fatal("matching old DLL names were relabeled as the new release")
			}
		})
	}
}

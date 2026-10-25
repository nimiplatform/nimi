package engine

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSharedAcceleratorResolverProbesVendorOnceAndKeepsNextCallFresh(t *testing.T) {
	if currentGOOS() != "windows" || currentGOARCH() != "amd64" {
		t.Skip("Windows NVIDIA resolver probe path")
	}
	previous := hostGPUProbe
	t.Cleanup(func() { hostGPUProbe = previous })
	vendor := "nvidia"
	probes := 0
	hostGPUProbe = func() (string, bool) {
		probes++
		return vendor, vendor == "nvidia"
	}
	mgr := &Manager{sharedAcceleratorDependenciesPath: t.TempDir()}
	first := mgr.ResolveSharedAcceleratorDependency(NVIDIACUDAUserSpaceRuntimeDependencyID, "llama.cpp.cuda")
	if probes != 1 {
		t.Fatalf("one resolver invocation probed the GPU %d times, want 1", probes)
	}
	if first.HostProfileID != "windows-amd64-nvidia-cuda" || first.State == SharedAcceleratorDependencyUnsupported {
		t.Fatalf("NVIDIA host facts did not reach both identity and eligibility: %+v", first)
	}
	vendor = "unknown"
	second := mgr.ResolveSharedAcceleratorDependency(NVIDIACUDA13UserSpaceRuntimeDependencyID, "audio.cpp.cuda")
	if probes != 2 || second.HostProfileID != "windows-amd64-cpu" || second.State != SharedAcceleratorDependencyUnsupported {
		t.Fatalf("next invocation reused stale GPU facts: probes=%d status=%+v", probes, second)
	}
}

func TestSharedAcceleratorSystemCandidateKeepsGPUProbeLazy(t *testing.T) {
	if currentGOOS() != "windows" {
		t.Skip("Windows system CUDA candidate path")
	}
	root := t.TempDir()
	for _, artifact := range nvidiaCUDAUserSpaceRuntimeRequiredArtifacts {
		if err := os.WriteFile(filepath.Join(root, artifact), []byte("test artifact without admission proof"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("CUDA_PATH", root)
	previous := hostGPUProbe
	t.Cleanup(func() { hostGPUProbe = previous })
	probes := 0
	hostGPUProbe = func() (string, bool) { probes++; return "nvidia", true }
	_, ready, detail := verifiedSystemNVIDIACUDARuntimeRoot()
	if ready || !strings.Contains(detail, "lacks admitted") {
		t.Fatalf("artifact names alone became system CUDA admission: ready=%t detail=%q", ready, detail)
	}
	if probes != 0 {
		t.Fatalf("candidate rejection unnecessarily probed the GPU %d times", probes)
	}
}

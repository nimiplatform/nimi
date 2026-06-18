package localservice

import (
	"context"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestProbePythonProfileSkipsWindowsStoreAlias(t *testing.T) {
	originalGOOS := localRuntimeGOOS
	originalLookPath := localRuntimeLookPath
	originalCommand := localRuntimeCommand
	t.Cleanup(func() {
		localRuntimeGOOS = originalGOOS
		localRuntimeLookPath = originalLookPath
		localRuntimeCommand = originalCommand
	})

	localRuntimeGOOS = "windows"
	commandName := "cmd"
	commandArgs := func(script string) []string {
		return []string{"/c", script}
	}
	if runtime.GOOS != "windows" {
		commandName = "sh"
		commandArgs = func(script string) []string {
			return []string{"-c", script}
		}
	}
	localRuntimeLookPath = func(name string) (string, error) {
		switch name {
		case "python":
			return `C:\Python313\python.exe`, nil
		case "python3":
			return `C:\Users\Eric\AppData\Local\Microsoft\WindowsApps\python3.exe`, nil
		default:
			return "", exec.ErrNotFound
		}
	}
	aliasCalled := false
	localRuntimeCommand = func(ctx context.Context, name string, args ...string) *exec.Cmd {
		if shouldSkipPythonExecutable(name) {
			aliasCalled = true
			return exec.CommandContext(ctx, commandName, commandArgs("exit 1")...)
		}
		return exec.CommandContext(ctx, commandName, commandArgs("echo Python 3.13.0")...)
	}

	profile := probePythonProfile()
	if !profile.GetAvailable() {
		t.Fatalf("expected python profile to be available: %#v", profile)
	}
	if strings.Trim(profile.GetVersion(), "\"") != "Python 3.13.0" {
		t.Fatalf("unexpected python version: %q", profile.GetVersion())
	}
	if aliasCalled {
		t.Fatal("windows store python alias should have been skipped")
	}
}

// TestHostProfileOrCollectedSelfCollectsWhenRequestOmitsProfile is the
// deterministic unit guard for the desktop first-run `blocked` defect: when a
// resolver entry point receives a nil request host_profile (the desktop
// ResolveLocalEnvironmentPlan / runtime baseline mint calls carry none), the
// host posture must be collected on this host rather than left nil. A nil
// profile reaching the K-MCAT-034 resolver zeroes the RAM budget and
// fail-closes every cpu variant even on a 128 GiB Apple M-series host.
func TestHostProfileOrCollectedSelfCollectsWhenRequestOmitsProfile(t *testing.T) {
	originalGOOS := localRuntimeGOOS
	originalGOARCH := localRuntimeGOARCH
	originalLookPath := localRuntimeLookPath
	originalCommand := localRuntimeCommand
	originalProbeRAM := localRuntimeProbeRAM
	t.Cleanup(func() {
		localRuntimeGOOS = originalGOOS
		localRuntimeGOARCH = originalGOARCH
		localRuntimeLookPath = originalLookPath
		localRuntimeCommand = originalCommand
		localRuntimeProbeRAM = originalProbeRAM
	})

	shellName := "sh"
	shellArgs := func(script string) []string { return []string{"-c", script} }
	if runtime.GOOS == "windows" {
		shellName = "cmd"
		shellArgs = func(script string) []string { return []string{"/c", script} }
	}

	// Model an Apple M4 Max / 128 GiB host: darwin/arm64, sysctl yields the
	// unified-memory size and page metrics. nvidia-smi is absent.
	localRuntimeGOOS = "darwin"
	localRuntimeGOARCH = "arm64"
	localRuntimeLookPath = func(string) (string, error) { return "", exec.ErrNotFound }
	const memBytes = int64(128) << 30
	localRuntimeProbeRAM = func() (int64, int64) {
		return memBytes, int64(16) << 30
	}
	localRuntimeCommand = func(ctx context.Context, name string, args ...string) *exec.Cmd {
		echo := func(value string) *exec.Cmd {
			return exec.CommandContext(ctx, shellName, shellArgs("echo "+value)...)
		}
		if name == "sysctl" && len(args) == 2 && args[0] == "-n" {
			switch args[1] {
			case "hw.memsize":
				return echo(strconv.FormatInt(memBytes, 10))
			case "hw.pagesize":
				return echo("16384")
			case "vm.page_free_count":
				return echo("1048576")
			case "machdep.cpu.brand_string":
				return echo("Apple M4 Max")
			}
		}
		return exec.CommandContext(ctx, shellName, shellArgs("exit 1")...)
	}

	// Passthrough branch: a caller-supplied profile is cloned, not replaced.
	supplied := &runtimev1.LocalDeviceProfile{Os: "linux", Arch: "amd64", TotalRamBytes: int64(64) << 30}
	if got := hostProfileOrCollected(supplied); got == nil || got.GetTotalRamBytes() != supplied.GetTotalRamBytes() {
		t.Fatalf("hostProfileOrCollected must pass a supplied profile through, got %+v", got)
	}

	// Collect branch: a nil request profile self-collects a non-nil profile
	// carrying the real host RAM budget the resolver depends on.
	collected := hostProfileOrCollected(nil)
	if collected == nil {
		t.Fatal("hostProfileOrCollected(nil) must collect a host profile, got nil")
	}
	if collected.GetTotalRamBytes() != memBytes {
		t.Fatalf("collected total_ram_bytes = %d, want %d", collected.GetTotalRamBytes(), memBytes)
	}
}

func TestProbeGPUProfileFailsClosedWhenNvidiaSmiTimesOut(t *testing.T) {
	originalGOOS := localRuntimeGOOS
	originalGOARCH := localRuntimeGOARCH
	originalLookPath := localRuntimeLookPath
	originalCommand := localRuntimeCommand
	originalTimeout := localRuntimeGPUProbeTimeout
	t.Cleanup(func() {
		localRuntimeGOOS = originalGOOS
		localRuntimeGOARCH = originalGOARCH
		localRuntimeLookPath = originalLookPath
		localRuntimeCommand = originalCommand
		localRuntimeGPUProbeTimeout = originalTimeout
	})

	localRuntimeGOOS = "linux"
	localRuntimeGOARCH = "amd64"
	localRuntimeGPUProbeTimeout = 20 * time.Millisecond
	localRuntimeLookPath = func(name string) (string, error) {
		if name == "nvidia-smi" {
			return "/usr/bin/nvidia-smi", nil
		}
		return "", exec.ErrNotFound
	}
	shellName := "sh"
	shellArgs := []string{"-c", "sleep 2"}
	if runtime.GOOS == "windows" {
		shellName = "cmd"
		shellArgs = []string{"/c", "ping -n 3 127.0.0.1 >NUL"}
	}
	localRuntimeCommand = func(ctx context.Context, name string, args ...string) *exec.Cmd {
		return exec.CommandContext(ctx, shellName, shellArgs...)
	}

	caps := probeGPUCapabilities()
	if caps.profile.GetAvailable() || caps.cudaReady {
		t.Fatalf("timed-out nvidia-smi probe must fail closed, got %+v", caps)
	}
}

func TestDeviceProfileIgnoresLegacyRuntimeGPUOverride(t *testing.T) {
	setLocalRuntimePlatformForTest(t, "linux", "amd64")
	setUnsupportedGPUProbeForTest(t)
	t.Setenv("NIMI_RUNTIME_GPU_VENDOR", "nvidia")
	t.Setenv("NIMI_RUNTIME_GPU_MODEL", "legacy-env-rtx")
	t.Setenv("NIMI_RUNTIME_GPU_CUDA_READY", "true")

	profile := collectDeviceProfile()
	if profile.GetGpu().GetAvailable() {
		t.Fatalf("legacy runtime GPU env must not make GPU available: %#v", profile.GetGpu())
	}
	if profile.GetGpu().GetVendor() != "" || profile.GetGpu().GetModel() != "" {
		t.Fatalf("legacy runtime GPU env must not project vendor/model: %#v", profile.GetGpu())
	}
}

func TestDeviceProfileIgnoresLegacyRuntimeNPUOverride(t *testing.T) {
	t.Setenv("NIMI_RUNTIME_NPU_AVAILABLE", "true")
	t.Setenv("NIMI_RUNTIME_NPU_READY", "true")
	t.Setenv("NIMI_RUNTIME_NPU_VENDOR", "legacy-npu")

	profile := collectDeviceProfile()
	if profile.GetNpu().GetAvailable() || profile.GetNpu().GetReady() {
		t.Fatalf("legacy runtime NPU env must not make NPU available: %#v", profile.GetNpu())
	}
	if profile.GetNpu().GetVendor() != "" {
		t.Fatalf("legacy runtime NPU env must not project vendor: %#v", profile.GetNpu())
	}
}

func TestNPUReadyRequiresAdmittedAvailability(t *testing.T) {
	t.Setenv("NIMI_NPU_READY", "true")

	profile := collectDeviceProfile()
	if profile.GetNpu().GetAvailable() || profile.GetNpu().GetReady() {
		t.Fatalf("NIMI_NPU_READY without NIMI_NPU_AVAILABLE must fail closed: %#v", profile.GetNpu())
	}
}

func TestNPUAdmittedAvailabilityAndReadiness(t *testing.T) {
	t.Setenv("NIMI_NPU_AVAILABLE", "true")
	t.Setenv("NIMI_NPU_READY", "true")
	t.Setenv("NIMI_NPU_VENDOR", "admitted-npu")
	t.Setenv("NIMI_NPU_RUNTIME", "admitted-runtime")

	profile := collectDeviceProfile()
	if !profile.GetNpu().GetAvailable() || !profile.GetNpu().GetReady() {
		t.Fatalf("admitted NPU env should project available/ready: %#v", profile.GetNpu())
	}
	if profile.GetNpu().GetVendor() != "admitted-npu" || profile.GetNpu().GetRuntime() != "admitted-runtime" {
		t.Fatalf("admitted NPU env should project vendor/runtime: %#v", profile.GetNpu())
	}
}

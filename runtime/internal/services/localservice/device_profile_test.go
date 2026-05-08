package localservice

import (
	"context"
	"os/exec"
	"runtime"
	"strings"
	"testing"
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

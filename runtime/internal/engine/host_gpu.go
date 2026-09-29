package engine

import (
	"context"
	"os"
	"os/exec"
	"strings"
	"time"
)

// hostGPUProbe reports the physical GPU vendor and whether its driver is
// visible. Managed image backend package selection, Metal admission, and CUDA
// user-space runtime detail share this probe; tests replace it.
var hostGPUProbe = probePhysicalHostGPU

func detectHostGPU() (string, bool) {
	if hostGPUProbe == nil {
		return "", false
	}
	vendor, driverVisible := hostGPUProbe()
	return strings.ToLower(strings.TrimSpace(vendor)), driverVisible
}

func probePhysicalHostGPU() (string, bool) {
	if currentGOOS() == "darwin" && currentGOARCH() == "arm64" {
		return "apple", true
	}
	if hasPath("nvidia-smi") {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if err := exec.CommandContext(ctx, "nvidia-smi", "--query-gpu=name", "--format=csv,noheader").Run(); err == nil {
			return "nvidia", true
		}
	}
	if currentGOOS() != "windows" && fileExists("/dev/nvidia0") {
		return "nvidia", true
	}
	return "", false
}

func hasPath(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}

func fileExists(path string) bool {
	if strings.TrimSpace(path) == "" {
		return false
	}
	_, err := os.Stat(path)
	return err == nil
}

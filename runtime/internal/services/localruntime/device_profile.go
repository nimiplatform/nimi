package localruntime

import (
	"context"
	"fmt"
	"net"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func collectDeviceProfile() *runtimev1.LocalDeviceProfile {
	return &runtimev1.LocalDeviceProfile{
		Os:            runtime.GOOS,
		Arch:          runtime.GOARCH,
		Gpu:           probeGPUProfile(),
		Python:        probePythonProfile(),
		Npu:           probeNPUProfile(),
		DiskFreeBytes: probeDiskFreeBytes(),
		Ports: []*runtimev1.LocalPortAvailability{
			{Port: 11434, Available: portAvailable(11434)},
			{Port: 1234, Available: portAvailable(1234)},
			{Port: 8080, Available: portAvailable(8080)},
		},
	}
}

func probeGPUProfile() *runtimev1.LocalGpuProfile {
	vendor := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_GPU_VENDOR"))
	model := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_GPU_MODEL"))
	if vendor != "" || model != "" {
		return &runtimev1.LocalGpuProfile{
			Available: true,
			Vendor:    vendor,
			Model:     model,
		}
	}

	if _, err := os.Stat("/dev/nvidia0"); err == nil {
		return &runtimev1.LocalGpuProfile{
			Available: true,
			Vendor:    "nvidia",
			Model:     "nvidia-gpu",
		}
	}

	if _, err := exec.LookPath("nvidia-smi"); err == nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		output, runErr := exec.CommandContext(ctx, "nvidia-smi", "--query-gpu=name", "--format=csv,noheader").Output()
		if runErr == nil {
			name := strings.TrimSpace(strings.SplitN(string(output), "\n", 2)[0])
			return &runtimev1.LocalGpuProfile{
				Available: true,
				Vendor:    "nvidia",
				Model:     name,
			}
		}
		return &runtimev1.LocalGpuProfile{
			Available: true,
			Vendor:    "nvidia",
			Model:     "nvidia-gpu",
		}
	}

	return &runtimev1.LocalGpuProfile{Available: false}
}

func probePythonProfile() *runtimev1.LocalPythonProfile {
	candidates := []string{"python3", "python"}
	for _, name := range candidates {
		path, err := exec.LookPath(name)
		if err != nil {
			continue
		}

		ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
		output, runErr := exec.CommandContext(ctx, path, "--version").CombinedOutput()
		cancel()
		version := strings.TrimSpace(string(output))
		if runErr != nil && version == "" {
			version = runErr.Error()
		}
		return &runtimev1.LocalPythonProfile{
			Available: true,
			Version:   version,
		}
	}
	return &runtimev1.LocalPythonProfile{Available: false}
}

func probeNPUProfile() *runtimev1.LocalNpuProfile {
	available := envBool("NIMI_RUNTIME_NPU_AVAILABLE")
	ready := envBool("NIMI_RUNTIME_NPU_READY")
	vendor := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_NPU_VENDOR"))
	runtimeName := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_NPU_RUNTIME"))
	detail := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_NPU_DETAIL"))
	if available || ready || vendor != "" || runtimeName != "" || detail != "" {
		return &runtimev1.LocalNpuProfile{
			Available: available || ready,
			Ready:     ready,
			Vendor:    vendor,
			Runtime:   runtimeName,
			Detail:    detail,
		}
	}
	return &runtimev1.LocalNpuProfile{
		Available: false,
		Ready:     false,
	}
}

func probeDiskFreeBytes() int64 {
	space := diskFreeBytes(os.TempDir())
	if space < 0 {
		return 0
	}
	return space
}

func portAvailable(port int) bool {
	addr := fmt.Sprintf("127.0.0.1:%d", port)
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return false
	}
	_ = ln.Close()
	return true
}

func envBool(key string) bool {
	value := strings.TrimSpace(strings.ToLower(os.Getenv(key)))
	switch value {
	case "1", "true", "yes", "y", "on":
		return true
	default:
		return false
	}
}

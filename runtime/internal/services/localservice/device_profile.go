package localservice

import (
	"context"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

var (
	localRuntimeGOOS         = runtime.GOOS
	localRuntimeGOARCH       = runtime.GOARCH
	localRuntimeLookPath     = exec.LookPath
	localRuntimeCommand      = exec.CommandContext
	localRuntimeStat         = os.Stat
	localRuntimeProgramFiles = func() string {
		value := strings.TrimSpace(os.Getenv("ProgramFiles"))
		if value == "" {
			return `C:\Program Files`
		}
		return value
	}
)

func collectDeviceProfile(extraPorts ...int32) *runtimev1.LocalDeviceProfile {
	portSet := map[int32]bool{
		11434: true,
		1234:  true,
		8080:  true,
	}
	for _, port := range extraPorts {
		if port <= 0 || port > 65535 {
			continue
		}
		portSet[port] = true
	}
	ports := make([]int32, 0, len(portSet))
	for port := range portSet {
		ports = append(ports, port)
	}
	sort.Slice(ports, func(i, j int) bool { return ports[i] < ports[j] })
	probedPorts := make([]*runtimev1.LocalPortAvailability, 0, len(ports))
	for _, port := range ports {
		probedPorts = append(probedPorts, &runtimev1.LocalPortAvailability{
			Port:      port,
			Available: portAvailable(int(port)),
		})
	}

	return &runtimev1.LocalDeviceProfile{
		Os:            localRuntimeGOOS,
		Arch:          localRuntimeGOARCH,
		Gpu:           probeGPUProfile(),
		Python:        probePythonProfile(),
		Npu:           probeNPUProfile(),
		DiskFreeBytes: probeDiskFreeBytes(),
		Ports:         probedPorts,
	}
}

func probeGPUProfile() *runtimev1.LocalGpuProfile {
	return probeGPUCapabilities().profile
}

type gpuProbeCapabilities struct {
	profile   *runtimev1.LocalGpuProfile
	cudaReady bool
}

func probeGPUCapabilities() gpuProbeCapabilities {
	vendor := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_GPU_VENDOR"))
	model := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_GPU_MODEL"))
	if vendor != "" || model != "" {
		return gpuProbeCapabilities{
			profile: &runtimev1.LocalGpuProfile{
				Available: true,
				Vendor:    vendor,
				Model:     model,
			},
			cudaReady: strings.EqualFold(strings.TrimSpace(vendor), "nvidia") && probeGPUCUDAReadyValue(),
		}
	}

	if _, err := localRuntimeStat("/dev/nvidia0"); err == nil {
		return gpuProbeCapabilities{
			profile: &runtimev1.LocalGpuProfile{
				Available: true,
				Vendor:    "nvidia",
				Model:     "nvidia-gpu",
			},
			cudaReady: probeGPUCUDAReadyValue(),
		}
	}

	if _, err := localRuntimeLookPath("nvidia-smi"); err == nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		output, runErr := localRuntimeCommand(ctx, "nvidia-smi", "--query-gpu=name", "--format=csv,noheader").Output()
		if runErr == nil {
			name := strings.TrimSpace(strings.SplitN(string(output), "\n", 2)[0])
			return gpuProbeCapabilities{
				profile: &runtimev1.LocalGpuProfile{
					Available: true,
					Vendor:    "nvidia",
					Model:     name,
				},
				cudaReady: probeGPUCUDAReadyValue(),
			}
		}
		return gpuProbeCapabilities{
			profile: &runtimev1.LocalGpuProfile{
				Available: true,
				Vendor:    "nvidia",
				Model:     "nvidia-gpu",
			},
			cudaReady: probeGPUCUDAReadyValue(),
		}
	}

	return gpuProbeCapabilities{
		profile:   &runtimev1.LocalGpuProfile{Available: false},
		cudaReady: false,
	}
}

func probeGPUCUDAReady() (bool, string) {
	if explicit, ok := explicitEnvBool("NIMI_RUNTIME_GPU_CUDA_READY"); ok {
		return explicit, "env:NIMI_RUNTIME_GPU_CUDA_READY"
	}
	for _, key := range []string{"CUDA_PATH", "CUDA_HOME"} {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return true, "env:" + key
		}
	}
	if _, err := localRuntimeLookPath("nvcc"); err == nil {
		return true, "path:nvcc"
	}
	if localRuntimeGOOS == "windows" {
		if _, err := localRuntimeStat(filepath.Join(localRuntimeProgramFiles(), "NVIDIA GPU Computing Toolkit", "CUDA")); err == nil {
			return true, "windows:default_cuda_path"
		}
	} else if _, err := localRuntimeStat("/usr/local/cuda"); err == nil {
		return true, "unix:/usr/local/cuda"
	}
	return false, ""
}

func probeGPUCUDAReadyValue() bool {
	ready, _ := probeGPUCUDAReady()
	return ready
}

func explicitEnvBool(key string) (bool, bool) {
	raw, ok := os.LookupEnv(key)
	if !ok {
		return false, false
	}
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "1", "true", "yes", "on":
		return true, true
	case "0", "false", "no", "off":
		return false, true
	default:
		return false, false
	}
}

func probePythonProfile() *runtimev1.LocalPythonProfile {
	candidates := []string{"python3", "python"}
	for _, name := range candidates {
		path, err := localRuntimeLookPath(name)
		if err != nil {
			continue
		}

		ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
		output, runErr := localRuntimeCommand(ctx, path, "--version").CombinedOutput()
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

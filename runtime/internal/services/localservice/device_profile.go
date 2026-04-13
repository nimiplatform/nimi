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
	"strconv"
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

	totalRAM, availableRAM := probeRAM()

	return &runtimev1.LocalDeviceProfile{
		Os:                localRuntimeGOOS,
		Arch:              localRuntimeGOARCH,
		Gpu:               probeGPUProfile(),
		Python:            probePythonProfile(),
		Npu:               probeNPUProfile(),
		DiskFreeBytes:     probeDiskFreeBytes(),
		Ports:             probedPorts,
		TotalRamBytes:     totalRAM,
		AvailableRamBytes: availableRAM,
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
				Available:   true,
				Vendor:      vendor,
				Model:       model,
				MemoryModel: runtimev1.GpuMemoryModel_GPU_MEMORY_MODEL_UNSPECIFIED,
			},
			cudaReady: strings.EqualFold(strings.TrimSpace(vendor), "nvidia") && probeGPUCUDAReadyValue(),
		}
	}

	if _, err := localRuntimeStat("/dev/nvidia0"); err == nil {
		totalVRAM, freeVRAM := probeNvidiaVRAM()
		return gpuProbeCapabilities{
			profile: &runtimev1.LocalGpuProfile{
				Available:          true,
				Vendor:             "nvidia",
				Model:              "nvidia-gpu",
				TotalVramBytes:     totalVRAM,
				AvailableVramBytes: freeVRAM,
				MemoryModel:        runtimev1.GpuMemoryModel_GPU_MEMORY_MODEL_DISCRETE,
			},
			cudaReady: probeGPUCUDAReadyValue(),
		}
	}

	if _, err := localRuntimeLookPath("nvidia-smi"); err == nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		// K-DEV-002: query name, memory.total, memory.free in one call.
		output, runErr := localRuntimeCommand(ctx, "nvidia-smi",
			"--query-gpu=name,memory.total,memory.free",
			"--format=csv,noheader,nounits").Output()
		if runErr == nil {
			name, totalVRAM, freeVRAM := parseNvidiaSmiOutput(string(output))
			return gpuProbeCapabilities{
				profile: &runtimev1.LocalGpuProfile{
					Available:          true,
					Vendor:             "nvidia",
					Model:              name,
					TotalVramBytes:     totalVRAM,
					AvailableVramBytes: freeVRAM,
					MemoryModel:        runtimev1.GpuMemoryModel_GPU_MEMORY_MODEL_DISCRETE,
				},
				cudaReady: probeGPUCUDAReadyValue(),
			}
		}
		return gpuProbeCapabilities{
			profile: &runtimev1.LocalGpuProfile{
				Available:   true,
				Vendor:      "nvidia",
				Model:       "nvidia-gpu",
				MemoryModel: runtimev1.GpuMemoryModel_GPU_MEMORY_MODEL_DISCRETE,
			},
			cudaReady: probeGPUCUDAReadyValue(),
		}
	}

	if strings.EqualFold(localRuntimeGOOS, "darwin") && strings.EqualFold(localRuntimeGOARCH, "arm64") {
		ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
		defer cancel()
		output, runErr := localRuntimeCommand(ctx, "sysctl", "-n", "machdep.cpu.brand_string").Output()
		model := strings.TrimSpace(string(output))
		if runErr == nil || model != "" {
			// K-DEV-002: Apple unified memory — VRAM = host RAM.
			totalRAM, availRAM := probeRAM()
			return gpuProbeCapabilities{
				profile: &runtimev1.LocalGpuProfile{
					Available:          true,
					Vendor:             "apple",
					Model:              model,
					TotalVramBytes:     totalRAM,
					AvailableVramBytes: availRAM,
					MemoryModel:        runtimev1.GpuMemoryModel_GPU_MEMORY_MODEL_UNIFIED,
				},
				cudaReady: false,
			}
		}
	}

	return gpuProbeCapabilities{
		profile: &runtimev1.LocalGpuProfile{
			Available:   false,
			MemoryModel: runtimev1.GpuMemoryModel_GPU_MEMORY_MODEL_UNSPECIFIED,
		},
		cudaReady: false,
	}
}

// probeNvidiaVRAM runs nvidia-smi to get VRAM. Used when /dev/nvidia0 is
// detected but nvidia-smi wasn't found via LookPath (unlikely but defensive).
func probeNvidiaVRAM() (totalBytes int64, freeBytes int64) {
	if _, err := localRuntimeLookPath("nvidia-smi"); err != nil {
		return 0, 0
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	output, runErr := localRuntimeCommand(ctx, "nvidia-smi",
		"--query-gpu=memory.total,memory.free",
		"--format=csv,noheader,nounits").Output()
	if runErr != nil {
		return 0, 0
	}
	line := strings.TrimSpace(strings.SplitN(string(output), "\n", 2)[0])
	parts := strings.SplitN(line, ",", 2)
	if len(parts) < 2 {
		return 0, 0
	}
	totalMiB, _ := strconv.ParseInt(strings.TrimSpace(parts[0]), 10, 64)
	freeMiB, _ := strconv.ParseInt(strings.TrimSpace(parts[1]), 10, 64)
	return totalMiB * 1024 * 1024, freeMiB * 1024 * 1024
}

// parseNvidiaSmiOutput parses "name, total_mib, free_mib" CSV line from nvidia-smi.
func parseNvidiaSmiOutput(output string) (name string, totalBytes int64, freeBytes int64) {
	line := strings.TrimSpace(strings.SplitN(output, "\n", 2)[0])
	parts := strings.SplitN(line, ",", 3)
	if len(parts) < 3 {
		// Fallback: try old format with just name
		return strings.TrimSpace(line), 0, 0
	}
	name = strings.TrimSpace(parts[0])
	totalMiB, _ := strconv.ParseInt(strings.TrimSpace(parts[1]), 10, 64)
	freeMiB, _ := strconv.ParseInt(strings.TrimSpace(parts[2]), 10, 64)
	return name, totalMiB * 1024 * 1024, freeMiB * 1024 * 1024
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
	for _, candidate := range pythonProbeCandidates() {
		name := candidate.name
		path, err := localRuntimeLookPath(name)
		if err != nil {
			continue
		}
		if shouldSkipPythonExecutable(path) {
			continue
		}

		ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
		output, runErr := localRuntimeCommand(ctx, path, candidate.args...).CombinedOutput()
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

type pythonProbeCandidate struct {
	name string
	args []string
}

func pythonProbeCandidates() []pythonProbeCandidate {
	if strings.EqualFold(localRuntimeGOOS, "windows") {
		return []pythonProbeCandidate{
			{name: "python", args: []string{"--version"}},
			{name: "py", args: []string{"-3", "--version"}},
			{name: "python3", args: []string{"--version"}},
		}
	}
	return []pythonProbeCandidate{
		{name: "python3", args: []string{"--version"}},
		{name: "python", args: []string{"--version"}},
	}
}

func shouldSkipPythonExecutable(path string) bool {
	if !strings.EqualFold(localRuntimeGOOS, "windows") {
		return false
	}
	cleaned := strings.ToLower(filepath.Clean(strings.TrimSpace(path)))
	if cleaned == "" {
		return false
	}
	return strings.Contains(cleaned, strings.ToLower(`\appdata\local\microsoft\windowsapps\`))
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

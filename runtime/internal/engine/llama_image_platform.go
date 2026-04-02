package engine

import (
	"context"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var appleSiliconModelPattern = regexp.MustCompile(`(?i)\b(?:apple\s+)?([ma])\s*([0-9]{1,2})\b`)

// LlamaImageSupervisedPlatformSupported reports whether the daemon-managed
// stablediffusion-ggml image backend can be supervised on the current host.
func LlamaImageSupervisedPlatformSupported() bool {
	return LlamaImageSupervisedPlatformSupportedFor(
		currentGOOS(),
		currentGOARCH(),
		detectLocalGPUVendor(),
		detectLocalGPUModel(),
	)
}

// LlamaImageSupervisedPlatformSupportedFor reports whether the daemon-managed
// stablediffusion-ggml image backend can be supervised on the provided host tuple.
func LlamaImageSupervisedPlatformSupportedFor(goos string, goarch string, gpuVendor string, gpuModel string) bool {
	normalizedGOOS := strings.ToLower(strings.TrimSpace(goos))
	normalizedGOARCH := strings.ToLower(strings.TrimSpace(goarch))
	if normalizedGOOS == "" || normalizedGOARCH == "" {
		return false
	}
	if !LlamaSupervisedPlatformSupportedFor(normalizedGOOS, normalizedGOARCH) {
		return false
	}
	if normalizedGOOS != "darwin" {
		return true
	}
	if normalizedGOARCH != "arm64" {
		return false
	}
	family, generation, ok := parseAppleSiliconGeneration(gpuVendor, gpuModel)
	if !ok {
		return false
	}
	switch family {
	case "m":
		return generation >= 5
	case "a":
		return generation >= 19
	default:
		return false
	}
}

// LlamaImageSupervisedPlatformSupportDetailFor returns the host compatibility
// detail for the daemon-managed stablediffusion-ggml image backend.
func LlamaImageSupervisedPlatformSupportDetailFor(goos string, goarch string, gpuVendor string, gpuModel string) string {
	if LlamaImageSupervisedPlatformSupportedFor(goos, goarch, gpuVendor, gpuModel) {
		return ""
	}
	normalizedGOOS := strings.ToLower(strings.TrimSpace(goos))
	normalizedGOARCH := strings.ToLower(strings.TrimSpace(goarch))
	if normalizedGOOS == "darwin" && normalizedGOARCH == "arm64" {
		model := strings.TrimSpace(gpuModel)
		if model == "" {
			model = "unknown Apple Silicon"
		}
		return "managed image supervised mode requires Apple M5 or newer (or A19-family) for the daemon-managed stablediffusion-ggml backend; detected " + model
	}
	if !LlamaSupervisedPlatformSupportedFor(normalizedGOOS, normalizedGOARCH) {
		return "managed image supervised mode is unavailable on this host for the daemon-managed stablediffusion-ggml backend"
	}
	return "managed image supervised mode is unavailable on this host for the daemon-managed stablediffusion-ggml backend"
}

func parseAppleSiliconGeneration(gpuVendor string, gpuModel string) (string, int, bool) {
	if vendor := strings.TrimSpace(gpuVendor); vendor != "" && !strings.EqualFold(vendor, "apple") {
		return "", 0, false
	}
	matches := appleSiliconModelPattern.FindStringSubmatch(strings.TrimSpace(gpuModel))
	if len(matches) != 3 {
		return "", 0, false
	}
	generation, err := strconv.Atoi(matches[2])
	if err != nil {
		return "", 0, false
	}
	return strings.ToLower(strings.TrimSpace(matches[1])), generation, true
}

func detectLocalGPUVendor() string {
	if value := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_GPU_VENDOR")); value != "" {
		return value
	}
	if currentGOOS() == "darwin" && currentGOARCH() == "arm64" {
		return "Apple"
	}
	return ""
}

func detectLocalGPUModel() string {
	if value := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_GPU_MODEL")); value != "" {
		return value
	}
	if currentGOOS() != "darwin" || currentGOARCH() != "arm64" {
		return ""
	}
	ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	defer cancel()
	output, err := exec.CommandContext(ctx, "sysctl", "-n", "machdep.cpu.brand_string").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(output))
}

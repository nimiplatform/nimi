package engine

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

const (
	defaultMediaTorchIndexURL = "https://download.pytorch.org/whl/cu126"
	mediaPythonVersion        = "3.12"
)

var mediaPackages = []string{
	"torch==2.7.1",
	"torchvision==0.22.1",
}

var mediaPythonPipelinePackages = []string{
	"diffusers==0.37.0",
	"transformers==5.3.0",
	"accelerate==1.13.0",
	"safetensors==0.7.0",
	"sentencepiece==0.2.1",
	"protobuf==6.33.5",
	"pillow==12.1.0",
	"imageio==2.37.3",
	"imageio-ffmpeg==0.6.0",
}

func init() {
	mediaPackages = append(mediaPackages, mediaPythonPipelinePackages...)
}

// MediaMode identifies the NIMI_MEDIA_MODE value for the media server process.
type MediaMode string

const (
	// MediaModeProxyExecution serves the runtime-owned native-binary image path.
	MediaModeProxyExecution MediaMode = "proxy_execution"
	// MediaModePipelineSupervised serves the runtime-owned python pipeline path.
	MediaModePipelineSupervised MediaMode = "pipeline_supervised"
)

func ensureMedia(_ context.Context, baseDir string, cfg EngineConfig) (EngineConfig, error) {
	mediaMode, err := resolveConfiguredMediaMode(cfg)
	if err != nil {
		return cfg, err
	}
	cfg.MediaMode = mediaMode

	root := engineVersionDir(baseDir, EngineMedia, cfg.Version)
	pythonPath := managedPythonPath(root)
	scriptPath := filepath.Join(root, "media_server.py")
	if _, err := os.Stat(pythonPath); err != nil {
		return cfg, fmt.Errorf("media python selected source is not ready at %s: %w", pythonPath, err)
	}
	if _, err := os.Stat(scriptPath); err != nil {
		return cfg, fmt.Errorf("media package-set selected source is not ready at %s: %w", scriptPath, err)
	}

	cacheRoot := filepath.Join(root, "cache")
	if err := os.MkdirAll(cacheRoot, 0o755); err != nil {
		return cfg, fmt.Errorf("create media cache root: %w", err)
	}

	cfg.BinaryPath = pythonPath
	cfg.CommandArgs = []string{
		scriptPath,
		"--host", "127.0.0.1",
		"--port", strconv.Itoa(cfg.Port),
	}
	cfg.WorkingDir = root
	if cfg.CommandEnv == nil {
		cfg.CommandEnv = map[string]string{}
	}
	cfg.CommandEnv["PYTHONUNBUFFERED"] = "1"
	cfg.CommandEnv["HF_HOME"] = filepath.Join(cacheRoot, "hf")
	cfg.CommandEnv["TRANSFORMERS_CACHE"] = filepath.Join(cacheRoot, "transformers")
	cfg.CommandEnv["DIFFUSERS_CACHE"] = filepath.Join(cacheRoot, "diffusers")
	cfg.CommandEnv["NIMI_MEDIA_MODE"] = string(mediaMode)
	if mediaMode == MediaModeProxyExecution {
	} else {
		cfg.CommandEnv["NIMI_MEDIA_DEVICE"] = "cuda"
		cfg.CommandEnv["NIMI_MEDIA_IMAGE_DRIVER"] = "flux"
		cfg.CommandEnv["NIMI_MEDIA_VIDEO_DRIVER"] = "wan"
	}
	return cfg, nil
}

func resolveConfiguredMediaMode(cfg EngineConfig) (MediaMode, error) {
	mediaMode := MediaMode(strings.TrimSpace(string(cfg.MediaMode)))
	switch mediaMode {
	case MediaModeProxyExecution, MediaModePipelineSupervised:
	default:
		if mediaMode == "" {
			return "", fmt.Errorf("media bootstrap mode is required")
		}
		return "", fmt.Errorf("unsupported media bootstrap mode: %s", mediaMode)
	}
	if cfg.ImageSupervisedSelection == nil {
		return mediaMode, nil
	}
	resolvedMode, err := MediaModeFromSelection(*cfg.ImageSupervisedSelection)
	if err != nil {
		return "", err
	}
	if mediaMode != resolvedMode {
		return "", fmt.Errorf("media bootstrap mode %s does not match image supervised selection mode %s", mediaMode, resolvedMode)
	}
	return mediaMode, nil
}

func MediaModeFromSelection(selection ImageSupervisedMatrixSelection) (MediaMode, error) {
	if !selection.Matched || selection.Conflict || selection.Entry == nil {
		detail := strings.TrimSpace(selection.CompatibilityDetail)
		if detail == "" {
			detail = "image supervised topology selection unavailable for managed media bootstrap"
		}
		return "", fmt.Errorf("%s", detail)
	}
	if selection.ProductState != ImageProductStateSupported {
		detail := strings.TrimSpace(selection.CompatibilityDetail)
		if detail == "" {
			detail = fmt.Sprintf("image supervised topology %s is not supported for managed media bootstrap", selection.EntryID)
		}
		return "", fmt.Errorf("%s", detail)
	}
	switch {
	case selection.ControlPlane == ImageControlPlaneRuntime &&
		selection.ExecutionPlane == EngineMedia &&
		selection.BackendClass == ImageBackendClassNativeBinary:
		return MediaModeProxyExecution, nil
	case selection.ControlPlane == ImageControlPlaneRuntime &&
		selection.ExecutionPlane == EngineMedia &&
		selection.BackendClass == ImageBackendClassPythonPipeline:
		return MediaModePipelineSupervised, nil
	default:
		detail := strings.TrimSpace(selection.CompatibilityDetail)
		if detail == "" {
			detail = fmt.Sprintf(
				"unsupported managed media bootstrap selection: control_plane=%s execution_plane=%s backend_class=%s",
				selection.ControlPlane,
				selection.ExecutionPlane,
				selection.BackendClass,
			)
		}
		return "", fmt.Errorf("%s", detail)
	}
}

// DetectMediaHostGPU returns the GPU vendor and CUDA readiness for the current host.
func DetectMediaHostGPU() (string, bool) {
	return detectMediaHostGPU()
}

func detectMediaHostGPU() (string, bool) {
	vendor := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_GPU_VENDOR"))
	if vendor == "" {
		switch {
		case hasPath("nvidia-smi"):
			vendor = "nvidia"
		case fileExists("/dev/nvidia0"):
			vendor = "nvidia"
		}
	}
	if !strings.EqualFold(vendor, "nvidia") {
		return strings.ToLower(strings.TrimSpace(vendor)), false
	}
	return "nvidia", detectMediaCUDAReady()
}

func detectMediaCUDAReady() bool {
	if explicit, ok := explicitBoolEnv("NIMI_RUNTIME_GPU_CUDA_READY"); ok {
		return explicit
	}
	for _, key := range []string{"CUDA_PATH", "CUDA_HOME"} {
		if strings.TrimSpace(os.Getenv(key)) != "" {
			return true
		}
	}
	if hasPath("nvcc") {
		return true
	}
	if currentGOOS() == "windows" {
		programFiles := strings.TrimSpace(os.Getenv("ProgramFiles"))
		if programFiles == "" {
			programFiles = `C:\Program Files`
		}
		return fileExists(filepath.Join(programFiles, "NVIDIA GPU Computing Toolkit", "CUDA"))
	}
	return fileExists("/usr/local/cuda")
}

func explicitBoolEnv(key string) (bool, bool) {
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

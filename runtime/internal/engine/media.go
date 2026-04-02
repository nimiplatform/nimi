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
	defaultLlamaEndpoint      = "http://127.0.0.1:1234/v1"
)

var mediaPackages = []string{
	"torch==2.7.1",
	"torchvision==0.22.1",
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

// MediaMode identifies the NIMI_MEDIA_MODE value for the media server process.
type MediaMode string

const (
	// MediaModeProxyExecution serves the llama/media dual-plane path.
	MediaModeProxyExecution MediaMode = "proxy_execution"
	// MediaModePipelineSupervised serves the media/media single-plane path.
	MediaModePipelineSupervised MediaMode = "pipeline_supervised"
)

func ensureMedia(ctx context.Context, baseDir string, cfg EngineConfig) (EngineConfig, error) {
	mediaMode := MediaModePipelineSupervised
	if cfg.ImageSupervisedSelection != nil {
		resolvedMode, err := mediaModeFromSelection(*cfg.ImageSupervisedSelection)
		if err != nil {
			return cfg, err
		}
		mediaMode = resolvedMode
	}

	root := engineVersionDir(baseDir, EngineMedia, cfg.Version)
	uvRoot := filepath.Join(baseDir, "uv")
	uvPath, err := ensureUV(ctx, uvRoot)
	if err != nil {
		return cfg, fmt.Errorf("ensure uv for media: %w", err)
	}
	pythonPath, err := ensureManagedPython(ctx, uvPath, root, mediaPythonVersion)
	if err != nil {
		return cfg, fmt.Errorf("ensure managed python for media: %w", err)
	}

	scriptPath := filepath.Join(root, "media_server.py")
	if writeErr := os.WriteFile(scriptPath, []byte(mediaServerScript), 0o755); writeErr != nil {
		return cfg, fmt.Errorf("write media server script: %w", writeErr)
	}

	stampPath := filepath.Join(root, ".deps-installed")
	if mediaMode == MediaModePipelineSupervised {
		if _, err := os.Stat(stampPath); err != nil {
			extraArgs := []string{}
			if indexURL := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_ENGINE_NIMI_MEDIA_TORCH_INDEX_URL")); indexURL != "" {
				extraArgs = append(extraArgs, "--extra-index-url", indexURL)
			} else {
				extraArgs = append(extraArgs, "--extra-index-url", defaultMediaTorchIndexURL)
			}
			if installErr := uvPipInstall(ctx, uvPath, pythonPath, mediaPackages, extraArgs...); installErr != nil {
				return cfg, fmt.Errorf("install media dependencies: %w", installErr)
			}
			if writeErr := os.WriteFile(stampPath, []byte(strings.Join(mediaPackages, "\n")), 0o644); writeErr != nil {
				return cfg, fmt.Errorf("write media dependency stamp: %w", writeErr)
			}
		}
	} else if _, err := os.Stat(stampPath); err != nil {
		if writeErr := os.WriteFile(stampPath, []byte("proxy_execution\n"), 0o644); writeErr != nil {
			return cfg, fmt.Errorf("write media proxy dependency stamp: %w", writeErr)
		}
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
		cfg.CommandEnv["NIMI_MEDIA_LLAMA_BASE_URL"] = firstNonEmpty(
			strings.TrimSpace(os.Getenv("NIMI_RUNTIME_LOCAL_LLAMA_BASE_URL")),
			defaultLlamaEndpoint,
		)
	} else {
		cfg.CommandEnv["NIMI_MEDIA_DEVICE"] = "cuda"
		cfg.CommandEnv["NIMI_MEDIA_IMAGE_DRIVER"] = "flux"
		cfg.CommandEnv["NIMI_MEDIA_VIDEO_DRIVER"] = "wan"
	}
	return cfg, nil
}

func mediaModeFromSelection(selection ImageSupervisedMatrixSelection) (MediaMode, error) {
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
	case selection.ControlPlane == EngineLlama &&
		selection.ExecutionPlane == EngineMedia &&
		selection.BackendClass == ImageBackendClassNativeBinary:
		return MediaModeProxyExecution, nil
	case selection.ControlPlane == EngineMedia &&
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

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
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

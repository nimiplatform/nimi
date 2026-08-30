package engine

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	defaultMediaTorchIndexURL = "https://download.pytorch.org/whl/cu126"
	mediaPythonVersion        = "3.12"
)

var mediaPackages = []string{
	"torch==2.7.1",
	"torchvision==0.22.1",
}

// MediaMode identifies the NIMI_MEDIA_MODE value for the media server process.
type MediaMode string

const (
	// MediaModeProxyExecution serves the runtime-owned native-binary image path.
	MediaModeProxyExecution MediaMode = "proxy_execution"
	// MediaModePipelineSupervised serves the runtime-owned python pipeline path.
	MediaModePipelineSupervised MediaMode = "pipeline_supervised"
)

func ensureMedia(_ context.Context, runtimeWorkRoot string, cfg EngineConfig) (EngineConfig, error) {
	mediaMode, err := resolveConfiguredMediaMode(cfg)
	if err != nil {
		return cfg, err
	}
	cfg.MediaMode = mediaMode
	acceleratorPlane := strings.ToLower(strings.TrimSpace(cfg.MediaHostAcceleratorPlane))
	switch acceleratorPlane {
	case "cpu", "cuda":
		cfg.MediaHostAcceleratorPlane = acceleratorPlane
	default:
		return cfg, fmt.Errorf("media verified host accelerator plane must be cpu or cuda")
	}

	root := strings.TrimSpace(cfg.MediaHostPackageSetRoot)
	if root == "" || !filepath.IsAbs(root) {
		return cfg, fmt.Errorf("media activated dependency profile root is required")
	}
	rootInfo, err := os.Lstat(root)
	if err != nil {
		return cfg, fmt.Errorf("inspect media activated dependency profile root %s: %w", root, err)
	}
	if !rootInfo.IsDir() || rootInfo.Mode()&os.ModeSymlink != 0 {
		return cfg, fmt.Errorf("media activated dependency profile root must be a non-symlink directory: %s", root)
	}
	pythonPath := managedPythonPath(root)
	scriptPath := filepath.Join(root, "media_server.py")
	pythonInfo, err := os.Stat(pythonPath)
	if err != nil {
		return cfg, fmt.Errorf("media python selected source is not ready at %s: %w", pythonPath, err)
	}
	if !pythonInfo.Mode().IsRegular() {
		return cfg, fmt.Errorf("media python selected source must be a regular file: %s", pythonPath)
	}
	if err := verifyRegularEmbeddedFile(scriptPath, []byte(mediaServerScript), "media pipeline script"); err != nil {
		return cfg, fmt.Errorf("verify media package-set selected source: %w", err)
	}

	workRoot, err := prepareMediaRuntimeWorkRoot(runtimeWorkRoot, root)
	if err != nil {
		return cfg, err
	}
	cacheRoot := filepath.Join(workRoot, "cache")
	cachePaths := map[string]string{
		"HF_HOME":            filepath.Join(cacheRoot, "huggingface"),
		"HF_HUB_CACHE":       filepath.Join(cacheRoot, "huggingface", "hub"),
		"TRANSFORMERS_CACHE": filepath.Join(cacheRoot, "transformers"),
		"DIFFUSERS_CACHE":    filepath.Join(cacheRoot, "diffusers"),
	}
	for _, path := range cachePaths {
		if err := ensureMediaWritableDirectory(path); err != nil {
			return cfg, err
		}
	}

	cfg.BinaryPath = pythonPath
	cfg.CommandArgs = []string{
		scriptPath,
		"--host", "127.0.0.1",
		"--port", strconv.Itoa(cfg.Port),
	}
	cfg.WorkingDir = workRoot
	if cfg.CommandEnv == nil {
		cfg.CommandEnv = map[string]string{}
	}
	neutralizeAmbientPythonEnvironment(cfg.CommandEnv)
	cfg.CommandEnv["PYTHONUNBUFFERED"] = "1"
	cfg.CommandEnv["PYTHONDONTWRITEBYTECODE"] = "1"
	cfg.CommandEnv["PYTHONNOUSERSITE"] = "1"
	for key, path := range cachePaths {
		cfg.CommandEnv[key] = path
	}
	cfg.CommandEnv["NIMI_MEDIA_MODE"] = string(mediaMode)
	if mediaMode == MediaModePipelineSupervised {
		cfg.CommandEnv["NIMI_MEDIA_DEVICE"] = acceleratorPlane
		cfg.CommandEnv["NIMI_MEDIA_IMAGE_DRIVER"] = "flux"
		cfg.CommandEnv["NIMI_MEDIA_VIDEO_DRIVER"] = "wan"
	}
	return cfg, nil
}

func prepareMediaRuntimeWorkRoot(runtimeWorkRoot string, profileRoot string) (string, error) {
	runtimeRoot := strings.TrimSpace(runtimeWorkRoot)
	if runtimeRoot == "" || !filepath.IsAbs(runtimeRoot) {
		return "", fmt.Errorf("media Runtime-owned work root is required")
	}
	workRoot := filepath.Join(runtimeRoot, "media-driver")
	insideProfile, err := mediaPathWithinRoot(profileRoot, workRoot)
	if err != nil {
		return "", fmt.Errorf("compare media profile and work roots: %w", err)
	}
	if insideProfile {
		return "", fmt.Errorf("media Runtime-owned work root must be outside the activated dependency profile")
	}
	if err := ensureMediaWritableDirectory(workRoot); err != nil {
		return "", err
	}
	return workRoot, nil
}

func ensureMediaWritableDirectory(path string) error {
	if err := os.MkdirAll(path, 0o700); err != nil {
		return fmt.Errorf("create media Runtime-owned work directory %s: %w", path, err)
	}
	info, err := os.Lstat(path)
	if err != nil {
		return fmt.Errorf("inspect media Runtime-owned work directory %s: %w", path, err)
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("media Runtime-owned work directory must be a non-symlink directory: %s", path)
	}
	return nil
}

func mediaPathWithinRoot(root string, path string) (bool, error) {
	relative, err := filepath.Rel(filepath.Clean(root), filepath.Clean(path))
	if err != nil {
		return false, err
	}
	return relative == "." || (relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) && !filepath.IsAbs(relative)), nil
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

var mediaHostGPUProbe = probePhysicalMediaHostGPU

func detectMediaHostGPU() (string, bool) {
	if mediaHostGPUProbe == nil {
		return "", false
	}
	vendor, driverVisible := mediaHostGPUProbe()
	return strings.ToLower(strings.TrimSpace(vendor)), driverVisible
}

func probePhysicalMediaHostGPU() (string, bool) {
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

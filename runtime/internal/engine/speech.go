package engine

import (
	"context"
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

var speechPassThroughEnvKeys = []string{
	"NIMI_RUNTIME_SPEECH_DRIVER_TIMEOUT_MS",
}

const speechDriverWorkRootEnv = "NIMI_RUNTIME_SPEECH_DRIVER_WORK_ROOT"

const (
	speechQwen3TTSDeviceMapEnv             = "NIMI_RUNTIME_SPEECH_QWEN3_TTS_DEVICE_MAP"
	speechQwen3ASRDeviceMapEnv             = "NIMI_RUNTIME_SPEECH_QWEN3_ASR_DEVICE_MAP"
	speechQwen3ASRTransformersDeviceMapEnv = "NIMI_RUNTIME_SPEECH_QWEN3_ASR_TRANSFORMERS_DEVICE_MAP"
)

func speechCommandEnv() map[string]string {
	env := map[string]string{
		"PYTHONDONTWRITEBYTECODE": "1",
		"PYTHONNOUSERSITE":        "1",
		"PYTHONUNBUFFERED":        "1",
	}
	neutralizeAmbientPythonEnvironment(env)
	for _, key := range speechPassThroughEnvKeys {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			env[key] = value
		}
	}
	return env
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'"
}

func speechDriverCommand(root string, driverPath func(string) string) string {
	trimmedRoot := strings.TrimSpace(root)
	if trimmedRoot == "" {
		return ""
	}
	return shellQuote(managedPythonLaunchPath(trimmedRoot)) + " " + shellQuote(driverPath(trimmedRoot))
}

func speechApplyDefaultEnv(cfg EngineConfig, root string) map[string]string {
	env := speechCommandEnv()
	switch strings.ToLower(strings.TrimSpace(cfg.SpeechHostAcceleratorPlane)) {
	case "cpu":
		env[speechQwen3TTSDeviceMapEnv] = "cpu"
		env[speechQwen3ASRDeviceMapEnv] = "cpu"
		env[speechQwen3ASRTransformersDeviceMapEnv] = "cpu"
	case "cuda":
		env[speechQwen3TTSDeviceMapEnv] = "cuda"
		env[speechQwen3ASRDeviceMapEnv] = "cuda:0"
		env[speechQwen3ASRTransformersDeviceMapEnv] = "cuda:0"
	}
	if modelsPath := strings.TrimSpace(cfg.ModelsPath); modelsPath != "" {
		env["NIMI_RUNTIME_LOCAL_MODELS_PATH"] = modelsPath
	}
	if workRoot := strings.TrimSpace(cfg.SpeechDriverWorkRoot); workRoot != "" {
		env[speechDriverWorkRootEnv] = workRoot
	}
	exactCapabilityHost := strings.TrimSpace(cfg.SpeechHostPackageSetRoot) != ""
	ttsRoot := strings.TrimSpace(cfg.SpeechQwen3TTSPackageSetRoot)
	asrRoot := strings.TrimSpace(cfg.SpeechQwen3ASRPackageSetRoot)
	asrTransformersRoot := strings.TrimSpace(cfg.SpeechQwen3ASRTransformersPackageSetRoot)
	if !exactCapabilityHost {
		ttsRoot = firstNonEmptyString(ttsRoot, root)
		asrRoot = firstNonEmptyString(asrRoot, root)
		asrTransformersRoot = firstNonEmptyString(asrTransformersRoot, root)
	}
	if strings.TrimSpace(env["NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD"]) == "" {
		if command := speechDriverCommand(ttsRoot, SpeechQwen3TTSDriverPath); command != "" {
			env["NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD"] = command
		}
	}
	if strings.TrimSpace(env["NIMI_RUNTIME_SPEECH_QWEN3_ASR_CMD"]) == "" {
		if command := speechDriverCommand(asrRoot, SpeechQwen3ASRDriverPath); command != "" {
			env["NIMI_RUNTIME_SPEECH_QWEN3_ASR_CMD"] = command
		}
	}
	if strings.TrimSpace(env["NIMI_RUNTIME_SPEECH_QWEN3_ASR_TRANSFORMERS_CMD"]) == "" {
		if command := speechDriverCommand(asrTransformersRoot, SpeechQwen3ASRTransformersDriverPath); command != "" {
			env["NIMI_RUNTIME_SPEECH_QWEN3_ASR_TRANSFORMERS_CMD"] = command
		}
	}
	return env
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func verifySpeechPipelineScripts(root string, consumer string) error {
	trimmedRoot := strings.TrimSpace(root)
	if trimmedRoot == "" {
		return fmt.Errorf("speech pipeline script root is required")
	}
	files := speechPipelineFilesForConsumer(consumer)
	if len(files) == 0 {
		return fmt.Errorf("speech pipeline script is not admitted for consumer %s", consumer)
	}
	for _, file := range files {
		path := filepath.Join(trimmedRoot, file.Name)
		info, err := os.Lstat(path)
		if err != nil {
			return fmt.Errorf("inspect promoted speech pipeline script %s: %w", path, err)
		}
		if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("promoted speech pipeline script must be a regular non-symlink file: %s", path)
		}
		contents, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("read promoted speech pipeline script %s: %w", path, err)
		}
		gotHash := sha256.Sum256(contents)
		wantHash := sha256.Sum256([]byte(*file.Script))
		if gotHash != wantHash {
			return fmt.Errorf("promoted speech pipeline script content drift at %s", path)
		}
	}
	return nil
}

func ensureSpeech(_ context.Context, _ string, cfg EngineConfig) (EngineConfig, error) {
	ttsRoot := strings.TrimSpace(cfg.SpeechQwen3TTSPackageSetRoot)
	asrRoot := strings.TrimSpace(cfg.SpeechQwen3ASRPackageSetRoot)
	asrTransformersRoot := strings.TrimSpace(cfg.SpeechQwen3ASRTransformersPackageSetRoot)
	hostRoot := strings.TrimSpace(cfg.SpeechHostPackageSetRoot)
	if hostRoot == "" {
		hostRoot = ttsRoot
	}
	if hostRoot == "" || (ttsRoot == "" && asrRoot == "" && asrTransformersRoot == "") {
		return cfg, fmt.Errorf("speech exact capability package-set selected source is required")
	}
	if hostRoot != ttsRoot && hostRoot != asrRoot && hostRoot != asrTransformersRoot {
		return cfg, fmt.Errorf("speech Host package-set root must own an exact configured speech Driver")
	}
	acceleratorPlane := strings.ToLower(strings.TrimSpace(cfg.SpeechHostAcceleratorPlane))
	if acceleratorPlane != "cpu" && acceleratorPlane != "cuda" {
		return cfg, fmt.Errorf("speech Host verified accelerator plane must be cpu or cuda")
	}
	cfg.SpeechHostAcceleratorPlane = acceleratorPlane
	if strings.TrimSpace(cfg.ModelsPath) == "" {
		return cfg, fmt.Errorf("speech managed models root is required")
	}
	workRoot := strings.TrimSpace(cfg.SpeechDriverWorkRoot)
	if workRoot == "" || !filepath.IsAbs(workRoot) {
		return cfg, fmt.Errorf("speech Runtime-owned driver work root is required")
	}
	if err := os.MkdirAll(workRoot, 0o700); err != nil {
		return cfg, fmt.Errorf("create speech Runtime-owned driver work root: %w", err)
	}
	workInfo, err := os.Lstat(workRoot)
	if err != nil {
		return cfg, fmt.Errorf("inspect speech Runtime-owned driver work root: %w", err)
	}
	if !workInfo.IsDir() || workInfo.Mode()&os.ModeSymlink != 0 {
		return cfg, fmt.Errorf("speech Runtime-owned driver work root must be a non-symlink directory")
	}
	pythonPath := managedPythonPath(hostRoot)
	scriptPath := filepath.Join(hostRoot, "speech_server.py")
	if _, err := os.Stat(pythonPath); err != nil {
		return cfg, fmt.Errorf("speech python selected source is not ready at %s: %w", pythonPath, err)
	}
	if ttsRoot != "" {
		if err := verifySpeechPipelineScripts(ttsRoot, "speech.qwen3-tts.python"); err != nil {
			return cfg, fmt.Errorf("verify promoted speech qwen3_tts runtime scripts: %w", err)
		}
	}
	if asrRoot != "" {
		if err := verifySpeechPipelineScripts(asrRoot, "speech.qwen3-asr.python"); err != nil {
			return cfg, fmt.Errorf("verify promoted speech qwen3_asr runtime scripts: %w", err)
		}
	}
	if asrTransformersRoot != "" {
		if err := verifySpeechPipelineScripts(asrTransformersRoot, "speech.qwen3-asr-transformers.python"); err != nil {
			return cfg, fmt.Errorf("verify promoted speech qwen3_asr_transformers runtime scripts: %w", err)
		}
	}
	for _, driverRoot := range []struct {
		name string
		root string
	}{
		{name: "qwen3_tts", root: ttsRoot},
		{name: "qwen3_asr", root: asrRoot},
		{name: "qwen3_asr_transformers", root: asrTransformersRoot},
	} {
		trimmedRoot := strings.TrimSpace(driverRoot.root)
		if trimmedRoot == "" {
			continue
		}
		if _, err := os.Stat(managedPythonPath(trimmedRoot)); err != nil {
			return cfg, fmt.Errorf("speech %s driver python selected source is not ready at %s: %w", driverRoot.name, managedPythonPath(trimmedRoot), err)
		}
	}

	cfg.BinaryPath = pythonPath
	cfg.CommandArgs = []string{
		scriptPath,
		"--host", "127.0.0.1",
		"--port", strconv.Itoa(cfg.Port),
	}
	cfg.WorkingDir = hostRoot
	if cfg.CommandEnv == nil {
		cfg.CommandEnv = map[string]string{}
	}
	for key, value := range speechApplyDefaultEnv(cfg, hostRoot) {
		cfg.CommandEnv[key] = value
	}
	return cfg, nil
}

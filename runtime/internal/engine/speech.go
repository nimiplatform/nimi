package engine

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

var nimiSpeechHostPackages = []string{
	"fastapi==0.121.1",
	"uvicorn[standard]==0.38.0",
	"python-multipart==0.0.26",
}

var nimiSpeechQwen3TTSPackages = append(append([]string{}, nimiSpeechHostPackages...),
	"huggingface-hub",
	"qwen-tts",
	"soundfile",
)

var nimiSpeechQwen3ASRPackages = append(append([]string{}, nimiSpeechHostPackages...),
	"qwen-asr",
)

var speechPassThroughEnvKeys = []string{
	"NIMI_RUNTIME_SPEECH_DRIVER_TIMEOUT_MS",
}

const speechDriverWorkRootEnv = "NIMI_RUNTIME_SPEECH_DRIVER_WORK_ROOT"

func speechCommandEnv() map[string]string {
	env := map[string]string{
		"PYTHONUNBUFFERED": "1",
	}
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
	if modelsPath := strings.TrimSpace(cfg.ModelsPath); modelsPath != "" {
		env["NIMI_RUNTIME_LOCAL_MODELS_PATH"] = modelsPath
	}
	if workRoot := strings.TrimSpace(cfg.SpeechDriverWorkRoot); workRoot != "" {
		env[speechDriverWorkRootEnv] = workRoot
	}
	exactCapabilityHost := strings.TrimSpace(cfg.SpeechHostPackageSetRoot) != ""
	ttsRoot := strings.TrimSpace(cfg.SpeechQwen3TTSPackageSetRoot)
	asrRoot := strings.TrimSpace(cfg.SpeechQwen3ASRPackageSetRoot)
	if !exactCapabilityHost {
		ttsRoot = firstNonEmptyString(ttsRoot, root)
		asrRoot = firstNonEmptyString(asrRoot, root)
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

func ensureSpeech(_ context.Context, _ string, cfg EngineConfig) (EngineConfig, error) {
	ttsRoot := strings.TrimSpace(cfg.SpeechQwen3TTSPackageSetRoot)
	asrRoot := strings.TrimSpace(cfg.SpeechQwen3ASRPackageSetRoot)
	hostRoot := strings.TrimSpace(cfg.SpeechHostPackageSetRoot)
	if hostRoot == "" {
		hostRoot = ttsRoot
	}
	if hostRoot == "" || (ttsRoot == "" && asrRoot == "") {
		return cfg, fmt.Errorf("speech exact capability package-set selected source is required")
	}
	if hostRoot != ttsRoot && hostRoot != asrRoot {
		return cfg, fmt.Errorf("speech Host package-set root must own an exact configured speech Driver")
	}
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
		if err := materializePythonPipelineServerScript(ttsRoot, "speech.qwen3-tts.python"); err != nil {
			return cfg, fmt.Errorf("refresh speech qwen3_tts runtime scripts: %w", err)
		}
	}
	if asrRoot != "" {
		if err := materializePythonPipelineServerScript(asrRoot, "speech.qwen3-asr.python"); err != nil {
			return cfg, fmt.Errorf("refresh speech qwen3_asr runtime scripts: %w", err)
		}
	}
	for _, file := range speechServerScriptFiles {
		filePath := filepath.Join(hostRoot, file.Name)
		if _, err := os.Stat(filePath); err != nil {
			return cfg, fmt.Errorf("speech package-set selected source is not ready at %s: %w", filePath, err)
		}
	}
	for _, driverRoot := range []struct {
		name string
		root string
		path func(string) string
	}{
		{name: "qwen3_tts", root: ttsRoot, path: SpeechQwen3TTSDriverPath},
		{name: "qwen3_asr", root: asrRoot, path: SpeechQwen3ASRDriverPath},
	} {
		trimmedRoot := strings.TrimSpace(driverRoot.root)
		if trimmedRoot == "" {
			continue
		}
		if _, err := os.Stat(managedPythonPath(trimmedRoot)); err != nil {
			return cfg, fmt.Errorf("speech %s driver python selected source is not ready at %s: %w", driverRoot.name, managedPythonPath(trimmedRoot), err)
		}
		if _, err := os.Stat(driverRoot.path(trimmedRoot)); err != nil {
			return cfg, fmt.Errorf("speech %s driver script selected source is not ready at %s: %w", driverRoot.name, driverRoot.path(trimmedRoot), err)
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

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

var nimiSpeechQwen3ASRPackages = []string{
	"qwen-asr",
}

var speechPassThroughEnvKeys = []string{
	"NIMI_RUNTIME_SPEECH_DRIVER_TIMEOUT_MS",
}

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
	return shellQuote(managedPythonPath(trimmedRoot)) + " " + shellQuote(driverPath(trimmedRoot))
}

func speechApplyDefaultEnv(cfg EngineConfig, root string) map[string]string {
	env := speechCommandEnv()
	if modelsPath := strings.TrimSpace(cfg.ModelsPath); modelsPath != "" {
		env["NIMI_RUNTIME_LOCAL_MODELS_PATH"] = modelsPath
	}
	if strings.TrimSpace(env["NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD"]) == "" {
		if command := speechDriverCommand(firstNonEmptyString(cfg.SpeechQwen3TTSPackageSetRoot, root), SpeechQwen3TTSDriverPath); command != "" {
			env["NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD"] = command
		}
	}
	if strings.TrimSpace(env["NIMI_RUNTIME_SPEECH_QWEN3_ASR_CMD"]) == "" {
		if command := speechDriverCommand(firstNonEmptyString(cfg.SpeechQwen3ASRPackageSetRoot, root), SpeechQwen3ASRDriverPath); command != "" {
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
	root := strings.TrimSpace(cfg.SpeechQwen3TTSPackageSetRoot)
	if root == "" {
		return cfg, fmt.Errorf("speech qwen3_tts package-set selected source is required")
	}
	asrRoot := strings.TrimSpace(cfg.SpeechQwen3ASRPackageSetRoot)
	if asrRoot == "" {
		return cfg, fmt.Errorf("speech qwen3_asr package-set selected source is required")
	}
	if strings.TrimSpace(cfg.ModelsPath) == "" {
		return cfg, fmt.Errorf("speech managed models root is required")
	}
	pythonPath := managedPythonPath(root)
	scriptPath := filepath.Join(root, "speech_server.py")
	if _, err := os.Stat(pythonPath); err != nil {
		return cfg, fmt.Errorf("speech python selected source is not ready at %s: %w", pythonPath, err)
	}
	if _, err := os.Stat(managedPythonPath(asrRoot)); err != nil {
		return cfg, fmt.Errorf("speech qwen3_asr driver python selected source is not ready at %s: %w", managedPythonPath(asrRoot), err)
	}
	if err := materializePythonPipelineServerScript(root, "speech.qwen3-tts.python"); err != nil {
		return cfg, fmt.Errorf("refresh speech qwen3_tts runtime scripts: %w", err)
	}
	if err := materializePythonPipelineServerScript(asrRoot, "speech.qwen3-asr.python"); err != nil {
		return cfg, fmt.Errorf("refresh speech qwen3_asr runtime scripts: %w", err)
	}
	for _, file := range speechServerScriptFiles {
		filePath := filepath.Join(root, file.Name)
		if _, err := os.Stat(filePath); err != nil {
			return cfg, fmt.Errorf("speech package-set selected source is not ready at %s: %w", filePath, err)
		}
	}
	for _, driverRoot := range []struct {
		name string
		root string
		path func(string) string
	}{
		{name: "qwen3_tts", root: firstNonEmptyString(cfg.SpeechQwen3TTSPackageSetRoot, root), path: SpeechQwen3TTSDriverPath},
		{name: "qwen3_asr", root: firstNonEmptyString(asrRoot, root), path: SpeechQwen3ASRDriverPath},
	} {
		trimmedRoot := strings.TrimSpace(driverRoot.root)
		if trimmedRoot == "" {
			return cfg, fmt.Errorf("speech %s package-set root is required", driverRoot.name)
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
	cfg.WorkingDir = root
	if cfg.CommandEnv == nil {
		cfg.CommandEnv = map[string]string{}
	}
	for key, value := range speechApplyDefaultEnv(cfg, root) {
		cfg.CommandEnv[key] = value
	}
	return cfg, nil
}

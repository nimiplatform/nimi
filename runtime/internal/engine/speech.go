package engine

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

const speechPythonVersion = "3.12"

var nimiSpeechPackages = []string{
	"fastapi==0.121.1",
	"uvicorn[standard]==0.38.0",
	"python-multipart",
}

var speechPassThroughEnvKeys = []string{
	"NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD",
	"NIMI_RUNTIME_SPEECH_QWEN3_ASR_CMD",
	"NIMI_RUNTIME_SPEECH_DRIVER_TIMEOUT_MS",
}

func speechCommandEnv() map[string]string {
	env := map[string]string{
		"PYTHONUNBUFFERED": "1",
	}
	if strings.TrimSpace(os.Getenv("NIMI_RUNTIME_LOCAL_MODELS_PATH")) != "" {
		env["NIMI_RUNTIME_LOCAL_MODELS_PATH"] = strings.TrimSpace(os.Getenv("NIMI_RUNTIME_LOCAL_MODELS_PATH"))
	} else if homeDir, err := os.UserHomeDir(); err == nil {
		env["NIMI_RUNTIME_LOCAL_MODELS_PATH"] = filepath.Join(homeDir, ".nimi", "data", "models")
	}
	for _, key := range speechPassThroughEnvKeys {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			env[key] = value
		}
	}
	return env
}

func speechDependencyStampContents() []byte {
	return []byte(strings.Join(nimiSpeechPackages, "\n") + "\n")
}

func ensureSpeech(ctx context.Context, baseDir string, cfg EngineConfig) (EngineConfig, error) {
	root := engineVersionDir(baseDir, EngineSpeech, cfg.Version)
	uvRoot := filepath.Join(baseDir, "uv")
	uvPath, err := ensureUV(ctx, uvRoot)
	if err != nil {
		return cfg, fmt.Errorf("ensure uv for speech: %w", err)
	}
	pythonPath, err := ensureManagedPython(ctx, uvPath, root, speechPythonVersion)
	if err != nil {
		return cfg, fmt.Errorf("ensure managed python for speech: %w", err)
	}

	scriptPath := filepath.Join(root, "speech_server.py")
	if writeErr := os.WriteFile(scriptPath, []byte(speechServerScript), 0o755); writeErr != nil {
		return cfg, fmt.Errorf("write speech server script: %w", writeErr)
	}

	stampPath := filepath.Join(root, ".deps-installed")
	stampCurrent := false
	if stampRaw, readErr := os.ReadFile(stampPath); readErr == nil {
		stampCurrent = string(stampRaw) == string(speechDependencyStampContents())
	}
	if !stampCurrent {
		if installErr := uvPipInstall(ctx, uvPath, pythonPath, nimiSpeechPackages); installErr != nil {
			return cfg, fmt.Errorf("install speech dependencies: %w", installErr)
		}
		if writeErr := os.WriteFile(stampPath, speechDependencyStampContents(), 0o644); writeErr != nil {
			return cfg, fmt.Errorf("write speech dependency stamp: %w", writeErr)
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
	for key, value := range speechCommandEnv() {
		cfg.CommandEnv[key] = value
	}
	return cfg, nil
}

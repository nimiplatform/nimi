package engine

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

var nimiSpeechPackages = []string{
	"fastapi==0.121.1",
	"uvicorn[standard]==0.38.0",
	"python-multipart==0.0.26",
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

func ensureSpeech(_ context.Context, baseDir string, cfg EngineConfig) (EngineConfig, error) {
	root := engineVersionDir(baseDir, EngineSpeech, cfg.Version)
	pythonPath := managedPythonPath(root)
	scriptPath := filepath.Join(root, "speech_server.py")
	if _, err := os.Stat(pythonPath); err != nil {
		return cfg, fmt.Errorf("speech python selected source is not ready at %s: %w", pythonPath, err)
	}
	if _, err := os.Stat(scriptPath); err != nil {
		return cfg, fmt.Errorf("speech package-set selected source is not ready at %s: %w", scriptPath, err)
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

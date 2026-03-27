package engine

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
)

const speechPythonVersion = "3.12"

var nimiSpeechPackages = []string{
	"fastapi==0.121.1",
	"uvicorn[standard]==0.38.0",
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
	if _, statErr := os.Stat(stampPath); statErr != nil {
		if installErr := uvPipInstall(ctx, uvPath, pythonPath, nimiSpeechPackages); installErr != nil {
			return cfg, fmt.Errorf("install speech dependencies: %w", installErr)
		}
		if writeErr := os.WriteFile(stampPath, []byte("fastapi\nuvicorn\n"), 0o644); writeErr != nil {
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
	cfg.CommandEnv["PYTHONUNBUFFERED"] = "1"
	return cfg, nil
}

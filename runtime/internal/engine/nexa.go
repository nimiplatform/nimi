package engine

import (
	"fmt"
	"os/exec"
)

// nexaLookPath finds the Nexa binary in the system PATH.
func nexaLookPath() (string, error) {
	path, err := exec.LookPath("nexa")
	if err != nil {
		return "", fmt.Errorf("nexa not found in PATH: %w (install via pip install nexaai or see https://docs.nexaai.com)", err)
	}
	return path, nil
}

// nexaCommand builds the exec.Cmd for starting Nexa serve.
func nexaCommand(cfg EngineConfig) *exec.Cmd {
	args := []string{
		"server",
		"--host", "127.0.0.1",
		"--port", itoa(cfg.Port),
	}
	return exec.Command(cfg.BinaryPath, args...)
}

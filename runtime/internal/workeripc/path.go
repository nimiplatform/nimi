package workeripc

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	socketExtension = ".sock"
)

func workerDir() string {
	if value := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_WORKER_DIR")); value != "" {
		return value
	}
	homeDir, err := os.UserHomeDir()
	if err == nil && strings.TrimSpace(homeDir) != "" {
		return filepath.Join(homeDir, ".nimi", "runtime", "workers")
	}
	return filepath.Join(os.TempDir(), "nimi-runtime-workers")
}

func normalizeRole(role string) string {
	switch strings.TrimSpace(strings.ToLower(role)) {
	case "ai":
		return "ai"
	case "model":
		return "model"
	case "workflow":
		return "workflow"
	case "script":
		return "script"
	case "local":
		return "local"
	default:
		return ""
	}
}

func EnsureWorkerDir() error {
	return os.MkdirAll(workerDir(), 0o755)
}

func SocketPath(role string) (string, error) {
	normalized := normalizeRole(role)
	if normalized == "" {
		return "", fmt.Errorf("unsupported worker role %q", role)
	}
	return filepath.Join(workerDir(), normalized+socketExtension), nil
}

func DialTarget(role string) (string, error) {
	path, err := SocketPath(role)
	if err != nil {
		return "", err
	}
	return "unix://" + path, nil
}

func PrepareSocket(role string) (string, error) {
	if err := EnsureWorkerDir(); err != nil {
		return "", err
	}
	path, err := SocketPath(role)
	if err != nil {
		return "", err
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return "", err
	}
	return path, nil
}

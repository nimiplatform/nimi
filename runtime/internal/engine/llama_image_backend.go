package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

const llamaBackendRunScript = "run.sh"

type llamaBackendMetadata struct {
	Name           string `json:"name,omitempty"`
	Alias          string `json:"alias,omitempty"`
	MetaBackendFor string `json:"meta_backend_for,omitempty"`
}

func normalizeLlamaImageBackendConfig(input *LlamaImageBackendConfig) *LlamaImageBackendConfig {
	cfg := cloneLlamaImageBackendConfig(input)
	if cfg == nil {
		cfg = &LlamaImageBackendConfig{}
	}
	if cfg.Mode == "" {
		cfg.Mode = LlamaImageBackendDisabled
	}
	if strings.TrimSpace(cfg.BackendName) == "" {
		cfg.BackendName = "stablediffusion-ggml"
	}
	if strings.TrimSpace(cfg.Address) == "" {
		cfg.Address = "127.0.0.1:50052"
	}
	if cfg.StartupTimeout <= 0 {
		cfg.StartupTimeout = 45 * time.Second
	}
	if cfg.HealthInterval <= 0 {
		cfg.HealthInterval = 15 * time.Second
	}
	if cfg.ShutdownTimeout <= 0 {
		cfg.ShutdownTimeout = 10 * time.Second
	}
	return cfg
}

func llamaImageBackendEngineConfig(cfg *LlamaImageBackendConfig) (EngineConfig, error) {
	if cfg == nil || !cfg.Enabled() {
		return EngineConfig{}, fmt.Errorf("llama image backend disabled")
	}
	address := strings.TrimSpace(cfg.Address)
	_, portValue, err := net.SplitHostPort(address)
	if err != nil {
		return EngineConfig{}, fmt.Errorf("invalid image backend address %q", address)
	}
	port, err := strconv.Atoi(strings.TrimSpace(portValue))
	if err != nil || port <= 0 || port > 65535 {
		return EngineConfig{}, fmt.Errorf("invalid image backend port in %q", address)
	}
	command := strings.TrimSpace(cfg.Command)
	if command == "" {
		return EngineConfig{}, fmt.Errorf("image backend command is required")
	}
	return EngineConfig{
		Kind:             engineMediaDiffusersBackend,
		Port:             port,
		Address:          address,
		HealthMode:       HealthModeTCP,
		BinaryPath:       command,
		CommandArgs:      append([]string(nil), cfg.Args...),
		CommandEnv:       cloneStringMap(cfg.Env),
		WorkingDir:       strings.TrimSpace(cfg.WorkingDir),
		StartupTimeout:   cfg.StartupTimeout,
		HealthInterval:   cfg.HealthInterval,
		ShutdownTimeout:  cfg.ShutdownTimeout,
		RestartBaseDelay: 2 * time.Second,
		MaxRestarts:      5,
	}, nil
}

func cloneStringMap(input map[string]string) map[string]string {
	if len(input) == 0 {
		return nil
	}
	cloned := make(map[string]string, len(input))
	for key, value := range input {
		cloned[key] = value
	}
	return cloned
}

func ensureOfficialLlamaImageBackend(ctx context.Context, llamaBinaryPath string, backendsPath string, cfg *LlamaImageBackendConfig) (*LlamaImageBackendConfig, error) {
	normalized := normalizeLlamaImageBackendConfig(cfg)
	if !normalized.Enabled() {
		return normalized, nil
	}
	if normalized.Mode != LlamaImageBackendOfficial {
		return normalized, nil
	}
	if strings.TrimSpace(llamaBinaryPath) == "" {
		return nil, fmt.Errorf("llama binary path is required")
	}
	if strings.TrimSpace(backendsPath) == "" {
		return nil, fmt.Errorf("llama backends path is required")
	}
	if err := os.MkdirAll(backendsPath, 0o755); err != nil {
		return nil, fmt.Errorf("create llama backends path: %w", err)
	}

	runPath, err := discoverInstalledLlamaBackendRunPath(backendsPath, normalized.BackendName)
	if err != nil {
		if err := installLlamaBackend(ctx, llamaBinaryPath, backendsPath, normalized.BackendName); err != nil {
			return nil, err
		}
		runPath, err = discoverInstalledLlamaBackendRunPath(backendsPath, normalized.BackendName)
		if err != nil {
			return nil, err
		}
	}

	normalized.Command = runPath
	normalized.Args = []string{"--addr", normalized.Address}
	return normalized, nil
}

func installLlamaBackend(ctx context.Context, llamaBinaryPath string, backendsPath string, backendName string) error {
	cmd := exec.CommandContext(ctx, llamaBinaryPath, "backends", "install", backendName, "--backends-path", backendsPath)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("install llama backend %s: %w: %s", backendName, err, strings.TrimSpace(string(output)))
	}
	return nil
}

func discoverInstalledLlamaBackendRunPath(backendsPath string, backendName string) (string, error) {
	entries, err := os.ReadDir(backendsPath)
	if err != nil {
		return "", fmt.Errorf("read llama backends path: %w", err)
	}
	type candidate struct {
		dir     string
		runPath string
		score   int
	}
	candidates := make([]candidate, 0, len(entries))
	trimmedBackend := strings.TrimSpace(backendName)
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		dir := entry.Name()
		runPath := filepath.Join(backendsPath, dir, llamaBackendRunScript)
		metadata, metadataErr := readLlamaBackendMetadata(filepath.Join(backendsPath, dir, "metadata.json"))
		if metadataErr != nil {
			return "", metadataErr
		}
		var score int
		switch {
		case dir == trimmedBackend:
			score = 0
		case metadata != nil && strings.EqualFold(strings.TrimSpace(metadata.Alias), trimmedBackend):
			score = 1
		case metadata != nil && strings.EqualFold(strings.TrimSpace(metadata.Name), trimmedBackend):
			score = 2
		case metadata != nil && strings.EqualFold(strings.TrimSpace(metadata.MetaBackendFor), trimmedBackend):
			score = 3
		default:
			continue
		}
		targetRunPath := runPath
		if metadata != nil && strings.TrimSpace(metadata.MetaBackendFor) != "" {
			targetRunPath = filepath.Join(backendsPath, strings.TrimSpace(metadata.MetaBackendFor), llamaBackendRunScript)
		}
		if _, statErr := os.Stat(targetRunPath); statErr != nil {
			continue
		}
		candidates = append(candidates, candidate{
			dir:     dir,
			runPath: targetRunPath,
			score:   score,
		})
	}
	if len(candidates) == 0 {
		return "", fmt.Errorf("llama backend %q not installed in %s", backendName, backendsPath)
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].score != candidates[j].score {
			return candidates[i].score < candidates[j].score
		}
		return candidates[i].dir < candidates[j].dir
	})
	return candidates[0].runPath, nil
}

func readLlamaBackendMetadata(path string) (*llamaBackendMetadata, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read llama backend metadata %s: %w", path, err)
	}
	var metadata llamaBackendMetadata
	if err := json.Unmarshal(raw, &metadata); err != nil {
		return nil, fmt.Errorf("parse llama backend metadata %s: %w", path, err)
	}
	return &metadata, nil
}

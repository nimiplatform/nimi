package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const localAIBackendRunScript = "run.sh"

type localAIBackendMetadata struct {
	Name           string `json:"name,omitempty"`
	Alias          string `json:"alias,omitempty"`
	MetaBackendFor string `json:"meta_backend_for,omitempty"`
}

func normalizeLocalAIImageBackendConfig(input *LocalAIImageBackendConfig) *LocalAIImageBackendConfig {
	cfg := cloneLocalAIImageBackendConfig(input)
	if cfg == nil {
		cfg = &LocalAIImageBackendConfig{}
	}
	if cfg.Mode == "" {
		cfg.Mode = LocalAIImageBackendDisabled
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

func localAIImageBackendEngineConfig(cfg *LocalAIImageBackendConfig) (EngineConfig, error) {
	if cfg == nil || !cfg.Enabled() {
		return EngineConfig{}, fmt.Errorf("localai image backend disabled")
	}
	address := strings.TrimSpace(cfg.Address)
	hostPortParts := strings.Split(address, ":")
	if len(hostPortParts) < 2 {
		return EngineConfig{}, fmt.Errorf("invalid image backend address %q", address)
	}
	portValue := strings.TrimSpace(hostPortParts[len(hostPortParts)-1])
	port := 0
	for _, ch := range portValue {
		if ch < '0' || ch > '9' {
			return EngineConfig{}, fmt.Errorf("invalid image backend port in %q", address)
		}
		port = port*10 + int(ch-'0')
	}
	if port <= 0 {
		return EngineConfig{}, fmt.Errorf("invalid image backend port in %q", address)
	}
	command := strings.TrimSpace(cfg.Command)
	if command == "" {
		return EngineConfig{}, fmt.Errorf("image backend command is required")
	}
	return EngineConfig{
		Kind:             engineLocalAIImageBackend,
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

func ensureOfficialLocalAIImageBackend(ctx context.Context, localAIBinaryPath string, backendsPath string, cfg *LocalAIImageBackendConfig) (*LocalAIImageBackendConfig, error) {
	normalized := normalizeLocalAIImageBackendConfig(cfg)
	if !normalized.Enabled() {
		return normalized, nil
	}
	if normalized.Mode != LocalAIImageBackendOfficial {
		return normalized, nil
	}
	if strings.TrimSpace(localAIBinaryPath) == "" {
		return nil, fmt.Errorf("localai binary path is required")
	}
	if strings.TrimSpace(backendsPath) == "" {
		return nil, fmt.Errorf("localai backends path is required")
	}
	if err := os.MkdirAll(backendsPath, 0o755); err != nil {
		return nil, fmt.Errorf("create localai backends path: %w", err)
	}

	runPath, err := discoverInstalledLocalAIBackendRunPath(backendsPath, normalized.BackendName)
	if err != nil {
		if err := installLocalAIBackend(ctx, localAIBinaryPath, backendsPath, normalized.BackendName); err != nil {
			return nil, err
		}
		runPath, err = discoverInstalledLocalAIBackendRunPath(backendsPath, normalized.BackendName)
		if err != nil {
			return nil, err
		}
	}

	normalized.Command = runPath
	normalized.Args = []string{"--addr", normalized.Address}
	return normalized, nil
}

func installLocalAIBackend(ctx context.Context, localAIBinaryPath string, backendsPath string, backendName string) error {
	cmd := exec.CommandContext(ctx, localAIBinaryPath, "backends", "install", backendName, "--backends-path", backendsPath)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("install localai backend %s: %w: %s", backendName, err, strings.TrimSpace(string(output)))
	}
	return nil
}

func discoverInstalledLocalAIBackendRunPath(backendsPath string, backendName string) (string, error) {
	entries, err := os.ReadDir(backendsPath)
	if err != nil {
		return "", fmt.Errorf("read localai backends path: %w", err)
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
		runPath := filepath.Join(backendsPath, dir, localAIBackendRunScript)
		metadata, metadataErr := readLocalAIBackendMetadata(filepath.Join(backendsPath, dir, "metadata.json"))
		if metadataErr != nil {
			return "", metadataErr
		}
		score := 99
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
			targetRunPath = filepath.Join(backendsPath, strings.TrimSpace(metadata.MetaBackendFor), localAIBackendRunScript)
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
		return "", fmt.Errorf("localai backend %q not installed in %s", backendName, backendsPath)
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].score != candidates[j].score {
			return candidates[i].score < candidates[j].score
		}
		return candidates[i].dir < candidates[j].dir
	})
	return candidates[0].runPath, nil
}

func readLocalAIBackendMetadata(path string) (*localAIBackendMetadata, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read localai backend metadata %s: %w", path, err)
	}
	var metadata localAIBackendMetadata
	if err := json.Unmarshal(raw, &metadata); err != nil {
		return nil, fmt.Errorf("parse localai backend metadata %s: %w", path, err)
	}
	return &metadata, nil
}

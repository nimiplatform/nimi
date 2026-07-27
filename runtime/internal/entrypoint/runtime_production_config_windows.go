//go:build windows

package entrypoint

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/oklog/ulid/v2"
)

const (
	windowsProductionRealmBaseURL     = "https://realm.nimi.ai"
	windowsProductionInstallStateFile = "installation.json"
)

type windowsProductionInstallState struct {
	SchemaVersion int    `json:"schemaVersion"`
	RuntimeID     string `json:"runtimeId"`
}

// loadWindowsProtectedRuntimeConfig constructs the production service config
// exclusively from the already-validated service-owned state root and fixed
// release policy. LocalSystem environment variables, argv, user-profile files,
// and caller-selected endpoints are intentionally not inputs.
func loadWindowsProtectedRuntimeConfig(stateRoot string) (config.Config, error) {
	root := filepath.Clean(strings.TrimSpace(stateRoot))
	if root == "." || !filepath.IsAbs(root) {
		return config.Config{}, fmt.Errorf("fixed Windows Runtime state root is required")
	}
	runtimeRoot := filepath.Join(root, "runtime")
	if err := os.MkdirAll(runtimeRoot, 0o700); err != nil {
		return config.Config{}, fmt.Errorf("create service-owned Runtime config root: %w", err)
	}
	runtimeID, err := loadOrCreateWindowsProductionRuntimeID(filepath.Join(runtimeRoot, windowsProductionInstallStateFile))
	if err != nil {
		return config.Config{}, err
	}

	cfg := newProtectedRuntimeConfig(runtimeRoot, runtimeID, windowsProductionRealmBaseURL)
	serviceConfigPath := filepath.Join(runtimeRoot, config.ServiceOwnedConfigFilename)
	if err := config.ApplyServiceOwnedDataRoot(&cfg, serviceConfigPath); err != nil {
		return config.Config{}, fmt.Errorf("apply fixed Windows Runtime mutable config: %w", err)
	}
	if err := cfg.Validate(); err != nil {
		return config.Config{}, fmt.Errorf("validate fixed Windows Runtime config: %w", err)
	}
	return cfg, nil
}

func loadOrCreateWindowsProductionRuntimeID(path string) (string, error) {
	state, err := readWindowsProductionInstallState(path)
	if err == nil {
		return state.RuntimeID, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}

	state = windowsProductionInstallState{
		SchemaVersion: 1,
		RuntimeID:     config.GenerateRuntimeID(),
	}
	raw, err := json.Marshal(state)
	if err != nil {
		return "", fmt.Errorf("marshal Windows Runtime installation state: %w", err)
	}
	raw = append(raw, '\n')
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if errors.Is(err, os.ErrExist) {
		recovered, readErr := readWindowsProductionInstallState(path)
		if readErr != nil {
			return "", readErr
		}
		return recovered.RuntimeID, nil
	}
	if err != nil {
		return "", fmt.Errorf("create Windows Runtime installation state: %w", err)
	}
	cleanup := true
	defer func() {
		_ = file.Close()
		if cleanup {
			_ = os.Remove(path)
		}
	}()
	if _, err := file.Write(raw); err != nil {
		return "", fmt.Errorf("write Windows Runtime installation state: %w", err)
	}
	if err := file.Sync(); err != nil {
		return "", fmt.Errorf("sync Windows Runtime installation state: %w", err)
	}
	if err := file.Close(); err != nil {
		return "", fmt.Errorf("close Windows Runtime installation state: %w", err)
	}
	cleanup = false
	return state.RuntimeID, nil
}

func readWindowsProductionInstallState(path string) (windowsProductionInstallState, error) {
	file, err := os.Open(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return windowsProductionInstallState{}, os.ErrNotExist
		}
		return windowsProductionInstallState{}, fmt.Errorf("open Windows Runtime installation state: %w", err)
	}
	defer func() { _ = file.Close() }()
	var state windowsProductionInstallState
	decoder := json.NewDecoder(io.LimitReader(file, 4096))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&state); err != nil {
		return windowsProductionInstallState{}, fmt.Errorf("decode Windows Runtime installation state: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return windowsProductionInstallState{}, fmt.Errorf("decode Windows Runtime installation state: unexpected trailing content")
	}
	if state.SchemaVersion != 1 {
		return windowsProductionInstallState{}, fmt.Errorf("Windows Runtime installation state schemaVersion must be 1")
	}
	parsed, err := ulid.ParseStrict(strings.TrimSpace(state.RuntimeID))
	if err != nil || parsed.String() != state.RuntimeID {
		return windowsProductionInstallState{}, fmt.Errorf("Windows Runtime installation state runtimeId is invalid")
	}
	return state, nil
}

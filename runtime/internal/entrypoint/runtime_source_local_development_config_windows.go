//go:build windows && nimi_windows_source_local_development

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
	"github.com/nimiplatform/nimi/runtime/internal/devenv"
	"github.com/oklog/ulid/v2"
)

const (
	windowsSourceInstallationStateFile = "installation.json"
)

type windowsSourceInstallationState struct {
	SchemaVersion int    `json:"schemaVersion"`
	RuntimeID     string `json:"runtimeId"`
}

func loadWindowsSourceLocalDevelopmentRuntimeConfig(stateRoot string) (config.Config, error) {
	root := filepath.Clean(strings.TrimSpace(stateRoot))
	name, realm, err := devenv.Resolve(os.Getenv)
	if err != nil {
		return config.Config{}, err
	}
	if root == "." || !filepath.IsAbs(root) || filepath.Base(root) != name || filepath.Base(filepath.Dir(root)) != "RuntimeLocalDevelopment" {
		return config.Config{}, fmt.Errorf("current-user Windows Runtime state root is required")
	}
	runtimeRoot := filepath.Join(root, "runtime")
	if err := os.MkdirAll(runtimeRoot, 0o700); err != nil {
		return config.Config{}, fmt.Errorf("create current-user Runtime config root: %w", err)
	}
	runtimeID, err := loadOrCreateWindowsSourceRuntimeID(filepath.Join(runtimeRoot, windowsSourceInstallationStateFile))
	if err != nil {
		return config.Config{}, err
	}
	realmBaseURL, err := loadWindowsSourceRealmBaseURL()
	if err != nil {
		return config.Config{}, err
	}
	cfg := newProtectedRuntimeConfig(runtimeRoot, runtimeID, realmBaseURL)
	cfg.AccountRealmRealtimeURL = realm.RealtimeOrigin
	serviceConfigPath := filepath.Join(runtimeRoot, config.ServiceOwnedConfigFilename)
	if err := config.ApplyServiceOwnedDataRoot(&cfg, serviceConfigPath); err != nil {
		return config.Config{}, fmt.Errorf("apply current-user Runtime mutable config: %w", err)
	}
	if err := cfg.Validate(); err != nil {
		return config.Config{}, fmt.Errorf("validate current-user Windows Runtime config: %w", err)
	}
	return cfg, nil
}

func loadWindowsSourceRealmBaseURL() (string, error) {
	_, realm, err := devenv.Resolve(os.Getenv)
	return realm.APIOrigin, err
}

func loadOrCreateWindowsSourceRuntimeID(path string) (string, error) {
	state, err := readWindowsSourceInstallationState(path)
	if err == nil {
		return state.RuntimeID, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	state = windowsSourceInstallationState{SchemaVersion: 1, RuntimeID: config.GenerateRuntimeID()}
	raw, err := json.Marshal(state)
	if err != nil {
		return "", fmt.Errorf("marshal current-user Runtime installation state: %w", err)
	}
	raw = append(raw, '\n')
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if errors.Is(err, os.ErrExist) {
		recovered, readErr := readWindowsSourceInstallationState(path)
		if readErr != nil {
			return "", readErr
		}
		return recovered.RuntimeID, nil
	}
	if err != nil {
		return "", fmt.Errorf("create current-user Runtime installation state: %w", err)
	}
	cleanup := true
	defer func() {
		_ = file.Close()
		if cleanup {
			_ = os.Remove(path)
		}
	}()
	if _, err := file.Write(raw); err != nil {
		return "", fmt.Errorf("write current-user Runtime installation state: %w", err)
	}
	if err := file.Sync(); err != nil {
		return "", fmt.Errorf("sync current-user Runtime installation state: %w", err)
	}
	if err := file.Close(); err != nil {
		return "", fmt.Errorf("close current-user Runtime installation state: %w", err)
	}
	cleanup = false
	return state.RuntimeID, nil
}

func readWindowsSourceInstallationState(path string) (windowsSourceInstallationState, error) {
	file, err := os.Open(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return windowsSourceInstallationState{}, os.ErrNotExist
		}
		return windowsSourceInstallationState{}, err
	}
	defer func() { _ = file.Close() }()
	var state windowsSourceInstallationState
	decoder := json.NewDecoder(io.LimitReader(file, 4096))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&state); err != nil {
		return windowsSourceInstallationState{}, fmt.Errorf("decode current-user Runtime installation state: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return windowsSourceInstallationState{}, fmt.Errorf("decode current-user Runtime installation state: unexpected trailing content")
	}
	parsed, err := ulid.ParseStrict(state.RuntimeID)
	if state.SchemaVersion != 1 || err != nil || parsed.String() != state.RuntimeID {
		return windowsSourceInstallationState{}, fmt.Errorf("current-user Runtime installation state is invalid")
	}
	return state, nil
}

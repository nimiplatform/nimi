//go:build darwin && cgo

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
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/oklog/ulid/v2"
	"golang.org/x/sys/unix"
)

const (
	macOSProductionInstallStateFile = "installation.json"
)

type macOSProductionInstallState struct {
	SchemaVersion int    `json:"schemaVersion"`
	RuntimeID     string `json:"runtimeId"`
}

// loadMacOSProtectedRuntimeConfig constructs production configuration only
// below the already-verified launchd service state. It does not read process
// environment, argv, a login user's home directory, or app-owned storage.
func loadMacOSProtectedRuntimeConfig(stateRoot string) (config.Config, error) {
	root := filepath.Clean(strings.TrimSpace(stateRoot))
	if root != protectedlocal.MacOSRuntimeStateRoot || !filepath.IsAbs(root) {
		return config.Config{}, fmt.Errorf("fixed macOS Runtime state root is required")
	}
	runtimeRoot := filepath.Join(root, "runtime")
	if err := ensureMacOSServiceDirectory(runtimeRoot); err != nil {
		return config.Config{}, err
	}
	installStatePath := filepath.Join(runtimeRoot, macOSProductionInstallStateFile)
	runtimeID, err := loadOrCreateMacOSProductionRuntimeID(installStatePath)
	if err != nil {
		return config.Config{}, err
	}

	cfg := newProtectedRuntimeConfig(runtimeRoot, runtimeID, macOSProtectedRealmBaseURL)
	serviceConfigPath := filepath.Join(runtimeRoot, config.ServiceOwnedConfigFilename)
	if err := validateOptionalMacOSServiceFile(serviceConfigPath); err != nil {
		return config.Config{}, err
	}
	if err := config.ApplyServiceOwnedDataRoot(&cfg, serviceConfigPath); err != nil {
		return config.Config{}, fmt.Errorf("apply fixed macOS Runtime mutable config: %w", err)
	}
	if err := cfg.Validate(); err != nil {
		return config.Config{}, fmt.Errorf("validate fixed macOS Runtime config: %w", err)
	}
	return cfg, nil
}

func ensureMacOSServiceDirectory(path string) error {
	cleaned := filepath.Clean(strings.TrimSpace(path))
	if !filepath.IsAbs(cleaned) || cleaned == string(filepath.Separator) {
		return fmt.Errorf("macOS Runtime service directory must be absolute and non-root")
	}
	if err := os.Mkdir(cleaned, 0o700); err != nil && !errors.Is(err, os.ErrExist) {
		return fmt.Errorf("create macOS Runtime service directory: %w", err)
	}
	info, err := os.Lstat(cleaned)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm() != 0o700 {
		return fmt.Errorf("macOS Runtime service directory kind or mode is invalid")
	}
	stat, ok := info.Sys().(*unix.Stat_t)
	if !ok || stat.Uid != uint32(os.Geteuid()) || stat.Nlink < 2 {
		return fmt.Errorf("macOS Runtime service directory ownership is invalid")
	}
	return nil
}

func validateOptionalMacOSServiceFile(path string) error {
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("inspect macOS Runtime service file: %w", err)
	}
	stat, ok := info.Sys().(*unix.Stat_t)
	if !ok || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 ||
		info.Mode().Perm() != 0o600 || stat.Uid != uint32(os.Geteuid()) || stat.Nlink != 1 {
		return fmt.Errorf("macOS Runtime service file owner, mode, kind, or link count is invalid")
	}
	return nil
}

func loadOrCreateMacOSProductionRuntimeID(path string) (string, error) {
	state, err := readMacOSProductionInstallState(path)
	if err == nil {
		return state.RuntimeID, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	state = macOSProductionInstallState{SchemaVersion: 1, RuntimeID: config.GenerateRuntimeID()}
	raw, err := json.Marshal(state)
	if err != nil {
		return "", fmt.Errorf("marshal macOS Runtime installation state: %w", err)
	}
	raw = append(raw, '\n')
	fd, err := unix.Open(path, unix.O_WRONLY|unix.O_CREAT|unix.O_EXCL|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0o600)
	if errors.Is(err, unix.EEXIST) {
		recovered, readErr := readMacOSProductionInstallState(path)
		if readErr != nil {
			return "", readErr
		}
		return recovered.RuntimeID, nil
	}
	if err != nil {
		return "", fmt.Errorf("create macOS Runtime installation state: %w", err)
	}
	file := os.NewFile(uintptr(fd), path)
	if file == nil {
		_ = unix.Close(fd)
		_ = os.Remove(path)
		return "", fmt.Errorf("adopt macOS Runtime installation state descriptor")
	}
	cleanup := true
	defer func() {
		_ = file.Close()
		if cleanup {
			_ = os.Remove(path)
		}
	}()
	if err := validateMacOSOpenServiceFile(file); err != nil {
		return "", err
	}
	if _, err := file.Write(raw); err != nil {
		return "", fmt.Errorf("write macOS Runtime installation state: %w", err)
	}
	if err := file.Sync(); err != nil {
		return "", fmt.Errorf("sync macOS Runtime installation state: %w", err)
	}
	if err := file.Close(); err != nil {
		return "", fmt.Errorf("close macOS Runtime installation state: %w", err)
	}
	if err := syncMacOSServiceDirectory(filepath.Dir(path)); err != nil {
		return "", err
	}
	cleanup = false
	return state.RuntimeID, nil
}

func readMacOSProductionInstallState(path string) (macOSProductionInstallState, error) {
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0)
	if errors.Is(err, unix.ENOENT) {
		return macOSProductionInstallState{}, os.ErrNotExist
	}
	if err != nil {
		return macOSProductionInstallState{}, fmt.Errorf("open macOS Runtime installation state: %w", err)
	}
	file := os.NewFile(uintptr(fd), path)
	if file == nil {
		_ = unix.Close(fd)
		return macOSProductionInstallState{}, fmt.Errorf("adopt macOS Runtime installation state descriptor")
	}
	defer func() { _ = file.Close() }()
	if err := validateMacOSOpenServiceFile(file); err != nil {
		return macOSProductionInstallState{}, err
	}
	var state macOSProductionInstallState
	decoder := json.NewDecoder(io.LimitReader(file, 4096))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&state); err != nil {
		return macOSProductionInstallState{}, fmt.Errorf("decode macOS Runtime installation state: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return macOSProductionInstallState{}, fmt.Errorf("decode macOS Runtime installation state: unexpected trailing content")
	}
	if state.SchemaVersion != 1 {
		return macOSProductionInstallState{}, fmt.Errorf("macOS Runtime installation state schemaVersion must be 1")
	}
	parsed, err := ulid.ParseStrict(strings.TrimSpace(state.RuntimeID))
	if err != nil || parsed.String() != state.RuntimeID {
		return macOSProductionInstallState{}, fmt.Errorf("macOS Runtime installation state runtimeId is invalid")
	}
	return state, nil
}

func validateMacOSOpenServiceFile(file *os.File) error {
	if file == nil {
		return fmt.Errorf("macOS Runtime service file is required")
	}
	info, err := file.Stat()
	if err != nil {
		return fmt.Errorf("inspect open macOS Runtime service file: %w", err)
	}
	stat, ok := info.Sys().(*unix.Stat_t)
	if !ok || !info.Mode().IsRegular() || info.Mode().Perm() != 0o600 ||
		stat.Uid != uint32(os.Geteuid()) || stat.Nlink != 1 {
		return fmt.Errorf("open macOS Runtime service file owner, mode, kind, or link count is invalid")
	}
	return nil
}

func syncMacOSServiceDirectory(path string) error {
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0)
	if err != nil {
		return fmt.Errorf("open macOS Runtime service directory for sync: %w", err)
	}
	defer func() { _ = unix.Close(fd) }()
	if err := unix.Fsync(fd); err != nil {
		return fmt.Errorf("sync macOS Runtime service directory: %w", err)
	}
	return nil
}

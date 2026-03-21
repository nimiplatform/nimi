package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const configWriteLockStaleAfter = 5 * time.Minute

type configWriteLockMetadata struct {
	PID       int    `json:"pid"`
	CreatedAt string `json:"createdAt"`
}

func acquireConfigWriteLock(configPath string) (func(), error) {
	lockPath := strings.TrimSpace(configPath) + ".lock"
	if err := os.MkdirAll(filepath.Dir(lockPath), 0o755); err != nil {
		return nil, newConfigCommandError(configReasonWriteLocked, "ensure config directory is writable", err)
	}
	for attempt := 0; attempt < 2; attempt++ {
		file, err := os.OpenFile(lockPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if err != nil {
			if errors.Is(err, os.ErrExist) {
				removed, staleErr := removeStaleConfigWriteLock(lockPath)
				if staleErr != nil {
					return nil, newConfigCommandError(configReasonWriteLocked, "inspect existing config lock", staleErr)
				}
				if removed {
					continue
				}
				return nil, newConfigCommandError(configReasonWriteLocked, "retry after other config write completes", err)
			}
			return nil, newConfigCommandError(configReasonWriteLocked, "ensure config lock can be created", err)
		}
		if err := writeConfigWriteLockMetadata(file); err != nil {
			_ = file.Close()
			_ = os.Remove(lockPath)
			return nil, newConfigCommandError(configReasonWriteLocked, "write config lock metadata", err)
		}
		invokeConfigWriteLockHook(lockPath)

		var once sync.Once
		release := func() {
			once.Do(func() {
				_ = file.Close()
				_ = os.Remove(lockPath)
			})
		}
		return release, nil
	}
	return nil, newConfigCommandError(configReasonWriteLocked, "retry after other config write completes", errors.New("config lock remained busy"))
}

func setConfigWriteLockHookForTest(hook func(lockPath string)) func() {
	configWriteLockHookMu.Lock()
	prev := configWriteLockHook
	configWriteLockHook = hook
	configWriteLockHookMu.Unlock()
	return func() {
		configWriteLockHookMu.Lock()
		configWriteLockHook = prev
		configWriteLockHookMu.Unlock()
	}
}

func invokeConfigWriteLockHook(lockPath string) {
	configWriteLockHookMu.RLock()
	hook := configWriteLockHook
	configWriteLockHookMu.RUnlock()
	if hook != nil {
		hook(lockPath)
	}
}

func writeConfigWriteLockMetadata(file *os.File) error {
	if _, err := file.Seek(0, 0); err != nil {
		return err
	}
	if err := file.Truncate(0); err != nil {
		return err
	}
	payload, err := json.Marshal(configWriteLockMetadata{
		PID:       os.Getpid(),
		CreatedAt: time.Now().UTC().Format(time.RFC3339Nano),
	})
	if err != nil {
		return err
	}
	if _, err := file.Write(payload); err != nil {
		return err
	}
	return file.Sync()
}

func removeStaleConfigWriteLock(lockPath string) (bool, error) {
	metadata, info, err := readConfigWriteLockMetadata(lockPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return false, nil
		}
		return false, err
	}
	if metadata != nil && metadata.PID > 0 && configWriteLockProcessAlive(metadata.PID) {
		return false, nil
	}
	if metadata != nil && metadata.PID > 0 {
		if err := os.Remove(lockPath); err != nil && !errors.Is(err, os.ErrNotExist) {
			return false, err
		}
		return true, nil
	}
	if time.Since(info.ModTime()) < configWriteLockStaleAfter {
		return false, nil
	}
	if err := os.Remove(lockPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return false, err
	}
	return true, nil
}

func readConfigWriteLockMetadata(lockPath string) (*configWriteLockMetadata, os.FileInfo, error) {
	info, err := os.Stat(lockPath)
	if err != nil {
		return nil, nil, err
	}
	raw, err := os.ReadFile(lockPath)
	if err != nil {
		return nil, nil, err
	}
	var metadata configWriteLockMetadata
	if err := json.Unmarshal(raw, &metadata); err != nil {
		return nil, info, nil
	}
	if strings.TrimSpace(metadata.CreatedAt) != "" {
		if _, err := time.Parse(time.RFC3339Nano, metadata.CreatedAt); err != nil {
			return nil, info, nil
		}
	}
	return &metadata, info, nil
}

package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

func acquireConfigWriteLock(configPath string) (func(), error) {
	lockPath := strings.TrimSpace(configPath) + ".lock"
	if err := os.MkdirAll(filepath.Dir(lockPath), 0o755); err != nil {
		return nil, newConfigCommandError(configReasonWriteLocked, "ensure config directory is writable", err)
	}
	file, err := os.OpenFile(lockPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		if errors.Is(err, os.ErrExist) {
			return nil, newConfigCommandError(configReasonWriteLocked, "retry after other config write completes", err)
		}
		return nil, newConfigCommandError(configReasonWriteLocked, "ensure config lock can be created", err)
	}
	invokeConfigWriteLockHook(lockPath)

	released := false
	release := func() {
		if released {
			return
		}
		released = true
		_ = file.Close()
		_ = os.Remove(lockPath)
	}
	return release, nil
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

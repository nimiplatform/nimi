package daemonctl

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
)

func (m *Manager) loadMetadata(path string) (Metadata, bool, error) {
	content, err := m.readFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return Metadata{}, false, nil
		}
		return Metadata{}, false, fmt.Errorf("read runtime metadata: %w", err)
	}
	var metadata Metadata
	if err := json.Unmarshal(content, &metadata); err != nil {
		return Metadata{}, false, fmt.Errorf("parse runtime metadata: %w", err)
	}
	return metadata, true, nil
}

func (m *Manager) writeMetadata(paths Paths, metadata Metadata) error {
	pidContent := []byte(strconv.Itoa(metadata.PID) + "\n")
	if err := m.writeAtomic(paths.PIDFile, pidContent, 0o600); err != nil {
		return fmt.Errorf("write runtime pid file: %w", err)
	}
	raw, err := json.MarshalIndent(metadata, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal runtime metadata: %w", err)
	}
	raw = append(raw, '\n')
	if err := m.writeAtomic(paths.MetadataFile, raw, 0o600); err != nil {
		return fmt.Errorf("write runtime metadata: %w", err)
	}
	return nil
}

func (m *Manager) cleanupStaleFiles(paths Paths, pid int) error {
	if pid > 0 {
		lockPID, lockExists, err := m.readPID(paths.LockFile)
		if err != nil {
			return err
		}
		if lockExists && lockPID == pid && !m.isProcessAlive(lockPID) {
			if err := m.removeFileWithRetry(paths.LockFile); err != nil {
				return err
			}
		}
	}
	if err := m.removeFileWithRetry(paths.PIDFile); err != nil {
		return err
	}
	if err := m.removeFileWithRetry(paths.MetadataFile); err != nil {
		return err
	}
	return nil
}

func (m *Manager) removeFileWithRetry(path string) error {
	if strings.TrimSpace(path) == "" {
		return nil
	}
	deadline := m.now().Add(fileRemoveRetryTimeout)
	for {
		err := m.removeFile(path)
		if err == nil || os.IsNotExist(err) {
			return nil
		}
		if !shouldRetryFileRemove(err) || m.now().After(deadline) {
			return err
		}
		m.sleep(fileRemoveRetryDelay)
	}
}

func (m *Manager) readPID(path string) (int, bool, error) {
	content, err := m.readFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, false, nil
		}
		return 0, false, fmt.Errorf("read pid file %s: %w", path, err)
	}
	value := strings.TrimSpace(string(content))
	if value == "" {
		return 0, false, nil
	}
	pid, err := strconv.Atoi(value)
	if err != nil {
		return 0, false, fmt.Errorf("parse pid file %s: %w", path, err)
	}
	return pid, true, nil
}

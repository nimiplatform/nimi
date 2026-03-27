package engine

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type supervisorPIDMetadata struct {
	PID                    int        `json:"pid"`
	EngineKind             EngineKind `json:"engine_kind"`
	ExpectedExecutablePath string     `json:"expected_executable_path"`
}

func (s *Supervisor) pidMetadataPath() string {
	path := s.pidFilePath()
	if path == "" {
		return ""
	}
	return path + ".meta.json"
}

func (s *Supervisor) currentPIDMetadata() supervisorPIDMetadata {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return supervisorPIDMetadata{
		PID:                    s.pid,
		EngineKind:             s.cfg.Kind,
		ExpectedExecutablePath: canonicalSupervisorProcessPath(s.cfg.BinaryPath),
	}
}

func canonicalSupervisorProcessPath(path string) string {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return ""
	}
	absolutePath, err := filepath.Abs(trimmed)
	if err == nil {
		trimmed = absolutePath
	}
	if resolved, err := filepath.EvalSymlinks(trimmed); err == nil && strings.TrimSpace(resolved) != "" {
		trimmed = resolved
	}
	return filepath.Clean(trimmed)
}

func encodeSupervisorPIDMetadata(metadata supervisorPIDMetadata) ([]byte, error) {
	encoded, err := json.Marshal(metadata)
	if err != nil {
		return nil, fmt.Errorf("encode supervisor pid metadata: %w", err)
	}
	return encoded, nil
}

func readSupervisorPIDMetadata(path string) (supervisorPIDMetadata, error) {
	var metadata supervisorPIDMetadata
	raw, err := os.ReadFile(path)
	if err != nil {
		return metadata, err
	}
	if err := json.Unmarshal(raw, &metadata); err != nil {
		return metadata, fmt.Errorf("parse supervisor pid metadata: %w", err)
	}
	return metadata, nil
}

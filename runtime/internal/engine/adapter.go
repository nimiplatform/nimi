package engine

import (
	"context"
	"fmt"
	"time"
)

// ServiceAdapter adapts Manager to the localruntime.EngineManager interface.
// This avoids an import cycle between engine and localruntime packages.
type ServiceAdapter struct {
	mgr *Manager
}

// NewServiceAdapter creates an adapter that bridges Manager to the service layer interface.
func NewServiceAdapter(mgr *Manager) *ServiceAdapter {
	return &ServiceAdapter{mgr: mgr}
}

// EngineInfo mirrors localruntime.EngineInfo to avoid import.
type EngineInfoDTO struct {
	Engine              string
	Version             string
	Endpoint            string
	Port                int
	Status              string
	PID                 int
	Platform            string
	BinaryPath          string
	BinarySizeBytes     int64
	StartedAt           string
	LastHealthyAt       string
	ConsecutiveFailures int
}

func (a *ServiceAdapter) ListEngines() []EngineInfoDTO {
	infos := a.mgr.ListEngines()
	result := make([]EngineInfoDTO, len(infos))
	for i, info := range infos {
		result[i] = supervisorInfoToDTO(info)
	}
	return result
}

func (a *ServiceAdapter) EnsureEngine(ctx context.Context, engineName string, version string) error {
	cfg, err := resolveEngineConfig(engineName, version, 0)
	if err != nil {
		return err
	}
	cfg = a.mgr.applyLocalAIPaths(cfg)
	_, err = a.mgr.EnsureEngine(ctx, cfg)
	return err
}

func (a *ServiceAdapter) StartEngine(ctx context.Context, engineName string, port int, version string) error {
	cfg, err := resolveEngineConfig(engineName, version, port)
	if err != nil {
		return err
	}
	cfg = a.mgr.applyLocalAIPaths(cfg)
	cfg, err = a.mgr.EnsureEngine(ctx, cfg)
	if err != nil {
		return fmt.Errorf("ensure engine before start: %w", err)
	}
	return a.mgr.StartEngine(ctx, cfg)
}

func (a *ServiceAdapter) StopEngine(engineName string) error {
	kind, err := parseEngineKind(engineName)
	if err != nil {
		return err
	}
	return a.mgr.StopEngine(kind)
}

func (a *ServiceAdapter) EngineStatus(engineName string) (EngineInfoDTO, error) {
	kind, err := parseEngineKind(engineName)
	if err != nil {
		return EngineInfoDTO{}, err
	}
	info, err := a.mgr.EngineStatus(kind)
	if err != nil {
		return EngineInfoDTO{}, err
	}
	return supervisorInfoToDTO(info), nil
}

func supervisorInfoToDTO(info SupervisorInfo) EngineInfoDTO {
	dto := EngineInfoDTO{
		Engine:              string(info.Kind),
		Version:             info.Version,
		Endpoint:            info.Endpoint,
		Port:                info.Port,
		Status:              string(info.Status),
		PID:                 info.PID,
		Platform:            PlatformString(),
		BinaryPath:          info.BinaryPath,
		BinarySizeBytes:     info.BinarySizeBytes,
		ConsecutiveFailures: info.ConsecutiveFailures,
	}
	if !info.StartedAt.IsZero() {
		dto.StartedAt = info.StartedAt.UTC().Format(time.RFC3339)
	}
	if !info.LastHealthyAt.IsZero() {
		dto.LastHealthyAt = info.LastHealthyAt.UTC().Format(time.RFC3339)
	}
	return dto
}

func resolveEngineConfig(engineName string, version string, port int) (EngineConfig, error) {
	kind, err := parseEngineKind(engineName)
	if err != nil {
		return EngineConfig{}, err
	}

	var cfg EngineConfig
	switch kind {
	case EngineLocalAI:
		cfg = DefaultLocalAIConfig()
	case EngineNexa:
		cfg = DefaultNexaConfig()
	default:
		return EngineConfig{}, fmt.Errorf("unknown engine: %s", engineName)
	}

	if version != "" {
		cfg.Version = version
	}
	if port > 0 {
		cfg.Port = port
	}
	return cfg, nil
}

func parseEngineKind(name string) (EngineKind, error) {
	switch EngineKind(name) {
	case EngineLocalAI:
		return EngineLocalAI, nil
	case EngineNexa:
		return EngineNexa, nil
	default:
		return "", fmt.Errorf("unknown engine kind: %q", name)
	}
}

package daemonctl

import (
	"context"
	"fmt"
	"io"
	"strings"
	"time"
)

type Mode string

const (
	ModeStopped          Mode = "stopped"
	ModeProtectedService Mode = "protected-service"
)

func (m Mode) String() string { return string(m) }

type Status struct {
	Mode          Mode   `json:"mode"`
	Process       string `json:"process"`
	PID           int    `json:"pid,omitempty"`
	HealthSummary string `json:"healthSummary,omitempty"`
	Version       string `json:"version,omitempty"`
}

func (s Status) ExitCode() int {
	if s.Process != "running" {
		return 1
	}
	return 0
}

type StartResult struct {
	Mode          Mode   `json:"mode"`
	PID           int    `json:"pid"`
	HealthSummary string `json:"healthSummary,omitempty"`
	Version       string `json:"version,omitempty"`
}

type StopResult struct {
	AlreadyStopped bool `json:"alreadyStopped"`
	Stopped        bool `json:"stopped"`
	PID            int  `json:"pid,omitempty"`
	Mode           Mode `json:"mode,omitempty"`
}

// protectedServiceController is the only production lifecycle authority on
// Windows. Its implementation calls the fixed NimiRuntime SCM service and
// never accepts a caller-selected executable, command line, or endpoint.
type protectedServiceController interface {
	Status() (protectedServiceStatus, error)
	Start(timeout time.Duration) (protectedServiceStatus, error)
	Stop(timeout time.Duration) (protectedServiceStatus, error)
}

type protectedServiceStatus struct {
	Running bool
	PID     int
	State   string
}

type Manager struct {
	version          string
	protectedService protectedServiceController
}

// @nimi-authority: rule.nimi.runtime.service-operations.r086
func NewManager(version string) *Manager {
	return &Manager{version: strings.TrimSpace(version), protectedService: newProtectedServiceController()}
}

func (m *Manager) Start(timeout time.Duration) (StartResult, error) {
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	controller := m.protectedService
	status, err := controller.Status()
	if err != nil {
		return StartResult{}, fmt.Errorf("query protected Runtime service: %w", err)
	}
	if status.Running {
		return StartResult{}, fmt.Errorf("protected Runtime service is already running")
	}
	status, err = controller.Start(timeout)
	if err != nil {
		return StartResult{}, fmt.Errorf("start protected Runtime service: %w", err)
	}
	if !status.Running || status.PID <= 0 {
		return StartResult{}, fmt.Errorf("protected Runtime service did not reach running state")
	}
	return StartResult{
		Mode:          ModeProtectedService,
		PID:           status.PID,
		HealthSummary: "protected-service-running",
		Version:       m.version,
	}, nil
}

func (m *Manager) Stop(timeout time.Duration) (StopResult, error) {
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	controller := m.protectedService
	status, err := controller.Status()
	if err != nil {
		return StopResult{}, fmt.Errorf("query protected Runtime service: %w", err)
	}
	if !status.Running {
		return StopResult{AlreadyStopped: true, Stopped: true, Mode: ModeProtectedService}, nil
	}
	stopped, err := controller.Stop(timeout)
	if err != nil {
		return StopResult{}, fmt.Errorf("stop protected Runtime service: %w", err)
	}
	if stopped.Running {
		return StopResult{}, fmt.Errorf("protected Runtime service did not stop")
	}
	return StopResult{Stopped: true, PID: status.PID, Mode: ModeProtectedService}, nil
}

func (m *Manager) Status() (Status, error) {
	status, err := m.protectedService.Status()
	if err != nil {
		return Status{}, fmt.Errorf("query protected Runtime service: %w", err)
	}
	if !status.Running {
		return Status{Mode: ModeProtectedService, Process: "stopped", HealthSummary: "protected-service-stopped", Version: m.version}, nil
	}
	return Status{
		Mode:          ModeProtectedService,
		Process:       "running",
		PID:           status.PID,
		HealthSummary: "protected-service-running",
		Version:       m.version,
	}, nil
}

func (m *Manager) PrintLogs(context.Context, io.Writer, int, bool) error {
	return fmt.Errorf("protected Runtime service logs are unavailable")
}

package engine

import (
	"context"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// StateChangeFunc is called when the engine transitions state.
type StateChangeFunc func(kind EngineKind, status EngineStatus, detail string)

// Supervisor manages the lifecycle of a single engine process.
type Supervisor struct {
	cfg     EngineConfig
	logger  *slog.Logger
	onState StateChangeFunc

	mu                  sync.RWMutex
	cmd                 *exec.Cmd
	status              EngineStatus
	pid                 int
	startedAt           time.Time
	lastHealthyAt       time.Time
	consecutiveFailures int
	cancel              context.CancelFunc
	runEpoch            uint64
}

// NewSupervisor creates a new engine process supervisor.
func NewSupervisor(cfg EngineConfig, logger *slog.Logger, onState StateChangeFunc) *Supervisor {
	if onState == nil {
		onState = func(EngineKind, EngineStatus, string) {}
	}
	return &Supervisor{
		cfg:     cfg,
		logger:  logger,
		onState: onState,
		status:  StatusStopped,
	}
}

// Start launches the engine process and begins health monitoring.
// It blocks until the engine is healthy or the startup timeout is exceeded.
func (s *Supervisor) Start(ctx context.Context) error {
	s.mu.Lock()
	if s.status == StatusStarting || s.status == StatusHealthy {
		s.mu.Unlock()
		return fmt.Errorf("engine %s already running", s.cfg.Kind)
	}

	port, err := resolvePort(s.cfg.Port)
	if err != nil {
		s.mu.Unlock()
		return fmt.Errorf("resolve port for %s: %w", s.cfg.Kind, err)
	}
	s.cfg.Port = port
	s.runEpoch++
	epoch := s.runEpoch
	s.mu.Unlock()

	// Clean up stale PID file from previous run.
	s.cleanStalePID()

	return s.spawn(ctx, epoch)
}

// Stop gracefully shuts down the engine process.
func (s *Supervisor) Stop() error {
	s.mu.Lock()
	cancel := s.cancel
	cmd := s.cmd
	s.runEpoch++
	s.cancel = nil
	s.cmd = nil
	s.pid = 0
	s.mu.Unlock()

	if cancel != nil {
		cancel()
	}

	if cmd == nil || cmd.Process == nil {
		s.setStatus(StatusStopped, "not running")
		s.removePIDFile()
		return nil
	}

	reaped := make(chan struct{})
	go func() {
		_, _ = cmd.Process.Wait()
		close(reaped)
	}()

	// SIGTERM first.
	if err := cmd.Process.Signal(syscall.SIGTERM); err != nil {
		// Process already dead.
		select {
		case <-reaped:
		case <-time.After(100 * time.Millisecond):
		}
		s.setStatus(StatusStopped, "process already exited")
		s.removePIDFile()
		return nil
	}

	select {
	case <-reaped:
		s.setStatus(StatusStopped, "graceful shutdown")
	case <-time.After(s.cfg.ShutdownTimeout):
		// Force kill.
		_ = cmd.Process.Signal(syscall.SIGKILL)
		select {
		case <-reaped:
		case <-time.After(1 * time.Second):
			s.logger.Warn("engine process did not reap after SIGKILL",
				"engine", s.cfg.Kind,
				"pid", cmd.Process.Pid,
			)
		}
		s.setStatus(StatusStopped, "force killed after timeout")
	}

	s.removePIDFile()
	return nil
}

// Status returns the current engine status.
func (s *Supervisor) Status() EngineStatus {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.status
}

// Info returns engine status details.
func (s *Supervisor) Info() SupervisorInfo {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var binarySize int64
	if s.cfg.BinaryPath != "" {
		if fi, err := os.Stat(s.cfg.BinaryPath); err == nil {
			binarySize = fi.Size()
		}
	}
	return SupervisorInfo{
		Kind:                s.cfg.Kind,
		Version:             s.cfg.Version,
		Port:                s.cfg.Port,
		Status:              s.status,
		PID:                 s.pid,
		StartedAt:           s.startedAt,
		LastHealthyAt:       s.lastHealthyAt,
		ConsecutiveFailures: s.consecutiveFailures,
		BinaryPath:          s.cfg.BinaryPath,
		BinarySizeBytes:     binarySize,
		Endpoint:            s.cfg.Endpoint(),
	}
}

// SupervisorInfo holds observable state of a supervised engine.
type SupervisorInfo struct {
	Kind                EngineKind
	Version             string
	Port                int
	Status              EngineStatus
	PID                 int
	StartedAt           time.Time
	LastHealthyAt       time.Time
	ConsecutiveFailures int
	BinaryPath          string
	BinarySizeBytes     int64
	Endpoint            string
}

func (s *Supervisor) spawn(ctx context.Context, epoch uint64) error {
	if !s.isRunEpochActive(epoch) {
		return nil
	}
	runCtx, cancel := context.WithCancel(ctx)
	s.mu.Lock()
	if s.runEpoch != epoch {
		s.mu.Unlock()
		cancel()
		return nil
	}
	s.cancel = cancel
	s.mu.Unlock()

	var cmd *exec.Cmd
	switch s.cfg.Kind {
	case EngineLocalAI:
		cmd = localAICommand(s.cfg)
	case EngineNexa:
		cmd = nexaCommand(s.cfg)
	default:
		cancel()
		return fmt.Errorf("unknown engine kind: %s", s.cfg.Kind)
	}

	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if !s.isRunEpochActive(epoch) {
		cancel()
		return nil
	}
	s.setStatus(StatusStarting, "spawning process")

	s.mu.Lock()
	if s.runEpoch != epoch {
		s.mu.Unlock()
		cancel()
		return nil
	}
	startErr := cmd.Start()
	if startErr != nil {
		s.mu.Unlock()
		cancel()
		s.setStatus(StatusStopped, fmt.Sprintf("start failed: %v", startErr))
		return fmt.Errorf("start engine %s: %w", s.cfg.Kind, startErr)
	}
	if s.runEpoch != epoch {
		pid := cmd.Process.Pid
		s.mu.Unlock()
		cancel()
		_ = syscall.Kill(pid, syscall.SIGKILL)
		return nil
	}
	s.cmd = cmd
	s.pid = cmd.Process.Pid
	s.startedAt = time.Now()
	s.mu.Unlock()

	s.writePIDFile()

	s.logger.Info("engine process started",
		"engine", s.cfg.Kind,
		"pid", cmd.Process.Pid,
		"port", s.cfg.Port,
	)

	// Wait for healthy.
	endpoint := s.cfg.Endpoint()
	probeInterval := 500 * time.Millisecond
	if err := WaitHealthy(runCtx, endpoint, s.cfg.HealthPath, s.cfg.HealthResponse, probeInterval, s.cfg.StartupTimeout); err != nil {
		if runCtx.Err() != nil || !s.isRunEpochActive(epoch) {
			s.removePIDFile()
			return nil
		}
		s.logger.Warn("engine startup health check failed",
			"engine", s.cfg.Kind,
			"error", err,
		)
		s.setStatus(StatusUnhealthy, fmt.Sprintf("startup health failed: %v", err))
		// Don't kill here — let the health loop handle restart.
	} else {
		s.mu.Lock()
		s.lastHealthyAt = time.Now()
		s.mu.Unlock()
		s.setStatus(StatusHealthy, "ready")
	}

	if !s.isRunEpochActive(epoch) {
		s.removePIDFile()
		return nil
	}

	// Start health monitoring + process watchdog.
	go s.monitor(runCtx, epoch)

	return nil
}

func (s *Supervisor) monitor(ctx context.Context, epoch uint64) {
	healthTicker := time.NewTicker(s.cfg.HealthInterval)
	defer healthTicker.Stop()

	processDone := make(chan error, 1)
	go func() {
		s.mu.RLock()
		cmd := s.cmd
		s.mu.RUnlock()
		if cmd != nil {
			processDone <- cmd.Wait()
		}
	}()

	for {
		// Prioritize crash handling: if process exited, do not keep incrementing
		// health failure counters in a race with processDone.
		select {
		case <-ctx.Done():
			return
		case err := <-processDone:
			if !s.isRunEpochActive(epoch) {
				return
			}
			s.logger.Warn("engine process exited unexpectedly",
				"engine", s.cfg.Kind,
				"error", err,
			)
			s.handleCrash(ctx, err, epoch)
			return
		default:
		}

		select {
		case <-ctx.Done():
			return
		case err := <-processDone:
			if !s.isRunEpochActive(epoch) {
				return
			}
			s.logger.Warn("engine process exited unexpectedly",
				"engine", s.cfg.Kind,
				"error", err,
			)
			s.handleCrash(ctx, err, epoch)
			return
		case <-healthTicker.C:
			if !s.isRunEpochActive(epoch) {
				return
			}
			currentStatus := s.Status()
			if currentStatus != StatusHealthy && currentStatus != StatusStarting {
				continue
			}
			endpoint := s.cfg.Endpoint()
			if err := ProbeHealth(ctx, endpoint, s.cfg.HealthPath, s.cfg.HealthResponse); err != nil {
				s.mu.Lock()
				s.consecutiveFailures++
				failures := s.consecutiveFailures
				s.mu.Unlock()

				s.logger.Warn("engine health probe failed",
					"engine", s.cfg.Kind,
					"failures", failures,
					"error", err,
				)

				if failures >= s.cfg.MaxRestarts {
					s.setStatus(StatusUnhealthy, fmt.Sprintf("max failures reached (%d)", failures))
				}
			} else {
				s.mu.Lock()
				s.consecutiveFailures = 0
				s.lastHealthyAt = time.Now()
				s.mu.Unlock()

				if s.Status() == StatusUnhealthy {
					s.setStatus(StatusHealthy, "recovered")
				}
			}
		}
	}
}

func (s *Supervisor) handleCrash(ctx context.Context, procErr error, epoch uint64) {
	if !s.isRunEpochActive(epoch) {
		return
	}
	s.mu.Lock()
	if s.runEpoch != epoch {
		s.mu.Unlock()
		return
	}
	s.consecutiveFailures++
	failures := s.consecutiveFailures
	s.mu.Unlock()

	crashDetail := "process exited"
	if procErr != nil {
		crashDetail = strings.TrimSpace(procErr.Error())
	}
	if failures >= s.cfg.MaxRestarts {
		s.setStatus(StatusUnhealthy, fmt.Sprintf("crash=%s attempt=%d/%d", crashDetail, failures, s.cfg.MaxRestarts))
		s.removePIDFile()
		return
	}

	// Exponential backoff with jitter.
	delay := s.cfg.RestartBaseDelay
	for i := 1; i < failures; i++ {
		delay *= 2
		if delay > 30*time.Second {
			delay = 30 * time.Second
			break
		}
	}
	jitter := time.Duration(rand.Int64N(int64(time.Second)))
	delay += jitter

	s.setStatus(StatusUnhealthy, fmt.Sprintf("crash=%s attempt=%d/%d restarting", crashDetail, failures, s.cfg.MaxRestarts))
	s.logger.Info("restarting engine after crash",
		"engine", s.cfg.Kind,
		"attempt", failures,
		"delay", delay,
	)

	select {
	case <-ctx.Done():
		return
	case <-time.After(delay):
	}

	if !s.isRunEpochActive(epoch) {
		return
	}
	if err := s.spawn(ctx, epoch); err != nil {
		s.logger.Error("engine restart failed",
			"engine", s.cfg.Kind,
			"error", err,
		)
	}
}

func (s *Supervisor) setStatus(status EngineStatus, detail string) {
	s.mu.Lock()
	prev := s.status
	s.status = status
	s.mu.Unlock()

	if prev != status {
		s.onState(s.cfg.Kind, status, detail)
	}
}

// PID file management for zombie cleanup.

func (s *Supervisor) pidFilePath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".nimi", "engines", string(s.cfg.Kind), "supervised.pid")
}

func (s *Supervisor) writePIDFile() {
	path := s.pidFilePath()
	if path == "" {
		return
	}
	_ = os.MkdirAll(filepath.Dir(path), 0o755)
	s.mu.RLock()
	pid := s.pid
	s.mu.RUnlock()
	_ = os.WriteFile(path, []byte(strconv.Itoa(pid)), 0o644)
}

func (s *Supervisor) removePIDFile() {
	path := s.pidFilePath()
	if path != "" {
		_ = os.Remove(path)
	}
}

func (s *Supervisor) cleanStalePID() {
	path := s.pidFilePath()
	if path == "" {
		return
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil || pid <= 0 {
		_ = os.Remove(path)
		return
	}

	process, err := os.FindProcess(pid)
	if err != nil {
		_ = os.Remove(path)
		return
	}

	// Check if process is still alive (signal 0 test).
	if err := process.Signal(syscall.Signal(0)); err != nil {
		// Process is dead — clean up.
		_ = os.Remove(path)
		return
	}

	// Process is alive — kill it.
	s.logger.Warn("killing stale engine process",
		"engine", s.cfg.Kind,
		"pid", pid,
	)
	_ = process.Signal(syscall.SIGTERM)
	time.Sleep(2 * time.Second)
	_ = process.Signal(syscall.SIGKILL)
	_ = os.Remove(path)
}

// Port resolution.

// resolvePort checks if the desired port is available and tries alternatives.
func resolvePort(desired int) (int, error) {
	if portAvailable(desired) {
		return desired, nil
	}
	// Try up to 10 consecutive ports.
	for offset := 1; offset <= 10; offset++ {
		candidate := desired + offset
		if portAvailable(candidate) {
			return candidate, nil
		}
	}
	return 0, fmt.Errorf("no available port found near %d", desired)
}

func portAvailable(port int) bool {
	ln, err := net.Listen("tcp", "127.0.0.1:"+strconv.Itoa(port))
	if err != nil {
		return false
	}
	ln.Close()
	return true
}

func (s *Supervisor) isRunEpochActive(epoch uint64) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.runEpoch == epoch
}

func processAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	return syscall.Kill(pid, 0) == nil
}

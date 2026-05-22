package engine

import (
	"context"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"os"
	"os/exec"
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
	process             *supervisedProcess
	status              EngineStatus
	pid                 int
	startedAt           time.Time
	lastHealthyAt       time.Time
	consecutiveFailures int
	healthProbeFailures int
	cancel              context.CancelFunc
	runEpoch            uint64
	stderrTail          []string
	processLogPhase     string
}

const maxConsecutiveHealthProbeFailures = 3
const supervisorStderrTailLines = 8

type supervisedProcess struct {
	cmd     *exec.Cmd
	done    chan struct{}
	waitErr error
	release func()
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
	s.mu.Unlock()

	// Clean up stale PID from a previous run before resolving the configured
	// port. Stale supervised processes often fail precisely by leaving the
	// listener bound, so port resolution must not short-circuit stale cleanup.
	s.cleanStalePID()

	s.mu.Lock()
	// Resolve the configured port with a bounded reclaim wait: a process the
	// supervisor just killed (or an orphan from a prior runtime instance) can
	// hold the listener socket for a brief moment after the process exits, so
	// a single immediate availability check would spuriously fail.
	port, err := resolvePortWithReclaim(s.cfg.Port, portReclaimWait)
	if err != nil {
		s.mu.Unlock()
		return fmt.Errorf("resolve port for %s: %w", s.cfg.Kind, err)
	}
	s.cfg.Port = port
	s.runEpoch++
	epoch := s.runEpoch
	s.mu.Unlock()

	return s.spawn(ctx, epoch)
}

// Stop gracefully shuts down the engine process.
func (s *Supervisor) Stop() error {
	s.mu.Lock()
	cancel := s.cancel
	cmd := s.cmd
	process := s.process
	s.runEpoch++
	s.cancel = nil
	s.cmd = nil
	s.process = nil
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

	pid := cmd.Process.Pid

	// SIGTERM first — try the process group, then fall back to direct PID.
	// The process may have changed its PGID (e.g. setsid), so a group
	// signal can return ESRCH even though the process is still alive.
	if err := signalSupervisorProcess(pid, syscall.SIGTERM); err != nil {
		_ = signalSupervisorProcessDirect(pid, syscall.SIGTERM)
	}

	if waitSupervisorProcessExit(process, pid, s.cfg.ShutdownTimeout) {
		s.setStatus(StatusStopped, "graceful shutdown")
		s.removePIDFile()
		return nil
	}

	// Force kill — group first, then direct PID as fallback.
	if err := signalSupervisorProcess(pid, syscall.SIGKILL); err != nil {
		_ = signalSupervisorProcessDirect(pid, syscall.SIGKILL)
	}
	if waitSupervisorProcessExit(process, pid, time.Second) {
		s.setStatus(StatusStopped, "force killed after timeout")
		s.removePIDFile()
		return nil
	}

	s.logger.Warn("engine process remained alive after SIGKILL",
		"engine", s.cfg.Kind,
		"pid", pid,
	)
	s.setStatus(StatusUnhealthy, "shutdown failed: process remained alive after SIGKILL")
	return fmt.Errorf("stop engine %s: process %d remained alive after SIGKILL", s.cfg.Kind, pid)
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

// SetStateForTesting allows higher-level package tests to seed supervisor
// state without mutating unexported fields via reflection.
func (s *Supervisor) SetStateForTesting(status EngineStatus, lastHealthyAt time.Time) {
	s.mu.Lock()
	s.status = status
	s.lastHealthyAt = lastHealthyAt
	s.mu.Unlock()
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

	var (
		cmd *exec.Cmd
		err error
	)
	switch s.cfg.Kind {
	case EngineLlama:
		cmd, err = llamaCommand(s.cfg)
		if err != nil {
			cancel()
			return err
		}
	default:
		if strings.TrimSpace(s.cfg.BinaryPath) == "" {
			cancel()
			return fmt.Errorf("binary path required for engine %s", s.cfg.Kind)
		}
		cmd = exec.Command(s.cfg.BinaryPath, s.cfg.CommandArgs...)
	}
	if strings.TrimSpace(s.cfg.WorkingDir) != "" {
		cmd.Dir = s.cfg.WorkingDir
	}
	setSupervisorProcessGroup(cmd)
	if len(s.cfg.CommandEnv) > 0 {
		env := os.Environ()
		for key, value := range s.cfg.CommandEnv {
			trimmedKey := strings.TrimSpace(key)
			if trimmedKey == "" {
				continue
			}
			env = append(env, trimmedKey+"="+value)
		}
		cmd.Env = env
	}

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		return fmt.Errorf("capture stdout for engine %s: %w", s.cfg.Kind, err)
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		cancel()
		return fmt.Errorf("capture stderr for engine %s: %w", s.cfg.Kind, err)
	}

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
		s.mu.Unlock()
		cancel()
		if cmd.Process != nil {
			waitDone := make(chan struct{})
			go func() {
				_ = cmd.Wait()
				close(waitDone)
			}()
			_ = signalSupervisorProcess(cmd.Process.Pid, syscall.SIGKILL)
			select {
			case <-waitDone:
			case <-time.After(3 * time.Second):
			}
		}
		return nil
	}
	processRelease, lifecycleErr := bindSupervisorProcessLifecycle(cmd)
	if lifecycleErr != nil {
		s.mu.Unlock()
		cancel()
		if cmd.Process != nil {
			waitDone := make(chan struct{})
			go func() {
				_ = cmd.Wait()
				close(waitDone)
			}()
			_ = signalSupervisorProcess(cmd.Process.Pid, syscall.SIGKILL)
			select {
			case <-waitDone:
			case <-time.After(3 * time.Second):
			}
		}
		s.setStatus(StatusStopped, fmt.Sprintf("start failed: %v", lifecycleErr))
		return fmt.Errorf("bind engine %s process lifecycle: %w", s.cfg.Kind, lifecycleErr)
	}
	s.cmd = cmd
	process := &supervisedProcess{
		cmd:     cmd,
		done:    make(chan struct{}),
		release: processRelease,
	}
	s.process = process
	s.pid = cmd.Process.Pid
	s.startedAt = time.Now()
	s.stderrTail = nil
	s.mu.Unlock()

	go waitSupervisorProcess(process)
	go s.streamProcessLogs(stdoutPipe, "stdout", slog.LevelInfo)
	go s.streamProcessLogs(stderrPipe, "stderr", slog.LevelWarn)
	s.writePIDFile()

	s.logger.Info("engine process started",
		"engine", s.cfg.Kind,
		"pid", cmd.Process.Pid,
		"port", s.cfg.Port,
	)

	// Wait for healthy. The health wait races against process exit: a
	// supervised process that exits immediately (e.g. speech failing to bind
	// its port) must fail the startup wait in seconds, not block the full
	// StartupTimeout on a dead process.
	probeInterval := 500 * time.Millisecond
	if err := waitSupervisorHealthyOrExit(runCtx, s.cfg, process, probeInterval); err != nil {
		if runCtx.Err() != nil || !s.isRunEpochActive(epoch) {
			s.removePIDFile()
			return nil
		}
		s.writePIDFile()
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
		s.writePIDFile()
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

func restartJitterCap(delay time.Duration) time.Duration {
	if delay <= 0 {
		return 0
	}
	return minDuration(delay, time.Second)
}

func (s *Supervisor) monitor(ctx context.Context, epoch uint64) {
	healthTicker := time.NewTicker(s.cfg.HealthInterval)
	defer healthTicker.Stop()

	process := s.currentProcess()
	if process == nil {
		return
	}

	for {
		// Prioritize crash handling: if the process exited, do not keep
		// incrementing health failure counters in a race with process shutdown.
		if s.handleObservedProcessExit(ctx, process, epoch) {
			return
		}

		select {
		case <-ctx.Done():
			return
		case <-process.done:
			s.handleExitedProcess(ctx, process, epoch)
			return
		case <-healthTicker.C:
			if !s.isRunEpochActive(epoch) {
				return
			}
			currentStatus := s.Status()
			if currentStatus != StatusHealthy && currentStatus != StatusStarting {
				continue
			}
			if err := probeSupervisorHealth(ctx, s.cfg); err != nil {
				s.mu.Lock()
				s.healthProbeFailures++
				failures := s.healthProbeFailures
				s.mu.Unlock()

				s.logger.Warn("engine health probe failed",
					"engine", s.cfg.Kind,
					"health_failures", failures,
					"error", err,
				)

				if failures >= maxConsecutiveHealthProbeFailures {
					s.setStatus(StatusUnhealthy, fmt.Sprintf("max health probe failures reached (%d)", failures))
				}
			} else {
				s.mu.Lock()
				s.healthProbeFailures = 0
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

func (s *Supervisor) handleCrash(ctx context.Context, crashDetail string, epoch uint64) {
	if !s.isRunEpochActive(epoch) {
		return
	}
	s.mu.Lock()
	if s.runEpoch != epoch {
		s.mu.Unlock()
		return
	}
	s.consecutiveFailures++
	s.healthProbeFailures = 0
	failures := s.consecutiveFailures
	s.mu.Unlock()

	crashDetail = strings.TrimSpace(crashDetail)
	if crashDetail == "" {
		crashDetail = "process exited"
	}
	if failures >= s.cfg.MaxRestarts {
		s.setStatus(StatusUnhealthy, fmt.Sprintf("crash=%s attempt=%d/%d", crashDetail, failures, s.cfg.MaxRestarts))
		s.removePIDFile()
		return
	}

	// Exponential backoff with bounded jitter. Keep the jitter proportional to
	// the current delay so short test backoffs do not balloon into second-long
	// waits under load.
	delay := s.cfg.RestartBaseDelay
	for i := 1; i < failures; i++ {
		delay *= 2
		if delay > 30*time.Second {
			delay = 30 * time.Second
			break
		}
	}
	jitterCap := restartJitterCap(delay)
	if jitterCap > 0 {
		delay += time.Duration(rand.Int64N(int64(jitterCap)))
	}

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

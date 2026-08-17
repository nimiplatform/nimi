package engine

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"os"
	"os/exec"
	"sort"
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
	statusDetail        string
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

// @nimi-authority: rule.nimi.runtime.local-compute.r035
// Some CUDA-backed image hosts need several seconds to finish teardown after
// forced termination. Keep the verification bounded while avoiding a false
// failure during that normal release window.
const supervisorForceTerminationWait = 12 * time.Second

type supervisedProcess struct {
	cmd                  *exec.Cmd
	done                 chan struct{}
	lifecycle            *supervisorProcessLifecycle
	lifecycleWaitTimeout time.Duration

	mu           sync.Mutex
	stopping     bool
	waitErr      error
	lifecycleErr error
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
	if s.status == StatusStarting || s.status == StatusHealthy || supervisedProcessBlocksStart(s.process) {
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
	if process != nil {
		process.markStopping()
	}
	s.runEpoch++
	s.cancel = nil
	s.mu.Unlock()

	if cancel != nil {
		cancel()
	}

	if cmd == nil || cmd.Process == nil {
		s.clearStoppedProcess(process)
		s.setStatus(StatusStopped, "not running")
		s.removePIDFile()
		return nil
	}

	pid := cmd.Process.Pid

	// Windows has no service-safe SIGTERM equivalent for CREATE_NO_WINDOW
	// processes. Do not spend the graceful timeout waiting for a signal the
	// platform cannot deliver; terminate the tracked Job Object immediately.
	if supervisorProcessLifecycleSupportsGracefulTermination(processLifecycle(process)) {
		if err := signalTrackedSupervisorProcess(process, pid, syscall.SIGTERM); err != nil {
			_ = signalSupervisorProcessDirect(pid, syscall.SIGTERM)
		}

		if waitSupervisorProcessExit(process, pid, s.cfg.ShutdownTimeout) {
			return s.finishStoppedProcess(process, "graceful shutdown")
		}
	}

	// Force termination targets the tracked process tree (a Job Object on
	// Windows and the process group on Unix), not only the parent PID.
	if err := signalTrackedSupervisorProcess(process, pid, syscall.SIGKILL); err != nil {
		if process != nil {
			process.recordLifecycleError(fmt.Errorf("force terminate supervised process tree: %w", err))
		}
	}
	if waitSupervisorProcessExit(process, pid, supervisorForceTerminationWait) {
		return s.finishStoppedProcess(process, "force terminated")
	}

	s.logger.Warn("engine process remained alive after SIGKILL",
		"engine", s.cfg.Kind,
		"pid", pid,
	)
	s.setStatus(StatusUnhealthy, "shutdown failed: process remained alive after SIGKILL")
	return fmt.Errorf("stop engine %s: process %d remained alive after SIGKILL", s.cfg.Kind, pid)
}

func (s *Supervisor) finishStoppedProcess(process *supervisedProcess, detail string) error {
	if process != nil {
		if err := process.lifecycleError(); err != nil {
			s.setStatus(StatusUnhealthy, fmt.Sprintf("shutdown failed: %v", err))
			return fmt.Errorf("stop engine %s: %w", s.cfg.Kind, err)
		}
	}
	s.clearStoppedProcess(process)
	s.setStatus(StatusStopped, detail)
	s.removePIDFile()
	return nil
}

func (s *Supervisor) clearStoppedProcess(process *supervisedProcess) {
	s.mu.Lock()
	if process == nil || s.process == process {
		s.cmd = nil
		s.process = nil
		s.pid = 0
	}
	s.mu.Unlock()
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
		Kind:                  s.cfg.Kind,
		Version:               s.cfg.Version,
		ExecutionHostIdentity: s.cfg.ExecutionHostIdentity,
		Port:                  s.cfg.Port,
		Status:                s.status,
		Detail:                s.statusDetail,
		PID:                   s.pid,
		StartedAt:             s.startedAt,
		LastHealthyAt:         s.lastHealthyAt,
		ConsecutiveFailures:   s.consecutiveFailures,
		BinaryPath:            s.cfg.BinaryPath,
		BinarySizeBytes:       binarySize,
		Endpoint:              s.cfg.Endpoint(),
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
	Kind                  EngineKind
	Version               string
	ExecutionHostIdentity string
	Port                  int
	Status                EngineStatus
	Detail                string
	PID                   int
	StartedAt             time.Time
	LastHealthyAt         time.Time
	ConsecutiveFailures   int
	BinaryPath            string
	BinarySizeBytes       int64
	Endpoint              string
}

func (s *Supervisor) spawn(ctx context.Context, epoch uint64) error {
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if !s.isRunEpochActive(epoch) {
		return nil
	}
	// The caller context bounds startup only. Once materialized, the cached
	// private Host must remain monitored until Supervisor.Stop cancels this
	// lifecycle context; a completed RPC/Job context must not silently detach
	// supervision from a reusable process.
	runCtx, cancel := context.WithCancel(context.Background())
	startupCtx, cancelStartup := context.WithCancel(runCtx)
	stopStartupContext := context.AfterFunc(ctx, cancelStartup)
	defer func() {
		stopStartupContext()
		cancelStartup()
	}()
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
		cmd = exec.Command(supervisorCommandExecutablePath(s.cfg), s.cfg.CommandArgs...)
	}
	if strings.TrimSpace(s.cfg.WorkingDir) != "" {
		cmd.Dir = s.cfg.WorkingDir
	}
	setSupervisorProcessGroup(cmd)
	if len(s.cfg.CommandEnv) > 0 {
		cmd.Env = mergeSupervisorCommandEnv(os.Environ(), s.cfg.CommandEnv)
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
	if err := ctx.Err(); err != nil {
		cancel()
		return err
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
	processLifecycle, lifecycleErr := bindSupervisorProcessLifecycle(cmd)
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
		cmd:                  cmd,
		done:                 make(chan struct{}),
		lifecycle:            processLifecycle,
		lifecycleWaitTimeout: supervisorLifecycleWaitTimeout(s.cfg.ShutdownTimeout),
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
		"event", "engine.process.started",
		"engine", s.cfg.Kind,
		"pid", cmd.Process.Pid,
		"port", s.cfg.Port,
		"endpoint", s.cfg.Endpoint(),
	)

	// Wait for healthy. The health wait races against process exit: a
	// supervised process that exits immediately (e.g. speech failing to bind
	// its port) must fail the startup wait in seconds, not block the full
	// StartupTimeout on a dead process.
	probeInterval := 500 * time.Millisecond
	if err := waitSupervisorHealthyOrExit(startupCtx, s.cfg, process, probeInterval); err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil && s.isRunEpochActive(epoch) {
			return s.stopCanceledStart(ctxErr)
		}
		if runCtx.Err() != nil || !s.isRunEpochActive(epoch) {
			s.removePIDFile()
			return nil
		}
		s.writePIDFile()
		s.logger.Warn("engine startup health check failed",
			"event", "engine.process.startup_health_failed",
			"engine", s.cfg.Kind,
			"error", err,
		)
		s.setStatus(StatusUnhealthy, fmt.Sprintf("startup health failed: %v", err))
		// Don't kill here — let the health loop handle restart.
	} else {
		now := time.Now()
		s.mu.Lock()
		startedAt := s.startedAt
		s.lastHealthyAt = now
		s.mu.Unlock()
		s.writePIDFile()
		attrs := []any{
			"event", "engine.process.healthy",
			"engine", s.cfg.Kind,
			"pid", cmd.Process.Pid,
			"port", s.cfg.Port,
			"endpoint", s.cfg.Endpoint(),
		}
		if !startedAt.IsZero() {
			attrs = append(attrs, "startup_duration_ms", now.Sub(startedAt).Milliseconds())
		}
		s.logger.Info("engine process healthy", attrs...)
		s.setStatus(StatusHealthy, "ready")
	}

	if ctxErr := ctx.Err(); ctxErr != nil && s.isRunEpochActive(epoch) {
		return s.stopCanceledStart(ctxErr)
	}
	if !s.isRunEpochActive(epoch) {
		s.removePIDFile()
		return nil
	}

	// Start health monitoring + process watchdog.
	go s.monitor(runCtx, epoch)

	return nil
}

func (s *Supervisor) stopCanceledStart(cancelErr error) error {
	if cancelErr == nil {
		cancelErr = context.Canceled
	}
	if stopErr := s.Stop(); stopErr != nil {
		return errors.Join(cancelErr, fmt.Errorf("stop engine %s after startup cancellation: %w", s.cfg.Kind, stopErr))
	}
	return cancelErr
}

func supervisorCommandExecutablePath(cfg EngineConfig) string {
	switch cfg.Kind {
	case EngineMedia, EngineSpeech:
		// Keep BinaryPath canonical for status and process-identity projections.
		// Only the Windows process launch adapter consumes the shorter alias so
		// CPython derives a legacy-safe sys.prefix for deeply nested packages.
		return managedCommandPreferredPath(cfg.BinaryPath)
	default:
		return cfg.BinaryPath
	}
}

func mergeSupervisorCommandEnv(base []string, overrides map[string]string) []string {
	env := append([]string(nil), base...)
	if len(overrides) == 0 {
		return env
	}
	keys := make([]string, 0, len(overrides))
	for key := range overrides {
		trimmedKey := strings.TrimSpace(key)
		if trimmedKey != "" {
			keys = append(keys, trimmedKey)
		}
	}
	sort.Strings(keys)
	for _, key := range keys {
		env = upsertSupervisorCommandEnvValue(env, key, overrides[key])
	}
	return env
}

func upsertSupervisorCommandEnvValue(env []string, key string, value string) []string {
	prefix := strings.TrimSpace(key) + "="
	for index, entry := range env {
		name, _, ok := strings.Cut(entry, "=")
		if !ok || !supervisorEnvKeyEqual(name, key) {
			continue
		}
		env[index] = prefix + value
		return env
	}
	return append(env, prefix+value)
}

func supervisorEnvKeyEqual(left string, right string) bool {
	if currentGOOS() == "windows" {
		return strings.EqualFold(strings.TrimSpace(left), strings.TrimSpace(right))
	}
	return strings.TrimSpace(left) == strings.TrimSpace(right)
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
					"event", "engine.process.health_probe_failed",
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
		"event", "engine.process.restart_scheduled",
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
			"event", "engine.process.restart_failed",
			"engine", s.cfg.Kind,
			"error", err,
		)
	}
}

func (s *Supervisor) setStatus(status EngineStatus, detail string) {
	s.mu.Lock()
	prev := s.status
	s.status = status
	s.statusDetail = boundedSupervisorStatusDetail(detail)
	s.mu.Unlock()

	if prev != status {
		s.onState(s.cfg.Kind, status, detail)
	}
}

func boundedSupervisorStatusDetail(detail string) string {
	const maxStatusDetailBytes = 4096
	trimmed := strings.TrimSpace(detail)
	if len(trimmed) <= maxStatusDetailBytes {
		return trimmed
	}
	return strings.TrimSpace(strings.ToValidUTF8(trimmed[:maxStatusDetailBytes], ""))
}

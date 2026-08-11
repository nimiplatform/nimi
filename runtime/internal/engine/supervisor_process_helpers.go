package engine

import (
	"context"
	"fmt"
	"strings"
	"syscall"
	"time"
)

func waitSupervisorProcess(process *supervisedProcess) {
	if process == nil || process.cmd == nil {
		return
	}
	process.setWaitErr(process.cmd.Wait())

	// A parent can exit while descendants continue running. Unexpected parent
	// exit therefore force-cleans the tracked tree before publishing done; an
	// explicit Stop owns its graceful/force phases and the waiter only observes
	// the resulting tree exit.
	if !process.isStopping() {
		exited, err := supervisorProcessLifecycleExited(process.lifecycle)
		if err != nil {
			process.recordLifecycleError(fmt.Errorf("query supervised process tree: %w", err))
		} else if !exited {
			if err := signalSupervisorProcessLifecycle(process.lifecycle, syscall.SIGKILL); err != nil {
				process.recordLifecycleError(fmt.Errorf("clean process tree after parent exit: %w", err))
			}
		}
	}

	waitTimeout := process.lifecycleWaitTimeout
	if waitTimeout <= 0 {
		waitTimeout = 3 * time.Second
	}
	deadline := time.Now().Add(waitTimeout)
	for {
		exited, err := supervisorProcessLifecycleExited(process.lifecycle)
		if err != nil {
			process.recordLifecycleError(fmt.Errorf("wait for supervised process tree: %w", err))
			break
		}
		if exited {
			break
		}
		if time.Now().After(deadline) {
			process.recordLifecycleError(fmt.Errorf("timed out after %s waiting for supervised process tree exit", waitTimeout))
			if err := signalSupervisorProcessLifecycle(process.lifecycle, syscall.SIGKILL); err != nil {
				process.recordLifecycleError(fmt.Errorf("force process tree after lifecycle wait timeout: %w", err))
			}
			break
		}
		time.Sleep(25 * time.Millisecond)
	}
	if err := releaseSupervisorProcessLifecycle(process.lifecycle); err != nil {
		process.recordLifecycleError(fmt.Errorf("release supervised process lifecycle: %w", err))
	}
	close(process.done)
}

func supervisorLifecycleWaitTimeout(shutdownTimeout time.Duration) time.Duration {
	if shutdownTimeout <= 0 {
		shutdownTimeout = 100 * time.Millisecond
	}
	// Allow Stop's graceful phase plus its bounded force phase to complete,
	// while ensuring an unexpected parent exit cannot leave a waiter forever.
	return shutdownTimeout + 2*time.Second
}

func processLifecycle(process *supervisedProcess) *supervisorProcessLifecycle {
	if process == nil {
		return nil
	}
	return process.lifecycle
}

func supervisedProcessBlocksStart(process *supervisedProcess) bool {
	if process == nil {
		return false
	}
	if process.lifecycleError() != nil {
		return true
	}
	select {
	case <-process.done:
		return false
	default:
		return true
	}
}

func signalTrackedSupervisorProcess(process *supervisedProcess, pid int, sig syscall.Signal) error {
	if process != nil && process.lifecycle != nil {
		return signalSupervisorProcessLifecycle(process.lifecycle, sig)
	}
	if err := signalSupervisorProcess(pid, sig); err != nil {
		return signalSupervisorProcessDirect(pid, sig)
	}
	return nil
}

func (process *supervisedProcess) markStopping() {
	if process == nil {
		return
	}
	process.mu.Lock()
	process.stopping = true
	process.mu.Unlock()
}

func (process *supervisedProcess) isStopping() bool {
	if process == nil {
		return false
	}
	process.mu.Lock()
	defer process.mu.Unlock()
	return process.stopping
}

func (process *supervisedProcess) setWaitErr(err error) {
	process.mu.Lock()
	process.waitErr = err
	process.mu.Unlock()
}

func (process *supervisedProcess) waitError() error {
	if process == nil {
		return nil
	}
	process.mu.Lock()
	defer process.mu.Unlock()
	return process.waitErr
}

func (process *supervisedProcess) recordLifecycleError(err error) {
	if process == nil || err == nil {
		return
	}
	process.mu.Lock()
	defer process.mu.Unlock()
	if process.lifecycleErr == nil {
		process.lifecycleErr = err
		return
	}
	process.lifecycleErr = fmt.Errorf("%v; %w", process.lifecycleErr, err)
}

func (process *supervisedProcess) lifecycleError() error {
	if process == nil {
		return nil
	}
	process.mu.Lock()
	defer process.mu.Unlock()
	return process.lifecycleErr
}

func (s *Supervisor) currentProcess() *supervisedProcess {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.process
}

func (s *Supervisor) handleObservedProcessExit(ctx context.Context, process *supervisedProcess, epoch uint64) bool {
	if process == nil {
		return false
	}
	select {
	case <-ctx.Done():
		return true
	case <-process.done:
		s.handleExitedProcess(ctx, process, epoch)
		return true
	default:
		return false
	}
}

func (s *Supervisor) handleExitedProcess(ctx context.Context, process *supervisedProcess, epoch uint64) {
	if !s.isRunEpochActive(epoch) {
		return
	}
	if lifecycleErr := process.lifecycleError(); lifecycleErr != nil {
		detail := fmt.Sprintf("process tree cleanup failed: %v", lifecycleErr)
		s.logger.Error("engine process tree cleanup failed",
			"event", "engine.process.cleanup_failed",
			"engine", s.cfg.Kind,
			"error", lifecycleErr,
		)
		s.setStatus(StatusUnhealthy, detail)
		return
	}
	crashDetail := s.buildCrashDetail(process.waitError())
	s.logger.Warn("engine process exited unexpectedly",
		"event", "engine.process.exited_unexpectedly",
		"engine", s.cfg.Kind,
		"error", crashDetail,
	)
	s.handleCrash(ctx, crashDetail, epoch)
}

func (s *Supervisor) buildCrashDetail(waitErr error) string {
	stage := "runtime"
	if s.Status() == StatusStarting {
		stage = "startup"
	}
	parts := []string{fmt.Sprintf("stage=%s", stage)}
	if waitErr != nil {
		parts = append(parts, strings.TrimSpace(waitErr.Error()))
	}
	s.mu.RLock()
	stderrTail := append([]string(nil), s.stderrTail...)
	s.mu.RUnlock()
	if len(stderrTail) > 0 {
		parts = append(parts, "stderr_tail="+strings.Join(stderrTail, " | "))
	}
	return strings.TrimSpace(strings.Join(parts, "; "))
}

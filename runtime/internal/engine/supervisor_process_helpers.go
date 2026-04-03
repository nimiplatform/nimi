package engine

import (
	"context"
	"fmt"
	"strings"
)

func waitSupervisorProcess(process *supervisedProcess) {
	if process == nil || process.cmd == nil {
		return
	}
	if process.release != nil {
		defer process.release()
	}
	process.waitErr = process.cmd.Wait()
	close(process.done)
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
	crashDetail := s.buildCrashDetail(process.waitErr)
	s.logger.Warn("engine process exited unexpectedly",
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

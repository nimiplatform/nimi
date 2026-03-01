package workers

import (
	"context"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"os"
	"os/exec"
	"sync"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/workeripc"
)

// StateChangeHandler receives worker liveness transitions.
type StateChangeHandler func(name string, running bool, err error)

// Supervisor keeps worker subprocesses alive with restart semantics.
type Supervisor struct {
	logger        *slog.Logger
	binaryPath    string
	onStateChange StateChangeHandler

	mu      sync.RWMutex
	running map[string]bool
}

func New(logger *slog.Logger, binaryPath string, onStateChange StateChangeHandler) *Supervisor {
	return &Supervisor{
		logger:        logger,
		binaryPath:    binaryPath,
		onStateChange: onStateChange,
		running:       make(map[string]bool),
	}
}

func (s *Supervisor) Start(ctx context.Context, names []string) error {
	if len(names) == 0 {
		return nil
	}
	if err := workeripc.EnsureWorkerDir(); err != nil {
		return err
	}
	if s.binaryPath == "" {
		path, err := os.Executable()
		if err != nil {
			return fmt.Errorf("resolve executable for workers: %w", err)
		}
		s.binaryPath = path
	}
	for _, name := range names {
		workerName := name
		go s.loopWorker(ctx, workerName)
	}
	return nil
}

// backoffWithJitter returns the base backoff duration plus a uniform random
// jitter in [0, 500ms] to prevent thundering herd on mass restart (K-DAEMON-004).
func backoffWithJitter(base time.Duration) time.Duration {
	return base + time.Duration(rand.Int64N(500_000_000))
}

func (s *Supervisor) loopWorker(ctx context.Context, name string) {
	restartBackoff := 2 * time.Second
	socketPath, socketErr := workeripc.SocketPath(name)
	if socketErr != nil {
		s.markState(name, false, socketErr)
		return
	}
	for {
		if ctx.Err() != nil {
			return
		}
		cmd := exec.CommandContext(ctx, s.binaryPath, "worker", name)
		cmd.Env = append(os.Environ(),
			"NIMI_RUNTIME_WORKER_ROLE="+name,
			"NIMI_RUNTIME_WORKER_SOCKET="+socketPath,
		)
		if err := cmd.Start(); err != nil {
			s.markState(name, false, err)
			select {
			case <-ctx.Done():
				return
			case <-time.After(backoffWithJitter(restartBackoff)):
				continue
			}
		}
		s.markState(name, true, nil)
		err := cmd.Wait()
		if ctx.Err() != nil {
			return
		}
		s.markState(name, false, err)
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoffWithJitter(restartBackoff)):
		}
	}
}

func (s *Supervisor) markState(name string, running bool, err error) {
	name = normalizeWorkerName(name)
	if name == "" {
		return
	}
	s.mu.Lock()
	s.running[name] = running
	s.mu.Unlock()
	if s.onStateChange != nil {
		s.onStateChange(name, running, err)
	}
	if s.logger == nil {
		return
	}
	if running {
		s.logger.Info("worker running", "worker", name)
		return
	}
	s.logger.Warn("worker stopped", "worker", name, "error", err)
}

func (s *Supervisor) AllRunning(names []string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, name := range names {
		if !s.running[normalizeWorkerName(name)] {
			return false
		}
	}
	return true
}

func normalizeWorkerName(name string) string {
	switch name {
	case "ai", "model", "workflow", "script", "localruntime":
		return name
	default:
		return ""
	}
}

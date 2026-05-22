package engine

import (
	"context"
	"fmt"
	"net"
	"strings"
	"time"
)

// waitSupervisorHealthyOrExit waits for the supervised engine to become healthy
// while also watching for the process to exit. The health probe alone polls
// with a long StartupTimeout; if the process exits before becoming healthy
// (e.g. an immediate `address already in use` bind failure) the health wait
// would otherwise block the full timeout against a dead process. Selecting on
// process.done makes startup fail fast with the process exit error so the
// crash/backoff/restart cycle proceeds in seconds, not minutes.
func waitSupervisorHealthyOrExit(ctx context.Context, cfg EngineConfig, process *supervisedProcess, interval time.Duration) error {
	if process == nil {
		return waitSupervisorHealthy(ctx, cfg, interval)
	}
	healthCtx, cancelHealth := context.WithCancel(ctx)
	defer cancelHealth()

	healthResult := make(chan error, 1)
	go func() {
		healthResult <- waitSupervisorHealthy(healthCtx, cfg, interval)
	}()

	select {
	case err := <-healthResult:
		return err
	case <-process.done:
		// Cancel the in-flight health probe and reap its result so the
		// goroutine does not leak.
		cancelHealth()
		<-healthResult
		exitDetail := strings.TrimSpace(processExitErrorDetail(process.waitErr))
		if exitDetail == "" {
			exitDetail = "process exited during startup"
		}
		return fmt.Errorf("engine %s exited before becoming healthy: %s", cfg.Kind, exitDetail)
	}
}

// processExitErrorDetail renders a process Wait() error for inclusion in a
// startup failure message.
func processExitErrorDetail(waitErr error) string {
	if waitErr == nil {
		return "process exited with status 0"
	}
	return waitErr.Error()
}

func waitSupervisorHealthy(ctx context.Context, cfg EngineConfig, interval time.Duration) error {
	switch cfg.HealthMode {
	case HealthModeTCP:
		address := strings.TrimSpace(cfg.Address)
		if address == "" {
			return fmt.Errorf("tcp health address required")
		}
		return waitTCPHealthy(ctx, address, interval, cfg.StartupTimeout)
	default:
		if cfg.Kind == EngineMedia {
			return WaitMediaHealthy(ctx, cfg.Endpoint(), interval, cfg.StartupTimeout)
		}
		if cfg.Kind == EngineSpeech {
			return WaitSpeechHealthy(ctx, cfg.Endpoint(), interval, cfg.StartupTimeout)
		}
		return WaitHealthy(ctx, cfg.Endpoint(), cfg.HealthPath, cfg.HealthResponse, interval, cfg.StartupTimeout)
	}
}

func waitTCPHealthy(ctx context.Context, address string, interval time.Duration, timeout time.Duration) error {
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	deadlineCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		dialer := net.Dialer{Timeout: minDuration(interval, 2*time.Second)}
		conn, err := dialer.DialContext(deadlineCtx, "tcp", address)
		if err == nil {
			_ = conn.Close()
			return nil
		}
		select {
		case <-deadlineCtx.Done():
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return fmt.Errorf("tcp health timeout for %s: %w", address, err)
		case <-ticker.C:
		}
	}
}

func probeSupervisorHealth(ctx context.Context, cfg EngineConfig) error {
	switch cfg.HealthMode {
	case HealthModeTCP:
		address := strings.TrimSpace(cfg.Address)
		if address == "" {
			return fmt.Errorf("tcp health address required")
		}
		dialer := net.Dialer{Timeout: minDuration(cfg.HealthInterval, 2*time.Second)}
		conn, err := dialer.DialContext(ctx, "tcp", address)
		if err != nil {
			return err
		}
		_ = conn.Close()
		return nil
	default:
		if cfg.Kind == EngineMedia {
			return ProbeMediaHealth(ctx, cfg.Endpoint())
		}
		if cfg.Kind == EngineSpeech {
			return ProbeSpeechHealth(ctx, cfg.Endpoint())
		}
		return ProbeHealth(ctx, cfg.Endpoint(), cfg.HealthPath, cfg.HealthResponse)
	}
}

func minDuration(left time.Duration, right time.Duration) time.Duration {
	if left <= 0 {
		return right
	}
	if left < right {
		return left
	}
	return right
}

package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os/exec"
)

func runManagedCommand(
	ctx context.Context,
	cmd *exec.Cmd,
	stdout io.Writer,
	stderr io.Writer,
	progress *progressReporter,
) (bool, error) {
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	configureProcessTree(cmd)
	if err := cmd.Start(); err != nil {
		return false, fmt.Errorf("start %s: %w", cmd.Path, err)
	}
	return waitManagedCommand(ctx, cmd, progress)
}

func waitManagedCommand(ctx context.Context, cmd *exec.Cmd, progress *progressReporter) (bool, error) {
	done := make(chan error, 1)
	go func() {
		done <- cmd.Wait()
	}()

	select {
	case err := <-done:
		return false, err
	case <-ctx.Done():
		if progress != nil {
			progress.Timeout()
		}
		killErr := killProcessTree(cmd)
		waitErr := <-done
		return true, errors.Join(
			fmt.Errorf("command timed out: %w", ctx.Err()),
			killErr,
			ignoreExpectedKillError(waitErr),
		)
	}
}

func ignoreExpectedKillError(err error) error {
	if err == nil {
		return nil
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return nil
	}
	return err
}

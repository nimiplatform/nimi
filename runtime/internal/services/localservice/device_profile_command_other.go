//go:build !windows

package localservice

import (
	"context"
	"os/exec"
)

func newLocalRuntimeProbeCommand(ctx context.Context, name string, args ...string) *exec.Cmd {
	return exec.CommandContext(ctx, name, args...)
}

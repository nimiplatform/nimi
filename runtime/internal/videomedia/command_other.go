//go:build !windows

package videomedia

import (
	"context"
	"os/exec"
)

func newCodecCommand(ctx context.Context, executable string, args ...string) *exec.Cmd {
	return exec.CommandContext(ctx, executable, args...)
}

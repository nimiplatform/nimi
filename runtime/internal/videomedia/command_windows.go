package videomedia

import (
	"context"
	"os/exec"
	"syscall"

	"golang.org/x/sys/windows"
)

func newCodecCommand(ctx context.Context, executable string, args ...string) *exec.Cmd {
	command := exec.CommandContext(ctx, executable, args...)
	// Codec verification and media processing run in the restricted service,
	// where allocating a console can fail before the codec begins executing.
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: windows.CREATE_NO_WINDOW}
	return command
}

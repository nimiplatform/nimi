//go:build windows

package localservice

import (
	"context"
	"os/exec"
	"syscall"

	"golang.org/x/sys/windows"
)

func newLocalRuntimeProbeCommand(ctx context.Context, name string, args ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: windows.CREATE_NO_WINDOW,
	}
	return cmd
}

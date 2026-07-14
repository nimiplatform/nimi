//go:build !windows

package account

import (
	"context"
	"os/exec"
	runtimepkg "runtime"
)

func openExternalURL(ctx context.Context, rawURL string) error {
	command := "xdg-open"
	if runtimepkg.GOOS == "darwin" {
		command = "open"
	}
	return exec.CommandContext(ctx, command, rawURL).Start()
}

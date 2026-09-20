//go:build !windows

package audiomedia

import "os/exec"

func configureCodecCommand(_ *exec.Cmd) {}

//go:build !windows

package engine

import "os/exec"

func configureManagedCommand(_ *exec.Cmd) {}

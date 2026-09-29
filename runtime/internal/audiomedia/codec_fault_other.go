//go:build !windows

package audiomedia

import (
	"errors"
	"os/exec"
	"syscall"
)

// CodecCouldNotRun reports a codec process that gave no verdict on its input:
// it failed to start, or the OS ended it with a signal (a missing shared
// library aborts it before it reads anything). An ordinary non-zero exit is the
// codec's verdict on the input. Callers check their own cancellation first.
func CodecCouldNotRun(err error) bool {
	if err == nil {
		return false
	}
	var exitErr *exec.ExitError
	if !errors.As(err, &exitErr) {
		return true
	}
	status, ok := exitErr.Sys().(syscall.WaitStatus)
	return ok && status.Signaled()
}

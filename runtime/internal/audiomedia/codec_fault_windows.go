//go:build windows

package audiomedia

import (
	"errors"
	"os/exec"
)

// CodecCouldNotRun reports a codec process that gave no verdict on its input:
// it failed to start, or Windows ended it with an NTSTATUS failure such as a
// missing DLL (0xC0000135). An ordinary exit code is the codec's verdict on the
// input. Callers check their own cancellation first.
func CodecCouldNotRun(err error) bool {
	if err == nil {
		return false
	}
	var exitErr *exec.ExitError
	if !errors.As(err, &exitErr) {
		return true
	}
	return uint32(exitErr.ExitCode()) >= 0xC0000000
}

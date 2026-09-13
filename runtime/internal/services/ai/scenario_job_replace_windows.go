//go:build windows

package ai

import (
	"errors"
	"os"
	"time"

	"golang.org/x/sys/windows"
)

// The temporary snapshot is already synced and closed. Retry only the atomic
// replacement, using the same bounded Windows sharing policy as local state.
func replaceScenarioJobFileAtomically(source, target string) error {
	from, err := windows.UTF16PtrFromString(source)
	if err != nil {
		return &os.LinkError{Op: "rename", Old: source, New: target, Err: err}
	}
	to, err := windows.UTF16PtrFromString(target)
	if err != nil {
		return &os.LinkError{Op: "rename", Old: source, New: target, Err: err}
	}
	for attempt := 0; ; attempt++ {
		err = windows.MoveFileEx(from, to, windows.MOVEFILE_REPLACE_EXISTING|windows.MOVEFILE_WRITE_THROUGH)
		if err == nil {
			return nil
		}
		if attempt >= 19 || (!errors.Is(err, windows.ERROR_SHARING_VIOLATION) && !errors.Is(err, windows.ERROR_ACCESS_DENIED)) {
			return &os.LinkError{Op: "rename", Old: source, New: target, Err: err}
		}
		time.Sleep(5 * time.Millisecond)
	}
}

//go:build !windows

package daemon

import (
	"syscall"
	"time"
)

func runtimeCPUTime() time.Duration {
	var usage syscall.Rusage
	if syscall.Getrusage(syscall.RUSAGE_SELF, &usage) != nil {
		return 0
	}
	return time.Duration(usage.Utime.Nano() + usage.Stime.Nano())
}

// The current health wire uses zero for an unobserved counter. Do not
// attribute whole-device memory or unified system RAM to Runtime workers.
func runtimeVRAMBytes() int64 { return 0 }

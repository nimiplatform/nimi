//go:build !windows

package localservice

import (
	"context"
	"os"
	"strconv"
	"strings"
	"time"
)

// probeRAM returns total and available host RAM in bytes.
// On Linux: parses /proc/meminfo.
// On macOS: uses sysctl for total, vm.page_free_count for available estimate.
// Returns (0, 0) if probing fails.
func probeRAM() (totalBytes int64, availableBytes int64) {
	if localRuntimeGOOS == "linux" {
		return probeRAMLinux()
	}
	return probeRAMDarwin()
}

func probeRAMLinux() (int64, int64) {
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return 0, 0
	}
	var total, available int64
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		value, parseErr := strconv.ParseInt(fields[1], 10, 64)
		if parseErr != nil {
			continue
		}
		// /proc/meminfo reports in kB
		valueBytes := value * 1024
		switch {
		case strings.HasPrefix(line, "MemTotal:"):
			total = valueBytes
		case strings.HasPrefix(line, "MemAvailable:"):
			available = valueBytes
		}
	}
	return total, available
}

func probeRAMDarwin() (int64, int64) {
	total := sysctlInt64("hw.memsize")

	// macOS available memory approximation: free pages * page size.
	// This is a conservative estimate; macOS aggressively caches, so actual
	// "usable" memory is higher. For scheduling risk assessment, conservative is correct.
	pageSize := sysctlInt64("hw.pagesize")
	if pageSize <= 0 {
		pageSize = 16384 // Apple Silicon default
	}
	freePages := sysctlInt64("vm.page_free_count")
	var available int64
	if freePages > 0 {
		available = freePages * pageSize
	}

	return total, available
}

func sysctlInt64(key string) int64 {
	ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	defer cancel()
	out, err := localRuntimeCommand(ctx, "sysctl", "-n", key).Output()
	if err != nil {
		return 0
	}
	value, parseErr := strconv.ParseInt(strings.TrimSpace(string(out)), 10, 64)
	if parseErr != nil {
		return 0
	}
	return value
}

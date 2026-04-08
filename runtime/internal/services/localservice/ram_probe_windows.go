//go:build windows

package localservice

import "golang.org/x/sys/windows"

// probeRAM returns total and available host RAM in bytes using GlobalMemoryStatusEx.
func probeRAM() (totalBytes int64, availableBytes int64) {
	var memStatus windows.MEMORYSTATUSEX
	memStatus.Length = uint32(64) // sizeof(MEMORYSTATUSEX)
	if err := windows.GlobalMemoryStatusEx(&memStatus); err != nil {
		return 0, 0
	}
	total := memStatus.TotalPhys
	available := memStatus.AvailPhys
	maxInt64 := uint64(^uint64(0) >> 1)
	if total > maxInt64 || available > maxInt64 {
		return 0, 0
	}
	return int64(total), int64(available)
}

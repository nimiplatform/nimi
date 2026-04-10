//go:build windows

package localservice

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	kernel32DLL              = windows.NewLazySystemDLL("kernel32.dll")
	globalMemoryStatusExProc = kernel32DLL.NewProc("GlobalMemoryStatusEx")
)

type memoryStatusEx struct {
	Length               uint32
	MemoryLoad           uint32
	TotalPhys            uint64
	AvailPhys            uint64
	TotalPageFile        uint64
	AvailPageFile        uint64
	TotalVirtual         uint64
	AvailVirtual         uint64
	AvailExtendedVirtual uint64
}

// probeRAM returns total and available host RAM in bytes using GlobalMemoryStatusEx.
func probeRAM() (totalBytes int64, availableBytes int64) {
	var memStatus memoryStatusEx
	memStatus.Length = uint32(unsafe.Sizeof(memStatus))
	result, _, _ := globalMemoryStatusExProc.Call(uintptr(unsafe.Pointer(&memStatus)))
	if result == 0 {
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

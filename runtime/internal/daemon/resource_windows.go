//go:build windows

package daemon

import (
	"os"
	"strconv"
	"strings"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	pdh          = windows.NewLazySystemDLL("pdh.dll")
	openQuery    = pdh.NewProc("PdhOpenQueryW")
	closeQuery   = pdh.NewProc("PdhCloseQuery")
	addCounter   = pdh.NewProc("PdhAddEnglishCounterW")
	collectQuery = pdh.NewProc("PdhCollectQueryData")
	readCounters = pdh.NewProc("PdhGetFormattedCounterArrayW")
)

func runtimeCPUTime() time.Duration {
	var created, exited, kernel, user windows.Filetime
	if windows.GetProcessTimes(windows.CurrentProcess(), &created, &exited, &kernel, &user) != nil {
		return 0
	}
	ticks := func(t windows.Filetime) uint64 { return uint64(t.HighDateTime)<<32 | uint64(t.LowDateTime) }
	return time.Duration(ticks(kernel)+ticks(user)) * 100 * time.Nanosecond
}

// Under WDDM nvidia-smi often reports N/A for every process. The GPU Process
// Memory counter attributes dedicated memory per process and physical adapter.
// Include the daemon's workers and their children, excluding unrelated apps.
func runtimeVRAMBytes() int64 {
	var query, counter uintptr
	if status, _, _ := openQuery.Call(0, 0, uintptr(unsafe.Pointer(&query))); status != 0 {
		return 0
	}
	defer closeQuery.Call(query)
	path := windows.StringToUTF16Ptr(`\GPU Process Memory(*)\Dedicated Usage`)
	if status, _, _ := addCounter.Call(query, uintptr(unsafe.Pointer(path)), 0, uintptr(unsafe.Pointer(&counter))); status != 0 {
		return 0
	}
	if status, _, _ := collectQuery.Call(query); status != 0 {
		return 0
	}
	const largeFormat = 0x400 // PDH_FMT_LARGE
	const moreData = 0x800007d2
	var size, count uint32
	status, _, _ := readCounters.Call(counter, largeFormat, uintptr(unsafe.Pointer(&size)), uintptr(unsafe.Pointer(&count)), 0)
	if uint32(status) != moreData || size == 0 || size > 16<<20 {
		return 0
	}
	// Align both the C structures and UTF-16 instance names in the buffer.
	buffer := make([]uint64, (size+7)/8)
	status, _, _ = readCounters.Call(counter, largeFormat, uintptr(unsafe.Pointer(&size)), uintptr(unsafe.Pointer(&count)), uintptr(unsafe.Pointer(&buffer[0])))
	type counterItem struct {
		name   *uint16
		status uint32
		_      uint32
		value  int64
	}
	if status != 0 || uint64(count)*uint64(unsafe.Sizeof(counterItem{})) > uint64(size) {
		return 0
	}
	owned := runtimeProcessTree()
	var total int64
	for _, item := range unsafe.Slice((*counterItem)(unsafe.Pointer(&buffer[0])), count) {
		if item.status > 1 || item.name == nil || item.value <= 0 {
			continue
		}
		name, ok := strings.CutPrefix(windows.UTF16PtrToString(item.name), "pid_")
		if !ok {
			continue
		}
		pid, _, ok := strings.Cut(name, "_")
		id, err := strconv.ParseUint(pid, 10, 32)
		if ok && err == nil && owned[uint32(id)] {
			total += item.value
		}
	}
	return total
}

func runtimeProcessTree() map[uint32]bool {
	root := uint32(os.Getpid())
	owned := map[uint32]bool{root: true}
	snapshot, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return owned
	}
	defer windows.CloseHandle(snapshot)
	var entry windows.ProcessEntry32
	entry.Size = uint32(unsafe.Sizeof(entry))
	children := make(map[uint32][]uint32)
	for err = windows.Process32First(snapshot, &entry); err == nil; err = windows.Process32Next(snapshot, &entry) {
		children[entry.ParentProcessID] = append(children[entry.ParentProcessID], entry.ProcessID)
	}
	queue := []uint32{root}
	for len(queue) > 0 {
		parent := queue[0]
		queue = queue[1:]
		for _, child := range children[parent] {
			if !owned[child] {
				owned[child] = true
				queue = append(queue, child)
			}
		}
	}
	return owned
}

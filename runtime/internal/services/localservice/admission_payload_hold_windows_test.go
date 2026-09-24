//go:build windows

package localservice

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"unsafe"

	"golang.org/x/sys/windows"
)

// A writable mapping outlives its file and section handles, so nothing but the
// mapping itself shows that the payload can still change.
func TestAdmissionPayloadSeesWritesThroughAWritableMappingWithoutHandles(t *testing.T) {
	path := filepath.Join(t.TempDir(), "payload.bin")
	first := bytes.Repeat([]byte("A"), 4096)
	second := bytes.Repeat([]byte("B"), len(first))
	if err := os.WriteFile(path, first, 0o600); err != nil {
		t.Fatal(err)
	}
	held := holdsAdmissionPayloadsForTest(t, path)
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		t.Fatal(err)
	}
	handle, err := windows.CreateFile(name, windows.GENERIC_READ|windows.GENERIC_WRITE,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, nil, windows.OPEN_EXISTING, windows.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		t.Fatal(err)
	}
	section, err := windows.CreateFileMapping(handle, nil, windows.PAGE_READWRITE, 0, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	view, err := windows.MapViewOfFile(section, windows.FILE_MAP_WRITE, 0, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	mapped := true
	defer func() {
		if mapped {
			_ = windows.UnmapViewOfFile(view)
		}
	}()
	if err := windows.CloseHandle(section); err != nil {
		t.Fatal(err)
	}
	if err := windows.CloseHandle(handle); err != nil {
		t.Fatal(err)
	}

	svc := newAdmissionHoldTestService(t)
	if got := admitForTest(t, svc, path); got != sha256HexForTest(first) {
		t.Fatalf("first admission digest = %s", got)
	}
	if retainedHoldsForTest(svc) != 0 {
		t.Fatal("admission held a payload with a writable mapping")
	}
	mapping := struct {
		address  uintptr
		length   int
		capacity int
	}{view, len(second), len(second)}
	copy(*(*[]byte)(unsafe.Pointer(&mapping)), second)
	if err := windows.FlushViewOfFile(view, 0); err != nil {
		t.Fatal(err)
	}
	if got, want := admitForTest(t, svc, path), sha256HexForTest(second); got != want {
		t.Fatalf("admission after a write through the mapping = %s, want %s", got, want)
	}

	if err := windows.UnmapViewOfFile(view); err != nil {
		t.Fatal(err)
	}
	mapped = false
	if got := admitForTest(t, svc, path); got != sha256HexForTest(second) {
		t.Fatalf("admission after unmapping = %s", got)
	}
	if !held {
		return
	}
	if retainedHoldsForTest(svc) != 1 {
		t.Fatal("admission retained no hold once the mapping was gone")
	}
	// While held, no writer can open the payload to map it again.
	_, err = windows.CreateFile(name, windows.GENERIC_READ|windows.GENERIC_WRITE,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, nil, windows.OPEN_EXISTING, windows.FILE_ATTRIBUTE_NORMAL, 0)
	if !errors.Is(err, windows.ERROR_SHARING_VIOLATION) {
		t.Fatalf("write open of a held payload = %v, want a sharing violation", err)
	}
}

package runtimeinstance

import (
	"errors"
	"fmt"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

func acquireLock(name string) (func() error, error) {
	// Keep the object alive through a handle, without thread ownership. The
	// Global namespace covers the service and every interactive user session.
	objectName, err := windows.UTF16PtrFromString(`Global\` + name)
	if err != nil {
		return nil, fmt.Errorf("name Runtime instance lock: %w", err)
	}
	// Other users and the restricted service token only need SYNCHRONIZE to
	// observe an existing object. They cannot change its security descriptor.
	descriptor, err := windows.SecurityDescriptorFromString("D:P(A;;GA;;;SY)(A;;0x00100000;;;WD)")
	if err != nil {
		return nil, fmt.Errorf("secure Runtime instance lock: %w", err)
	}
	attributes := &windows.SecurityAttributes{Length: uint32(unsafe.Sizeof(windows.SecurityAttributes{})), SecurityDescriptor: descriptor}
	handle, err := windows.CreateMutexEx(attributes, objectName, 0, windows.SYNCHRONIZE)
	if errors.Is(err, windows.ERROR_ALREADY_EXISTS) {
		_ = windows.CloseHandle(handle)
		return nil, ErrAlreadyRunning
	}
	if err != nil {
		return nil, fmt.Errorf("acquire Runtime instance lock: %w", err)
	}
	return sync.OnceValue(func() error { return windows.CloseHandle(handle) }), nil
}

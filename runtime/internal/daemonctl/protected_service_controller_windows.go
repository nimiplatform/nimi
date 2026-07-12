//go:build windows

package daemonctl

import (
	"errors"
	"fmt"
	"time"
	"unsafe"

	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"golang.org/x/sys/windows"
)

const protectedServicePollInterval = 100 * time.Millisecond

type windowsProtectedServiceController struct {
	now   func() time.Time
	sleep func(time.Duration)
}

func newProtectedServiceController() protectedServiceController {
	return &windowsProtectedServiceController{now: time.Now, sleep: time.Sleep}
}

func (controller *windowsProtectedServiceController) Status() (protectedServiceStatus, error) {
	service, closeService, err := openWindowsProtectedService(windows.SERVICE_QUERY_STATUS)
	if err != nil {
		return protectedServiceStatus{}, err
	}
	defer closeService()
	return queryWindowsProtectedService(service)
}

func (controller *windowsProtectedServiceController) Start(timeout time.Duration) (protectedServiceStatus, error) {
	service, closeService, err := openWindowsProtectedService(windows.SERVICE_QUERY_STATUS | windows.SERVICE_START)
	if err != nil {
		return protectedServiceStatus{}, err
	}
	defer closeService()
	status, err := queryWindowsProtectedService(service)
	if err != nil {
		return protectedServiceStatus{}, err
	}
	if status.Running {
		return status, nil
	}
	if status.State == "start-pending" {
		return controller.waitForWindowsProtectedServiceState(service, timeout, "running")
	}
	if status.State != "stopped" {
		return protectedServiceStatus{}, fmt.Errorf("NimiRuntime service is %s and cannot be started", status.State)
	}
	if err := windows.StartService(service, 0, nil); err != nil && !errors.Is(err, windows.ERROR_SERVICE_ALREADY_RUNNING) {
		return protectedServiceStatus{}, err
	}
	return controller.waitForWindowsProtectedServiceState(service, timeout, "running")
}

func (controller *windowsProtectedServiceController) Stop(timeout time.Duration) (protectedServiceStatus, error) {
	service, closeService, err := openWindowsProtectedService(windows.SERVICE_QUERY_STATUS | windows.SERVICE_STOP)
	if err != nil {
		return protectedServiceStatus{}, err
	}
	defer closeService()
	status, err := queryWindowsProtectedService(service)
	if err != nil {
		return protectedServiceStatus{}, err
	}
	if status.State == "stopped" {
		return status, nil
	}
	if status.State == "stop-pending" {
		return controller.waitForWindowsProtectedServiceState(service, timeout, "stopped")
	}
	if !status.Running {
		return protectedServiceStatus{}, fmt.Errorf("NimiRuntime service is %s and cannot be stopped", status.State)
	}
	var serviceStatus windows.SERVICE_STATUS
	if err := windows.ControlService(service, windows.SERVICE_CONTROL_STOP, &serviceStatus); err != nil && !errors.Is(err, windows.ERROR_SERVICE_NOT_ACTIVE) {
		return protectedServiceStatus{}, err
	}
	return controller.waitForWindowsProtectedServiceState(service, timeout, "stopped")
}

func (controller *windowsProtectedServiceController) waitForWindowsProtectedServiceState(service windows.Handle, timeout time.Duration, expected string) (protectedServiceStatus, error) {
	if timeout <= 0 {
		return protectedServiceStatus{}, fmt.Errorf("protected service wait timeout is required")
	}
	deadline := controller.now().Add(timeout)
	for {
		status, err := queryWindowsProtectedService(service)
		if err != nil {
			return protectedServiceStatus{}, err
		}
		if status.State == expected {
			return status, nil
		}
		if !controller.now().Before(deadline) {
			return protectedServiceStatus{}, fmt.Errorf("NimiRuntime service did not reach %s state within %s (current=%s)", expected, timeout, status.State)
		}
		controller.sleep(protectedServicePollInterval)
	}
}

func openWindowsProtectedService(access uint32) (windows.Handle, func(), error) {
	manager, err := windows.OpenSCManager(nil, nil, windows.SC_MANAGER_CONNECT)
	if err != nil {
		return 0, nil, fmt.Errorf("open Windows service manager: %w", err)
	}
	serviceName := protectedlocal.WindowsRuntimeServiceName()
	name, err := windows.UTF16PtrFromString(serviceName)
	if err != nil {
		_ = windows.CloseServiceHandle(manager)
		return 0, nil, fmt.Errorf("encode %s service name: %w", serviceName, err)
	}
	service, err := windows.OpenService(manager, name, access)
	if err != nil {
		_ = windows.CloseServiceHandle(manager)
		return 0, nil, fmt.Errorf("open %s service: %w", serviceName, err)
	}
	return service, func() {
		_ = windows.CloseServiceHandle(service)
		_ = windows.CloseServiceHandle(manager)
	}, nil
}

func queryWindowsProtectedService(service windows.Handle) (protectedServiceStatus, error) {
	var status windows.SERVICE_STATUS_PROCESS
	var needed uint32
	if err := windows.QueryServiceStatusEx(service, windows.SC_STATUS_PROCESS_INFO, (*byte)(unsafe.Pointer(&status)), uint32(unsafe.Sizeof(status)), &needed); err != nil {
		return protectedServiceStatus{}, err
	}
	return protectedServiceStatus{
		Running: status.CurrentState == windows.SERVICE_RUNNING,
		PID:     int(status.ProcessId),
		State:   windowsProtectedServiceStateName(status.CurrentState),
	}, nil
}

func windowsProtectedServiceStateName(state uint32) string {
	switch state {
	case windows.SERVICE_STOPPED:
		return "stopped"
	case windows.SERVICE_START_PENDING:
		return "start-pending"
	case windows.SERVICE_STOP_PENDING:
		return "stop-pending"
	case windows.SERVICE_RUNNING:
		return "running"
	case windows.SERVICE_CONTINUE_PENDING:
		return "continue-pending"
	case windows.SERVICE_PAUSE_PENDING:
		return "pause-pending"
	case windows.SERVICE_PAUSED:
		return "paused"
	default:
		return fmt.Sprintf("unknown-%d", state)
	}
}

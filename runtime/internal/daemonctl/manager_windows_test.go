//go:build windows

package daemonctl

import (
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/config"
	"golang.org/x/sys/windows"
)

func TestRemoveFileWithRetryRetriesSharingViolation(t *testing.T) {
	manager, _, _ := newTestManager(t)
	manager.now = func() time.Time { return time.Unix(0, 0) }
	sleepCalls := 0
	manager.sleep = func(time.Duration) {
		sleepCalls++
	}

	target := filepath.Join(t.TempDir(), "runtime.lock")
	removeCalls := 0
	manager.removeFile = func(path string) error {
		if path != target {
			t.Fatalf("unexpected remove path: %q", path)
		}
		removeCalls++
		if removeCalls == 1 {
			return &os.PathError{
				Op:   "remove",
				Path: path,
				Err:  syscall.Errno(windows.ERROR_SHARING_VIOLATION),
			}
		}
		return nil
	}

	if err := manager.removeFileWithRetry(target); err != nil {
		t.Fatalf("removeFileWithRetry: %v", err)
	}
	if removeCalls != 2 {
		t.Fatalf("expected 2 remove attempts, got %d", removeCalls)
	}
	if sleepCalls != 1 {
		t.Fatalf("expected 1 retry sleep, got %d", sleepCalls)
	}
}

func TestRemoveFileWithRetryDoesNotRetryNonRetryableError(t *testing.T) {
	manager, _, _ := newTestManager(t)
	manager.now = func() time.Time { return time.Unix(0, 0) }
	sleepCalls := 0
	manager.sleep = func(time.Duration) {
		sleepCalls++
	}

	target := filepath.Join(t.TempDir(), "runtime.lock")
	expected := fmt.Errorf("boom")
	removeCalls := 0
	manager.removeFile = func(path string) error {
		removeCalls++
		return expected
	}

	err := manager.removeFileWithRetry(target)
	if err == nil || err.Error() != expected.Error() {
		t.Fatalf("expected %v, got %v", expected, err)
	}
	if removeCalls != 1 {
		t.Fatalf("expected a single remove attempt, got %d", removeCalls)
	}
	if sleepCalls != 0 {
		t.Fatalf("expected no retry sleep, got %d", sleepCalls)
	}
}

func TestManagerStartUsesProtectedServiceControllerWithoutChildProcess(t *testing.T) {
	manager, _, _ := newTestManager(t)
	controller := &fakeProtectedServiceController{
		status: protectedServiceStatus{Running: false},
		start:  protectedServiceStatus{Running: true, PID: 423},
	}
	manager.protectedService = controller
	manager.loadConfig = func() (config.Config, error) {
		t.Fatal("protected service start must not load user Runtime config")
		return config.Config{}, nil
	}
	manager.executablePath = func() (string, error) {
		t.Fatal("protected service start must not resolve a caller executable")
		return "", nil
	}
	manager.startProcess = func(string, string) (int, error) {
		t.Fatal("protected service start must not spawn a child Runtime")
		return 0, nil
	}
	manager.probe = func(string, time.Duration) (map[string]any, error) {
		t.Fatal("protected service start must not probe an ordinary gRPC address")
		return nil, nil
	}

	result, err := manager.Start(20 * time.Millisecond)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if result.Mode != ModeProtectedService || result.PID != 423 {
		t.Fatalf("Start result = %+v, want protected service PID 423", result)
	}
	if controller.startCalls != 1 {
		t.Fatalf("protected service start calls = %d, want 1", controller.startCalls)
	}
}

func TestDefaultStartProcessFailsClosed(t *testing.T) {
	if _, err := defaultStartProcess(`C:\\Program Files\\Nimi\\nimi.exe`, filepath.Join(t.TempDir(), "runtime.log")); err == nil {
		t.Fatal("Windows default start process must reject child Runtime launch")
	}
}

func TestManagerStatusUsesProtectedServiceControllerWithoutUserConfig(t *testing.T) {
	manager, _, _ := newTestManager(t)
	manager.protectedService = &fakeProtectedServiceController{
		status: protectedServiceStatus{Running: true, PID: 424, State: "running"},
	}
	manager.loadConfig = func() (config.Config, error) {
		t.Fatal("protected service status must not load user Runtime config")
		return config.Config{}, nil
	}

	status, err := manager.Status()
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	if status.Mode != ModeProtectedService || status.Process != "running" || status.PID != 424 || !status.HealthReachable {
		t.Fatalf("Status = %+v, want running protected service PID 424", status)
	}
}

func TestManagerStopUsesProtectedServiceControllerWithoutProcessKill(t *testing.T) {
	manager, _, _ := newTestManager(t)
	controller := &fakeProtectedServiceController{
		status: protectedServiceStatus{Running: true, PID: 425, State: "running"},
		stop:   protectedServiceStatus{Running: false, State: "stopped"},
	}
	manager.protectedService = controller
	manager.loadConfig = func() (config.Config, error) {
		t.Fatal("protected service stop must not load user Runtime config")
		return config.Config{}, nil
	}
	manager.stopProcess = func(int, string, bool) error {
		t.Fatal("protected service stop must not kill a Runtime process directly")
		return nil
	}

	result, err := manager.Stop(20*time.Millisecond, false)
	if err != nil {
		t.Fatalf("Stop: %v", err)
	}
	if !result.Stopped || result.Mode != ModeProtectedService || result.PID != 425 {
		t.Fatalf("Stop result = %+v, want protected service PID 425 stopped", result)
	}
	if controller.stopCalls != 1 {
		t.Fatalf("protected service stop calls = %d, want 1", controller.stopCalls)
	}
}

type fakeProtectedServiceController struct {
	status     protectedServiceStatus
	start      protectedServiceStatus
	stop       protectedServiceStatus
	startCalls int
	stopCalls  int
}

func (controller *fakeProtectedServiceController) Status() (protectedServiceStatus, error) {
	return controller.status, nil
}

func (controller *fakeProtectedServiceController) Start(time.Duration) (protectedServiceStatus, error) {
	controller.startCalls++
	controller.status = controller.start
	return controller.start, nil
}

func (controller *fakeProtectedServiceController) Stop(time.Duration) (protectedServiceStatus, error) {
	controller.stopCalls++
	controller.status = controller.stop
	return controller.stop, nil
}

package daemonctl

import (
	"bytes"
	"context"
	"errors"
	"testing"
	"time"
)

func TestManagerStartUsesProtectedServiceControllerWithoutChildProcess(t *testing.T) {
	manager := NewManager("test")
	controller := &fakeProtectedServiceController{
		status: protectedServiceStatus{Running: false},
		start:  protectedServiceStatus{Running: true, PID: 423},
	}
	manager.protectedService = controller

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

func TestManagerStatusUsesProtectedServiceControllerWithoutUserConfig(t *testing.T) {
	manager := NewManager("test")
	manager.protectedService = &fakeProtectedServiceController{
		status: protectedServiceStatus{Running: true, PID: 424, State: "running"},
	}

	status, err := manager.Status()
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	if status.Mode != ModeProtectedService || status.Process != "running" || status.PID != 424 {
		t.Fatalf("Status = %+v, want running protected service PID 424", status)
	}
}

func TestManagerStopUsesProtectedServiceControllerWithoutProcessKill(t *testing.T) {
	manager := NewManager("test")
	controller := &fakeProtectedServiceController{
		status: protectedServiceStatus{Running: true, PID: 425, State: "running"},
		stop:   protectedServiceStatus{Running: false, State: "stopped"},
	}
	manager.protectedService = controller

	result, err := manager.Stop(20 * time.Millisecond)
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
	status      protectedServiceStatus
	start       protectedServiceStatus
	stop        protectedServiceStatus
	statusErr   error
	startErr    error
	stopErr     error
	statusCalls int
	startCalls  int
	stopCalls   int
	timeout     time.Duration
}

func (c *fakeProtectedServiceController) Status() (protectedServiceStatus, error) {
	c.statusCalls++
	return c.status, c.statusErr
}
func (c *fakeProtectedServiceController) Start(timeout time.Duration) (protectedServiceStatus, error) {
	c.startCalls++
	c.timeout = timeout
	c.status = c.start
	return c.start, c.startErr
}
func (c *fakeProtectedServiceController) Stop(timeout time.Duration) (protectedServiceStatus, error) {
	c.stopCalls++
	c.timeout = timeout
	c.status = c.stop
	return c.stop, c.stopErr
}

func TestManagerStartWaitsForControllerRunningState(t *testing.T) {
	for _, tc := range []struct {
		name      string
		before    protectedServiceStatus
		after     protectedServiceStatus
		wantCalls int
	}{
		{name: "already running", before: protectedServiceStatus{Running: true, PID: 42}},
		{name: "no running state", after: protectedServiceStatus{PID: 42}, wantCalls: 1},
		{name: "no process identity", after: protectedServiceStatus{Running: true}, wantCalls: 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := &fakeProtectedServiceController{status: tc.before, start: tc.after}
			m := &Manager{protectedService: c}
			if _, err := m.Start(time.Second); err == nil {
				t.Fatal("expected start failure")
			}
			if c.startCalls != tc.wantCalls {
				t.Fatalf("start calls = %d, want %d", c.startCalls, tc.wantCalls)
			}
		})
	}
}

func TestManagerLifecycleUsesDefaultAndExplicitTimeouts(t *testing.T) {
	for _, timeout := range []time.Duration{0, -time.Second, 20 * time.Millisecond} {
		c := &fakeProtectedServiceController{start: protectedServiceStatus{Running: true, PID: 42}}
		m := &Manager{protectedService: c}
		if _, err := m.Start(timeout); err != nil {
			t.Fatal(err)
		}
		want := timeout
		if want <= 0 {
			want = 15 * time.Second
		}
		if c.timeout != want {
			t.Fatalf("start timeout = %s, want %s", c.timeout, want)
		}
		if _, err := m.Stop(timeout); err != nil {
			t.Fatal(err)
		}
		want = timeout
		if want <= 0 {
			want = 10 * time.Second
		}
		if c.timeout != want {
			t.Fatalf("stop timeout = %s, want %s", c.timeout, want)
		}
	}
}

func TestManagerStopIsIdempotentWhenServiceStopped(t *testing.T) {
	c := &fakeProtectedServiceController{}
	m := &Manager{protectedService: c}
	result, err := m.Stop(time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if !result.AlreadyStopped || !result.Stopped || result.Mode != ModeProtectedService || c.stopCalls != 0 {
		t.Fatalf("unexpected stopped result: %+v, calls: %d", result, c.stopCalls)
	}
}

func TestManagerStopRequiresControllerStoppedState(t *testing.T) {
	c := &fakeProtectedServiceController{status: protectedServiceStatus{Running: true, PID: 42}, stop: protectedServiceStatus{Running: true, PID: 42}}
	m := &Manager{protectedService: c}
	if _, err := m.Stop(time.Second); err == nil {
		t.Fatal("expected stop failure")
	}
}

func TestManagerControllerErrorsRemainFailures(t *testing.T) {
	failure := errors.New("controller unavailable")
	for _, tc := range []struct {
		name       string
		controller fakeProtectedServiceController
		invoke     func(*Manager) error
	}{
		{"start status", fakeProtectedServiceController{statusErr: failure}, func(m *Manager) error { _, err := m.Start(time.Second); return err }},
		{"start", fakeProtectedServiceController{startErr: failure}, func(m *Manager) error { _, err := m.Start(time.Second); return err }},
		{"stop status", fakeProtectedServiceController{statusErr: failure}, func(m *Manager) error { _, err := m.Stop(time.Second); return err }},
		{"stop", fakeProtectedServiceController{status: protectedServiceStatus{Running: true, PID: 42}, stopErr: failure}, func(m *Manager) error { _, err := m.Stop(time.Second); return err }},
		{"status", fakeProtectedServiceController{statusErr: failure}, func(m *Manager) error { _, err := m.Status(); return err }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m := &Manager{protectedService: &tc.controller}
			if err := tc.invoke(m); !errors.Is(err, failure) {
				t.Fatalf("expected controller error, got %v", err)
			}
		})
	}
}

func TestManagerStatusReportsStoppedService(t *testing.T) {
	m := &Manager{version: "test", protectedService: &fakeProtectedServiceController{}}
	status, err := m.Status()
	if err != nil {
		t.Fatal(err)
	}
	if status.Process != "stopped" || status.Mode != ModeProtectedService || status.HealthSummary != "protected-service-stopped" || status.ExitCode() != 1 {
		t.Fatalf("unexpected status: %+v", status)
	}
}

func TestManagerLogsFailWithoutReadingServiceOrWritingOutput(t *testing.T) {
	c := &fakeProtectedServiceController{}
	m := &Manager{protectedService: c}
	for _, follow := range []bool{false, true} {
		var output bytes.Buffer
		if err := m.PrintLogs(context.Background(), &output, 20, follow); err == nil || err.Error() != "protected Runtime service logs are unavailable" {
			t.Fatalf("expected unavailable logs, got %v", err)
		}
		if output.Len() != 0 || c.statusCalls != 0 {
			t.Fatal("unavailable logs must not query service state or produce log content")
		}
	}
}

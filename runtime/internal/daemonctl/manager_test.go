package daemonctl

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/config"
)

func newTestManager(t *testing.T) (*Manager, Paths, map[int]bool) {
	t.Helper()
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)
	paths := Paths{
		LockFile:     filepath.Join(homeDir, ".nimi", "runtime", "runtime.lock"),
		PIDFile:      filepath.Join(homeDir, ".nimi", "runtime", "daemon.pid"),
		MetadataFile: filepath.Join(homeDir, ".nimi", "runtime", "daemon.json"),
		LogFile:      filepath.Join(homeDir, ".nimi", "logs", "runtime.log"),
	}
	alive := map[int]bool{}
	manager := NewManager("0.2.0")
	manager.resolvePaths = func() (Paths, error) { return paths, nil }
	manager.loadConfig = func() (config.Config, error) {
		return config.Config{GRPCAddr: "127.0.0.1:46371"}, nil
	}
	manager.executablePath = func() (string, error) {
		return "/usr/local/bin/nimi", nil
	}
	manager.isProcessAlive = func(pid int) bool {
		return alive[pid]
	}
	manager.stopProcess = func(pid int, _ string, _ bool) error {
		delete(alive, pid)
		_ = os.Remove(paths.LockFile)
		return nil
	}
	return manager, paths, alive
}

func writePID(t *testing.T, path string, pid int) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir pid dir: %v", err)
	}
	if err := os.WriteFile(path, []byte(fmt.Sprintf("%d\n", pid)), 0o600); err != nil {
		t.Fatalf("write pid file: %v", err)
	}
}

func writeMetadata(t *testing.T, path string, metadata Metadata) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir metadata dir: %v", err)
	}
	content := fmt.Sprintf("{\n  \"pid\": %d,\n  \"version\": %q,\n  \"grpcAddr\": %q,\n  \"configPath\": %q,\n  \"logPath\": %q,\n  \"startedAt\": %q,\n  \"executablePath\": %q,\n  \"mode\": %q\n}\n",
		metadata.PID,
		metadata.Version,
		metadata.GRPCAddr,
		metadata.ConfigPath,
		metadata.LogPath,
		metadata.StartedAt,
		metadata.ExecutablePath,
		metadata.Mode,
	)
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write metadata: %v", err)
	}
}

func TestManagerStartSucceedsAfterProbeReachable(t *testing.T) {
	manager, paths, alive := newTestManager(t)
	probeCalls := 0
	manager.startProcess = func(_ string, logPath string) (int, error) {
		alive[101] = true
		writePID(t, paths.LockFile, 101)
		if err := os.MkdirAll(filepath.Dir(logPath), 0o755); err != nil {
			t.Fatalf("mkdir log dir: %v", err)
		}
		if err := os.WriteFile(logPath, []byte("booting\n"), 0o600); err != nil {
			t.Fatalf("write log: %v", err)
		}
		return 101, nil
	}
	manager.probe = func(_ string, _ time.Duration) (map[string]any, error) {
		probeCalls++
		if probeCalls < 2 {
			return nil, errors.New("not ready")
		}
		return map[string]any{
			"status": "RUNTIME_HEALTH_STATUS_READY",
			"reason": "healthy",
		}, nil
	}

	result, err := manager.Start(50 * time.Millisecond)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if result.PID != 101 {
		t.Fatalf("pid mismatch: %#v", result)
	}
	if _, err := os.Stat(paths.MetadataFile); err != nil {
		t.Fatalf("metadata file should exist: %v", err)
	}
	status, err := manager.Status()
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	if status.Mode != ModeBackground {
		t.Fatalf("status mode mismatch: %#v", status)
	}
	if status.ExitCode() != 0 {
		t.Fatalf("status exit code mismatch: %#v", status)
	}
}

func TestManagerStartFailsOnProbeTimeoutAndCleansState(t *testing.T) {
	manager, paths, alive := newTestManager(t)
	manager.startProcess = func(_ string, logPath string) (int, error) {
		alive[102] = true
		writePID(t, paths.LockFile, 102)
		if err := os.MkdirAll(filepath.Dir(logPath), 0o755); err != nil {
			t.Fatalf("mkdir log dir: %v", err)
		}
		if err := os.WriteFile(logPath, []byte("boot failed\n"), 0o600); err != nil {
			t.Fatalf("write log: %v", err)
		}
		return 102, nil
	}
	manager.probe = func(_ string, _ time.Duration) (map[string]any, error) {
		return nil, errors.New("dial refused")
	}
	manager.stopProcess = func(pid int, _ string, _ bool) error {
		delete(alive, pid)
		_ = os.Remove(paths.LockFile)
		return nil
	}

	_, err := manager.Start(5 * time.Millisecond)
	if err == nil {
		t.Fatalf("expected start timeout")
	}
	if !strings.Contains(err.Error(), "Last log lines") {
		t.Fatalf("unexpected start error: %v", err)
	}
	for _, path := range []string{paths.LockFile, paths.PIDFile, paths.MetadataFile} {
		if _, statErr := os.Stat(path); !os.IsNotExist(statErr) {
			t.Fatalf("expected %s to be removed, stat err=%v", path, statErr)
		}
	}
}

func TestManagerStartRejectsSecondInstance(t *testing.T) {
	manager, paths, alive := newTestManager(t)
	writePID(t, paths.LockFile, 103)
	alive[103] = true

	_, err := manager.Start(20 * time.Millisecond)
	if err == nil {
		t.Fatalf("expected second instance rejection")
	}
	if !strings.Contains(err.Error(), "already running") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestManagerStartRejectsGoRunTempBinary(t *testing.T) {
	manager, _, _ := newTestManager(t)
	manager.executablePath = func() (string, error) {
		return filepath.Join(os.TempDir(), "go-build123", "b001", "exe", "nimi"), nil
	}

	_, err := manager.Start(20 * time.Millisecond)
	if err == nil {
		t.Fatalf("expected go run binary rejection")
	}
	if !strings.Contains(err.Error(), "requires an installed or built binary") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestManagerStartCleansUpWhenMetadataWriteFails(t *testing.T) {
	manager, paths, alive := newTestManager(t)
	manager.startProcess = func(_ string, logPath string) (int, error) {
		alive[113] = true
		writePID(t, paths.LockFile, 113)
		if err := os.MkdirAll(filepath.Dir(logPath), 0o755); err != nil {
			t.Fatalf("mkdir log dir: %v", err)
		}
		if err := os.WriteFile(logPath, []byte("booting\n"), 0o600); err != nil {
			t.Fatalf("write log: %v", err)
		}
		return 113, nil
	}
	manager.probe = func(_ string, _ time.Duration) (map[string]any, error) {
		return map[string]any{"status": "RUNTIME_HEALTH_STATUS_READY"}, nil
	}
	manager.writeAtomic = func(path string, content []byte, mode os.FileMode) error {
		if path == paths.MetadataFile {
			return errors.New("metadata write failed")
		}
		return writeBytesAtomic(path, content, mode)
	}
	manager.stopProcess = func(pid int, _ string, _ bool) error {
		delete(alive, pid)
		_ = os.Remove(paths.LockFile)
		return nil
	}

	_, err := manager.Start(20 * time.Millisecond)
	if err == nil {
		t.Fatalf("expected metadata write failure")
	}
	if _, statErr := os.Stat(paths.LockFile); !os.IsNotExist(statErr) {
		t.Fatalf("expected lock cleanup after metadata failure, stat err=%v", statErr)
	}
	if _, statErr := os.Stat(paths.PIDFile); !os.IsNotExist(statErr) {
		t.Fatalf("expected pid cleanup after metadata failure, stat err=%v", statErr)
	}
}

func TestWriteBytesAtomicUsesUniqueTempFilePattern(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "daemon.json")
	if err := writeBytesAtomic(target, []byte("first"), 0o600); err != nil {
		t.Fatalf("first writeBytesAtomic: %v", err)
	}
	if err := writeBytesAtomic(target, []byte("second"), 0o600); err != nil {
		t.Fatalf("second writeBytesAtomic: %v", err)
	}
	content, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("read target: %v", err)
	}
	if string(content) != "second" {
		t.Fatalf("target content mismatch: %q", string(content))
	}
	matches, err := filepath.Glob(filepath.Join(dir, "daemon.json.*.tmp"))
	if err != nil {
		t.Fatalf("glob temp files: %v", err)
	}
	if len(matches) != 0 {
		t.Fatalf("expected no leftover temp files, got=%v", matches)
	}
}

func TestManagerStatusReportsBackground(t *testing.T) {
	manager, paths, alive := newTestManager(t)
	alive[104] = true
	writePID(t, paths.LockFile, 104)
	writePID(t, paths.PIDFile, 104)
	writeMetadata(t, paths.MetadataFile, Metadata{
		PID:        104,
		Version:    "0.2.0",
		GRPCAddr:   "127.0.0.1:46371",
		ConfigPath: filepath.Join(filepath.Dir(filepath.Dir(paths.MetadataFile)), "config.json"),
		LogPath:    paths.LogFile,
		StartedAt:  time.Now().UTC().Format(time.RFC3339Nano),
		Mode:       ModeBackground,
	})
	manager.probe = func(_ string, _ time.Duration) (map[string]any, error) {
		return map[string]any{"status": "RUNTIME_HEALTH_STATUS_READY"}, nil
	}

	status, err := manager.Status()
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	if status.Mode != ModeBackground || status.Process != "running" {
		t.Fatalf("unexpected status: %#v", status)
	}
}

func TestManagerStatusReportsExternal(t *testing.T) {
	manager, paths, alive := newTestManager(t)
	alive[105] = true
	writePID(t, paths.LockFile, 105)
	manager.probe = func(_ string, _ time.Duration) (map[string]any, error) {
		return map[string]any{"status": "RUNTIME_HEALTH_STATUS_READY"}, nil
	}

	status, err := manager.Status()
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	if status.Mode != ModeExternal {
		t.Fatalf("unexpected status: %#v", status)
	}
}

func TestManagerStatusPrunesStaleMetadata(t *testing.T) {
	manager, paths, _ := newTestManager(t)
	writePID(t, paths.PIDFile, 106)
	writeMetadata(t, paths.MetadataFile, Metadata{
		PID:        106,
		Version:    "0.2.0",
		GRPCAddr:   "127.0.0.1:46371",
		ConfigPath: "config.json",
		LogPath:    paths.LogFile,
		StartedAt:  time.Now().UTC().Format(time.RFC3339Nano),
		Mode:       ModeBackground,
	})

	status, err := manager.Status()
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	if status.Process != "stopped" {
		t.Fatalf("unexpected status: %#v", status)
	}
	for _, path := range []string{paths.PIDFile, paths.MetadataFile} {
		if _, statErr := os.Stat(path); !os.IsNotExist(statErr) {
			t.Fatalf("expected %s to be pruned, stat err=%v", path, statErr)
		}
	}
}

func TestManagerStatusReturnsProbeFailure(t *testing.T) {
	manager, paths, alive := newTestManager(t)
	alive[107] = true
	writePID(t, paths.LockFile, 107)
	manager.probe = func(_ string, _ time.Duration) (map[string]any, error) {
		return nil, errors.New("dial failed")
	}

	status, err := manager.Status()
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	if status.ExitCode() != 2 {
		t.Fatalf("expected exit code 2 for unreachable probe: %#v", status)
	}
}

func TestManagerStopGracefullyStopsManagedInstance(t *testing.T) {
	manager, paths, alive := newTestManager(t)
	alive[108] = true
	writePID(t, paths.LockFile, 108)
	writePID(t, paths.PIDFile, 108)
	writeMetadata(t, paths.MetadataFile, Metadata{
		PID:            108,
		Version:        "0.2.0",
		GRPCAddr:       "127.0.0.1:46371",
		ConfigPath:     "config.json",
		LogPath:        paths.LogFile,
		StartedAt:      time.Now().UTC().Format(time.RFC3339Nano),
		ExecutablePath: "/usr/local/bin/nimi",
		Mode:           ModeBackground,
	})
	forceCalled := false
	manager.stopProcess = func(pid int, executable string, force bool) error {
		delete(alive, pid)
		forceCalled = force
		if executable != "/usr/local/bin/nimi" {
			t.Fatalf("unexpected executable path: %q", executable)
		}
		_ = os.Remove(paths.LockFile)
		return nil
	}

	result, err := manager.Stop(20*time.Millisecond, false)
	if err != nil {
		t.Fatalf("Stop: %v", err)
	}
	if result.AlreadyStopped || forceCalled {
		t.Fatalf("unexpected stop result: %#v force=%v", result, forceCalled)
	}
	for _, path := range []string{paths.PIDFile, paths.MetadataFile} {
		if _, statErr := os.Stat(path); !os.IsNotExist(statErr) {
			t.Fatalf("expected %s to be removed, stat err=%v", path, statErr)
		}
	}
}

func TestManagerStopCanStopExternalInstance(t *testing.T) {
	manager, paths, alive := newTestManager(t)
	alive[109] = true
	writePID(t, paths.LockFile, 109)

	result, err := manager.Stop(20*time.Millisecond, false)
	if err != nil {
		t.Fatalf("Stop: %v", err)
	}
	if result.Mode != ModeExternal || result.PID != 109 {
		t.Fatalf("unexpected stop result: %#v", result)
	}
}

func TestManagerStopForceSetsForceFlag(t *testing.T) {
	manager, paths, alive := newTestManager(t)
	alive[110] = true
	writePID(t, paths.LockFile, 110)
	forceCalled := false
	manager.stopProcess = func(pid int, _ string, force bool) error {
		delete(alive, pid)
		forceCalled = force
		_ = os.Remove(paths.LockFile)
		return nil
	}

	if _, err := manager.Stop(20*time.Millisecond, true); err != nil {
		t.Fatalf("Stop force: %v", err)
	}
	if !forceCalled {
		t.Fatalf("expected force stop path")
	}
}

func TestManagerStopIsIdempotentWhenStopped(t *testing.T) {
	manager, _, _ := newTestManager(t)

	result, err := manager.Stop(20*time.Millisecond, false)
	if err != nil {
		t.Fatalf("Stop: %v", err)
	}
	if !result.AlreadyStopped {
		t.Fatalf("expected already stopped result: %#v", result)
	}
}

func TestManagerPrintLogsTailsManagedLog(t *testing.T) {
	manager, paths, alive := newTestManager(t)
	alive[111] = true
	writePID(t, paths.LockFile, 111)
	writePID(t, paths.PIDFile, 111)
	writeMetadata(t, paths.MetadataFile, Metadata{
		PID:        111,
		Version:    "0.2.0",
		GRPCAddr:   "127.0.0.1:46371",
		ConfigPath: "config.json",
		LogPath:    paths.LogFile,
		StartedAt:  time.Now().UTC().Format(time.RFC3339Nano),
		Mode:       ModeBackground,
	})
	if err := os.MkdirAll(filepath.Dir(paths.LogFile), 0o755); err != nil {
		t.Fatalf("mkdir log dir: %v", err)
	}
	if err := os.WriteFile(paths.LogFile, []byte("one\ntwo\nthree\n"), 0o600); err != nil {
		t.Fatalf("write log: %v", err)
	}

	var out bytes.Buffer
	if err := manager.PrintLogs(context.Background(), &out, 2, false); err != nil {
		t.Fatalf("PrintLogs: %v", err)
	}
	if strings.TrimSpace(out.String()) != "two\nthree" {
		t.Fatalf("unexpected logs output: %q", out.String())
	}
}

func TestManagerPrintLogsFailsForExternalMode(t *testing.T) {
	manager, paths, alive := newTestManager(t)
	alive[112] = true
	writePID(t, paths.LockFile, 112)

	var out bytes.Buffer
	err := manager.PrintLogs(context.Background(), &out, 10, false)
	if err == nil {
		t.Fatalf("expected external-mode log error")
	}
	if !strings.Contains(err.Error(), "background mode") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestManagerPrintLogsFollowStreamsAppendedContent(t *testing.T) {
	manager, paths, alive := newTestManager(t)
	alive[114] = true
	writePID(t, paths.LockFile, 114)
	writePID(t, paths.PIDFile, 114)
	writeMetadata(t, paths.MetadataFile, Metadata{
		PID:        114,
		Version:    "0.2.0",
		GRPCAddr:   "127.0.0.1:46371",
		ConfigPath: "config.json",
		LogPath:    paths.LogFile,
		StartedAt:  time.Now().UTC().Format(time.RFC3339Nano),
		Mode:       ModeBackground,
	})
	if err := os.MkdirAll(filepath.Dir(paths.LogFile), 0o755); err != nil {
		t.Fatalf("mkdir log dir: %v", err)
	}
	if err := os.WriteFile(paths.LogFile, []byte("booting\n"), 0o600); err != nil {
		t.Fatalf("write initial log: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var out bytes.Buffer
	done := make(chan error, 1)
	go func() {
		done <- manager.PrintLogs(ctx, &out, 10, true)
	}()

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if err := os.WriteFile(paths.LogFile, []byte("booting\nready\n"), 0o600); err != nil {
			t.Fatalf("append log content: %v", err)
		}
		if strings.Contains(out.String(), "ready") {
			cancel()
			err := <-done
			if !errors.Is(err, context.Canceled) {
				t.Fatalf("expected context cancellation, got %v", err)
			}
			return
		}
		time.Sleep(20 * time.Millisecond)
	}

	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context cancellation, got %v", err)
	}
	t.Fatalf("expected follow output to include appended log line, got %q", out.String())
}

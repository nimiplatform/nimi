//go:build !windows

package engine

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

func writeStaleRecord(t *testing.T, root string, kind EngineKind, pid int, metadata supervisorPIDMetadata) (string, string) {
	t.Helper()
	pidPath := filepath.Join(root, string(kind), "supervised.pid")
	if err := os.MkdirAll(filepath.Dir(pidPath), 0o755); err != nil {
		t.Fatalf("mkdir pid dir: %v", err)
	}
	if err := os.WriteFile(pidPath, []byte(strconv.Itoa(pid)), 0o644); err != nil {
		t.Fatalf("write pid file: %v", err)
	}
	encoded, err := encodeSupervisorPIDMetadata(metadata)
	if err != nil {
		t.Fatalf("encode metadata: %v", err)
	}
	if err := os.WriteFile(pidPath+".meta.json", encoded, 0o644); err != nil {
		t.Fatalf("write metadata: %v", err)
	}
	return pidPath, pidPath + ".meta.json"
}

func helperRecord(t *testing.T, cmd *exec.Cmd, kind EngineKind, executable string) supervisorPIDMetadata {
	t.Helper()
	startTime, ok := supervisorProcessStartTime(cmd.Process.Pid)
	if !ok {
		t.Fatalf("read start time of %d", cmd.Process.Pid)
	}
	return supervisorPIDMetadata{
		PID:                    cmd.Process.Pid,
		EngineKind:             kind,
		ExpectedExecutablePath: canonicalSupervisorProcessPath(executable),
		ProcessStartTime:       startTime,
	}
}

func processGroupGone(pgid int) bool {
	err := syscall.Kill(-pgid, 0)
	return errors.Is(err, syscall.ESRCH)
}

func TestStaleReclaimRefusesRecordsThatDoNotProveTheProcessInstance(t *testing.T) {
	setSupervisorTestHome(t)
	executable, err := os.Executable()
	if err != nil {
		t.Fatalf("os.Executable: %v", err)
	}
	for name, mutate := range map[string]func(*supervisorPIDMetadata){
		"no instance evidence":    func(m *supervisorPIDMetadata) { m.ProcessStartTime = "" },
		"another instance":        func(m *supervisorPIDMetadata) { m.ProcessStartTime += "1" },
		"another engine's record": func(m *supervisorPIDMetadata) { m.EngineKind = EngineSpeech },
	} {
		t.Run(name, func(t *testing.T) {
			helper := startSupervisorHelperProcess(t, "sleep")
			record := helperRecord(t, helper, EngineLlama, executable)
			mutate(&record)
			root := t.TempDir()
			pidPath, metadataPath := writeStaleRecord(t, root, EngineLlama, helper.Process.Pid, record)

			reclaimStaleSupervisedProcess(testLogger(), EngineLlama, pidPath, metadataPath)

			time.Sleep(200 * time.Millisecond)
			if !testProcessAlive(helper.Process.Pid) {
				t.Fatalf("process %d was killed without proof it is the recorded engine instance", helper.Process.Pid)
			}
			if _, err := os.Stat(pidPath); !os.IsNotExist(err) {
				t.Fatalf("expected the unprovable record to be dropped, got %v", err)
			}
		})
	}
}

func TestProcessIdentityKeepsExecutablePathsWithSpaces(t *testing.T) {
	setSupervisorTestHome(t)
	source, err := os.Executable()
	if err != nil {
		t.Fatalf("os.Executable: %v", err)
	}
	payload, err := os.ReadFile(source)
	if err != nil {
		t.Fatalf("read test binary: %v", err)
	}
	dir := filepath.Join(t.TempDir(), "Library", "Application Support", "Nimi Engines")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	engine := filepath.Join(dir, "engine copy")
	if err := os.WriteFile(engine, payload, 0o755); err != nil {
		t.Fatalf("copy test binary: %v", err)
	}
	cmd := exec.Command(engine, "-test.run=^TestSupervisorHelperProcess$", "--", "sleep")
	cmd.Env = append(os.Environ(), "GO_WANT_SUPERVISOR_HELPER_PROCESS=1")
	setSupervisorProcessGroup(cmd)
	if err := cmd.Start(); err != nil {
		t.Fatalf("start engine copy: %v", err)
	}
	exited := make(chan struct{})
	go func() {
		_ = cmd.Wait()
		close(exited)
	}()
	t.Cleanup(func() {
		_ = cmd.Process.Kill()
		<-exited
	})

	if observed := observedSupervisorExecutablePath(cmd.Process.Pid); observed != canonicalSupervisorProcessPath(engine) {
		t.Fatalf("observed executable %q, want %q", observed, canonicalSupervisorProcessPath(engine))
	}
	if matches, validated := supervisorProcessMatchesExpectedPath(cmd.Process.Pid, engine); !matches || !validated {
		t.Fatalf("expected the whole spaced path to match, got matches=%v validated=%v", matches, validated)
	}
	truncated := filepath.Join(filepath.Dir(filepath.Dir(dir)), "Application")
	if matches, _ := supervisorProcessMatchesExpectedPath(cmd.Process.Pid, truncated); matches {
		t.Fatalf("a path cut at its first space must not match")
	}

	root := t.TempDir()
	pidPath, metadataPath := writeStaleRecord(t, root, EngineLlama, cmd.Process.Pid, helperRecord(t, cmd, EngineLlama, engine))
	reclaimStaleSupervisedProcess(testLogger(), EngineLlama, pidPath, metadataPath)
	select {
	case <-exited:
	case <-time.After(3 * time.Second):
		t.Fatalf("expected the recorded engine instance under a spaced path to be reclaimed")
	}
}

func TestManagerStartReclaimsProvenStaleEnginesOfEveryKind(t *testing.T) {
	setSupervisorTestHome(t)
	executable, err := os.Executable()
	if err != nil {
		t.Fatalf("os.Executable: %v", err)
	}
	root := t.TempDir()
	stale := startSupervisorHelperProcess(t, "sleep")
	writeStaleRecord(t, root, EngineSpeech, stale.Process.Pid, helperRecord(t, stale, EngineSpeech, executable))
	unproven := startSupervisorHelperProcess(t, "sleep")
	legacy := helperRecord(t, unproven, engineManagedImageBackend, executable)
	legacy.ProcessStartTime = ""
	writeStaleRecord(t, root, engineManagedImageBackend, unproven.Process.Pid, legacy)
	exited := make(chan struct{})
	go func() {
		_ = stale.Wait()
		close(exited)
	}()

	if _, err := NewManager(testLogger(), ManagedRoots{Environments: root, Dependencies: t.TempDir()}, nil); err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	select {
	case <-exited:
	case <-time.After(3 * time.Second):
		t.Fatalf("expected the proven stale speech engine %d to be reclaimed at manager start", stale.Process.Pid)
	}
	if !testProcessAlive(unproven.Process.Pid) {
		t.Fatalf("a legacy record without instance evidence must not be reclaimed")
	}
}

func startGuardedHelper(t *testing.T, mode string, grace time.Duration) (*exec.Cmd, *supervisorOwnerRelease) {
	t.Helper()
	executable, err := os.Executable()
	if err != nil {
		t.Fatalf("os.Executable: %v", err)
	}
	cmd := exec.Command(executable, "-test.run=^TestSupervisorHelperProcess$", "--", mode)
	cmd.Env = append(os.Environ(), "GO_WANT_SUPERVISOR_HELPER_PROCESS=1")
	setSupervisorProcessGroup(cmd)
	reader, release, err := guardSupervisorProcessOwner(cmd, grace)
	if err != nil {
		t.Fatalf("guard: %v", err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatalf("start guarded helper: %v", err)
	}
	_ = reader.Close()
	t.Cleanup(func() {
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		_ = cmd.Wait()
	})
	if !waitForCondition(2*time.Second, func() bool {
		return observedSupervisorExecutablePath(cmd.Process.Pid) == canonicalSupervisorProcessPath(executable)
	}) {
		t.Fatalf("the guard did not exec the engine in place")
	}
	return cmd, release
}

func waitExit(cmd *exec.Cmd, timeout time.Duration) (bool, error) {
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err := <-done:
		return true, err
	case <-time.After(timeout):
		return false, nil
	}
}

func TestOwnerGuardEndsTheEngineTreeWhenTheRuntimeIsGone(t *testing.T) {
	setSupervisorTestHome(t)
	cmd, release := startGuardedHelper(t, "sleep", time.Second)
	// The Runtime disappearing closes its end without the release byte.
	_ = release.writer.Close()
	exited, err := waitExit(cmd, 3*time.Second)
	if !exited {
		t.Fatalf("expected the engine to end once its Runtime owner was gone")
	}
	var exitErr *exec.ExitError
	if !errors.As(err, &exitErr) || exitErr.Sys().(syscall.WaitStatus).Signal() != syscall.SIGTERM {
		t.Fatalf("expected a graceful SIGTERM first, got %v", err)
	}
	if !waitForCondition(3*time.Second, func() bool { return processGroupGone(cmd.Process.Pid) }) {
		t.Fatalf("expected the whole engine group to end")
	}
}

func TestOwnerGuardKillsAnEngineThatIgnoresTheStopAfterItsBudget(t *testing.T) {
	setSupervisorTestHome(t)
	cmd, release := startGuardedHelper(t, "ignore-term", time.Second)
	// Let the helper install its SIGTERM handler before the owner goes away.
	time.Sleep(500 * time.Millisecond)
	started := time.Now()
	_ = release.writer.Close()
	exited, err := waitExit(cmd, 5*time.Second)
	if !exited {
		t.Fatalf("expected the engine to be killed after the shutdown budget")
	}
	var exitErr *exec.ExitError
	if !errors.As(err, &exitErr) || exitErr.Sys().(syscall.WaitStatus).Signal() != syscall.SIGKILL {
		t.Fatalf("expected SIGKILL after the budget, got %v", err)
	}
	if elapsed := time.Since(started); elapsed < 900*time.Millisecond {
		t.Fatalf("the budget was not honoured: killed after %s", elapsed)
	}
}

func TestOwnerGuardDoesNotDelayNormalSupervisorStop(t *testing.T) {
	setSupervisorTestHome(t)
	cmd, release := startGuardedHelper(t, "sleep", 30*time.Second)
	lifecycle, err := bindSupervisorProcessLifecycle(cmd)
	if err != nil {
		t.Fatal(err)
	}
	process := &supervisedProcess{cmd: cmd, lifecycle: lifecycle, ownerRelease: release, done: make(chan struct{}), lifecycleWaitTimeout: 3 * time.Second}
	sup := NewSupervisor(EngineConfig{Kind: EngineSpeech, ShutdownTimeout: 30 * time.Second}, testLogger(), nil)
	sup.cmd, sup.process = cmd, process
	go waitSupervisorProcess(process)
	started := time.Now()
	if err := sup.Stop(); err != nil {
		t.Fatal(err)
	}
	if elapsed := time.Since(started); elapsed > 2*time.Second {
		t.Fatalf("normal Stop waited for the guard budget: %s", elapsed)
	}
	if !waitForCondition(time.Second, func() bool { return processGroupGone(cmd.Process.Pid) }) {
		t.Fatalf("the guard must not linger after engine exit")
	}
}

// Runs the real Stop method in a disposable Runtime owner. The engine reports
// receipt of TERM before the outer test kills this owner, avoiding timing guesses.
func TestSupervisorStopOwnerHelper(t *testing.T) {
	mode := os.Getenv("NIMI_TEST_STOP_OWNER")
	if mode == "" {
		t.Skip("subprocess helper")
	}
	cmd := exec.Command("/bin/sh", "-c", "trap 'echo stopping' TERM; echo ready; while :; do sleep 1; done")
	setSupervisorProcessGroup(cmd)
	reader, release, err := guardSupervisorProcessOwner(cmd, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	_ = reader.Close()
	scanner := bufio.NewScanner(stdout)
	if !scanner.Scan() {
		t.Fatal("engine did not start")
	}
	lifecycle, err := bindSupervisorProcessLifecycle(cmd)
	if err != nil {
		t.Fatal(err)
	}
	process := &supervisedProcess{cmd: cmd, lifecycle: lifecycle, ownerRelease: release, done: make(chan struct{}), lifecycleWaitTimeout: 15 * time.Second}
	sup := NewSupervisor(EngineConfig{Kind: EngineSpeech, ShutdownTimeout: 10 * time.Second}, testLogger(), nil)
	sup.cmd, sup.process = cmd, process
	go waitSupervisorProcess(process)
	if mode == "during-stop" {
		go func() { _ = sup.Stop() }()
		if !scanner.Scan() {
			t.Fatal("engine did not receive TERM")
		}
	}
	fmt.Printf("child=%d\n", cmd.Process.Pid)
	select {}
}

func TestSupervisorOwnerLossDuringGracefulStop(t *testing.T) {
	for _, mode := range []string{"before-stop", "during-stop"} {
		t.Run(mode, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
			defer cancel()
			parent := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestSupervisorStopOwnerHelper$")
			parent.Env = append(os.Environ(), "NIMI_TEST_STOP_OWNER="+mode)
			stdout, err := parent.StdoutPipe()
			if err != nil {
				t.Fatal(err)
			}
			if err := parent.Start(); err != nil {
				t.Fatal(err)
			}
			defer func() { _ = parent.Process.Kill(); _ = parent.Wait() }()
			line, err := bufio.NewReader(stdout).ReadString('\n')
			if err != nil {
				t.Fatal(err)
			}
			pid, err := strconv.Atoi(strings.TrimSpace(strings.TrimPrefix(line, "child=")))
			if err != nil {
				t.Fatal(line, err)
			}
			defer func() { _ = syscall.Kill(-pid, syscall.SIGKILL) }()
			_ = parent.Process.Kill()
			_ = parent.Wait()
			if !waitForCondition(4*time.Second, func() bool { return processGroupGone(pid) }) {
				t.Fatalf("engine group %d survived Runtime loss %s", pid, mode)
			}
		})
	}
}

func TestStopAllKillsEnginesStillRunningAtTheShutdownDeadline(t *testing.T) {
	setSupervisorTestHome(t)
	mgr, err := NewManager(testLogger(), ManagedRoots{Environments: testSupervisedRoot(), Dependencies: t.TempDir()}, nil)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	cfg := testSupervisorCfg(writeTestScript(t, "trap '' TERM; while :; do sleep 1; done"))
	cfg.ShutdownTimeout = 20 * time.Second
	sup := NewSupervisor(cfg, testLogger(), nil)
	if err := sup.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	pid := sup.Info().PID
	mgr.SetSupervisorForTesting(cfg.Kind, sup)

	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	started := time.Now()
	mgr.StopAll(ctx)
	if elapsed := time.Since(started); elapsed > 3*time.Second {
		t.Fatalf("StopAll outran its deadline: %s", elapsed)
	}
	if !waitForCondition(2*time.Second, func() bool { return processGroupGone(pid) }) {
		t.Fatalf("expected the engine tree to be killed at the deadline")
	}
}

func TestStopAllCancelsAnEngineStartInFlight(t *testing.T) {
	setSupervisorTestHome(t)
	mgr, err := NewManager(testLogger(), ManagedRoots{Environments: testSupervisedRoot(), Dependencies: t.TempDir()}, nil)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	cfg := testSupervisorCfg(writeTestScript(t, "sleep 60"))
	cfg.StartupTimeout = time.Minute
	started := make(chan error, 1)
	go func() { started <- mgr.StartEngine(context.Background(), cfg) }()
	pid := 0
	if !waitForCondition(3*time.Second, func() bool {
		info, err := mgr.EngineStatus(cfg.Kind)
		pid = info.PID
		return err == nil && info.Status == StatusStarting && info.PID > 0
	}) {
		t.Fatalf("engine never began starting")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	stopStarted := time.Now()
	mgr.StopAll(ctx)
	if elapsed := time.Since(stopStarted); elapsed > 4*time.Second {
		t.Fatalf("StopAll waited on the start instead of canceling it: %s", elapsed)
	}
	select {
	case err := <-started:
		if err == nil {
			t.Fatalf("expected the start in flight to be canceled")
		}
	case <-time.After(3 * time.Second):
		t.Fatalf("the start in flight did not return")
	}
	if pid > 0 && !waitForCondition(3*time.Second, func() bool { return processGroupGone(pid) }) {
		t.Fatalf("expected the canceled start's process tree to be gone")
	}
}

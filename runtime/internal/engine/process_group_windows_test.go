//go:build windows

package engine

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

func TestSupervisorProcessUsesServiceSafeConsoleIsolation(t *testing.T) {
	command := exec.Command(os.Args[0], "-test.run=TestManagedCommandHelperProcess")
	setSupervisorProcessGroup(command)
	if command.SysProcAttr == nil || !command.SysProcAttr.HideWindow {
		t.Fatal("supervised Windows engine must hide its Session 0 window")
	}
	if command.SysProcAttr.CreationFlags&windows.CREATE_NO_WINDOW == 0 {
		t.Fatalf("supervised Windows engine creation flags = %#x, want CREATE_NO_WINDOW", command.SysProcAttr.CreationFlags)
	}
}

func TestWindowsJobExitRequiresLastProcessAndRetainsConfirmation(t *testing.T) {
	gate := filepath.Join(t.TempDir(), "start-child")
	parent := exec.Command(os.Args[0], "-test.run=^TestWindowsJobTreeProbe$", "--", "parent", gate)
	setSupervisorProcessGroup(parent)
	if err := parent.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = parent.Process.Kill() }()
	tree, err := bindSupervisorProcessLifecycle(parent)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = releaseSupervisorProcessLifecycle(tree) }()
	if err := os.WriteFile(gate, nil, 0600); err != nil {
		t.Fatal(err)
	}
	reaped := make(chan error, 1)
	go func() { reaped <- parent.Wait() }()
	select {
	case err := <-reaped:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the parent did not finish after starting its child")
	}
	if exited, err := supervisorProcessLifecycleExited(tree); err != nil || exited {
		t.Fatalf("parent exit with live child: exited=%v err=%v", exited, err)
	}
	if err := signalSupervisorProcessLifecycle(tree, syscall.SIGKILL); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		exited, err := supervisorProcessLifecycleExited(tree)
		if err != nil {
			t.Fatal(err)
		}
		if exited {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the Job never reached zero active processes")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err := releaseSupervisorProcessLifecycle(tree); err != nil {
		t.Fatal(err)
	}
	if exited, err := supervisorProcessLifecycleExited(tree); !exited || err != nil {
		t.Fatalf("confirmed exit after handle release: exited=%v err=%v", exited, err)
	}
}

func TestWindowsJobHandleLossLeavesExitUnconfirmed(t *testing.T) {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	tree := &supervisorProcessLifecycle{job: job}
	if err := releaseSupervisorProcessLifecycle(tree); err != nil {
		t.Fatal(err)
	}
	if exited, err := supervisorProcessLifecycleExited(tree); exited || err == nil {
		t.Fatalf("lost handle was treated as proof: exited=%v err=%v", exited, err)
	}
}

func TestWindowsJobNaturalExitAndAccountingQueryFailure(t *testing.T) {
	gate := filepath.Join(t.TempDir(), "exit")
	command := exec.Command(os.Args[0], "-test.run=^TestWindowsJobTreeProbe$", "--", "wait-for-natural-exit", gate)
	setSupervisorProcessGroup(command)
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = command.Process.Kill() }()
	reaped := make(chan error, 1)
	go func() { reaped <- command.Wait() }()
	tree, err := bindSupervisorProcessLifecycle(command)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = releaseSupervisorProcessLifecycle(tree) }()

	// Keep a real handle to the same Job, but without JOB_OBJECT_QUERY.
	const jobObjectTerminateAccess = 0x0008
	var limited windows.Handle
	self := windows.CurrentProcess()
	if err := windows.DuplicateHandle(self, tree.job, self, &limited, jobObjectTerminateAccess, false, 0); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = windows.CloseHandle(limited) }()
	withoutQuery := &supervisorProcessLifecycle{job: limited}
	if exited, err := supervisorProcessLifecycleExited(withoutQuery); exited || !errors.Is(err, windows.ERROR_ACCESS_DENIED) {
		t.Fatalf("query with insufficient access: exited=%v err=%v", exited, err)
	}
	if exited, err := supervisorProcessLifecycleExited(tree); exited || err != nil {
		t.Fatalf("process before natural exit: exited=%v err=%v", exited, err)
	}
	if err := os.WriteFile(gate, nil, 0600); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-reaped:
		if err != nil {
			t.Fatalf("wait for natural process exit: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the process did not exit naturally")
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		exited, err := supervisorProcessLifecycleExited(tree)
		if err != nil || time.Now().After(deadline) {
			t.Fatalf("confirm natural process exit: exited=%v err=%v", exited, err)
		}
		if exited {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if exited, err := supervisorProcessLifecycleExited(withoutQuery); exited || !errors.Is(err, windows.ERROR_ACCESS_DENIED) {
		t.Fatalf("query failure after natural exit: exited=%v err=%v", exited, err)
	}
}

func TestWindowsJobTreeProbe(t *testing.T) {
	for i, arg := range os.Args {
		switch {
		case (arg == "parent" || arg == "wait-for-natural-exit") && i+1 < len(os.Args):
			deadline := time.Now().Add(5 * time.Second)
			for {
				if _, err := os.Stat(os.Args[i+1]); err == nil {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("the Job Object probe gate did not open")
				}
				time.Sleep(10 * time.Millisecond)
			}
			if arg == "wait-for-natural-exit" {
				return
			}
			child := exec.Command(os.Args[0], "-test.run=^TestWindowsJobTreeProbe$", "--", "child")
			if err := child.Start(); err != nil {
				t.Fatal(fmt.Errorf("start owned child: %w", err))
			}
			_ = child.Process.Release()
			return
		case arg == "child":
			time.Sleep(15 * time.Second)
			return
		}
	}
}

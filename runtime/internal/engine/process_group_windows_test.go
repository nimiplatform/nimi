//go:build windows

package engine

import (
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
	defer parent.Process.Kill()
	tree, err := bindSupervisorProcessLifecycle(parent)
	if err != nil {
		t.Fatal(err)
	}
	defer releaseSupervisorProcessLifecycle(tree)
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

func TestWindowsJobTreeProbe(t *testing.T) {
	for i, arg := range os.Args {
		switch {
		case arg == "parent" && i+1 < len(os.Args):
			deadline := time.Now().Add(5 * time.Second)
			for {
				if _, err := os.Stat(os.Args[i+1]); err == nil {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("parent was not bound before the gate expired")
				}
				time.Sleep(10 * time.Millisecond)
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

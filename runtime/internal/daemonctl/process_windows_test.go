//go:build windows

package daemonctl

import (
	"os"
	"os/exec"
	"testing"

	"golang.org/x/sys/windows"
)

func TestDetachCommandUsesHiddenIndependentConsole(t *testing.T) {
	cmd := exec.Command(os.Args[0])
	detachCommand(cmd)

	if cmd.SysProcAttr == nil {
		t.Fatal("expected windows process attributes")
	}
	if !cmd.SysProcAttr.HideWindow {
		t.Fatal("expected daemon console to be hidden")
	}
	flags := cmd.SysProcAttr.CreationFlags
	if flags&windows.CREATE_NEW_PROCESS_GROUP == 0 {
		t.Fatal("expected daemon to run in a new process group")
	}
	if flags&windows.CREATE_NEW_CONSOLE == 0 {
		t.Fatal("expected daemon to own an inheritable hidden console")
	}
	if flags&windows.DETACHED_PROCESS != 0 {
		t.Fatal("detached daemon has no console for descendants to inherit")
	}
	if flags&windows.CREATE_NO_WINDOW != 0 {
		t.Fatal("CREATE_NO_WINDOW breaks descendant console inheritance")
	}
}

func TestDefaultProcessAliveReportsCurrentProcess(t *testing.T) {
	if !defaultProcessAlive(os.Getpid()) {
		t.Fatal("expected current process to be reported as alive")
	}
}

func TestDefaultProcessAliveRejectsInvalidPID(t *testing.T) {
	if defaultProcessAlive(-1) {
		t.Fatal("expected invalid pid to be reported as not alive")
	}
}

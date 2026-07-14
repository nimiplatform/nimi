//go:build windows

package engine

import (
	"os"
	"os/exec"
	"testing"

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

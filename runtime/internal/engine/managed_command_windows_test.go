//go:build windows

package engine

import (
	"os"
	"os/exec"
	"testing"

	"golang.org/x/sys/windows"
)

func TestConfigureManagedCommandUsesServiceSafeConsoleIsolation(t *testing.T) {
	command := exec.Command(os.Args[0], "-test.run=TestManagedCommandHelperProcess")
	command.Env = append(os.Environ(), "NIMI_MANAGED_COMMAND_HELPER=1")
	configureManagedCommand(command)
	if command.SysProcAttr == nil || !command.SysProcAttr.HideWindow {
		t.Fatal("managed command must hide its Session 0 window")
	}
	if command.SysProcAttr.CreationFlags&windows.CREATE_NO_WINDOW == 0 {
		t.Fatalf("managed command creation flags = %#x, want CREATE_NO_WINDOW", command.SysProcAttr.CreationFlags)
	}
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("service-safe managed command: %v (%s)", err, output)
	}
}

func TestManagedCommandHelperProcess(t *testing.T) {
	if os.Getenv("NIMI_MANAGED_COMMAND_HELPER") != "1" {
		return
	}
	os.Exit(0)
}

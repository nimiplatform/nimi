//go:build windows

package localservice

import (
	"context"
	"testing"

	"golang.org/x/sys/windows"
)

func TestLocalRuntimeProbeCommandUsesWindowsServiceSafeCreation(t *testing.T) {
	cmd := newLocalRuntimeProbeCommand(context.Background(), "cmd.exe", "/c", "exit", "0")
	if cmd.SysProcAttr == nil {
		t.Fatal("Windows Runtime probe command must configure service-safe process attributes")
	}
	if !cmd.SysProcAttr.HideWindow {
		t.Fatal("Windows Runtime probe command must hide its console window")
	}
	if cmd.SysProcAttr.CreationFlags&windows.CREATE_NO_WINDOW == 0 {
		t.Fatalf("Windows Runtime probe command creation flags = %#x, want CREATE_NO_WINDOW", cmd.SysProcAttr.CreationFlags)
	}
}

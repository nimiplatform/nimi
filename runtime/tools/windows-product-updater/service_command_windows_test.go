//go:build windows

package main

import (
	"golang.org/x/sys/windows"
	"syscall"
	"testing"
)

func TestNativeServiceCommandMatchesActualCreateServiceAndWindowsArgumentTools(t *testing.T) {
	for _, executable := range []string{`C:\Program Files\Nimi\Product\0.3.0\runtime\nimi.exe`, `D:\Apps\Nimi\Product\0.3.0\runtime\nimi.exe`} {
		created := syscall.EscapeArg(executable) + " " + syscall.EscapeArg("serve")
		updated, err := runtimeServiceCommand(executable)
		if err != nil || updated != created {
			t.Fatalf("actual CreateService and UpdateConfig differ: %q %q %v", created, updated, err)
		}
		args, err := windows.DecomposeCommandLine(created)
		if err != nil || len(args) != 2 || args[0] != executable || args[1] != "serve" {
			t.Fatalf("Windows decoded args %v %v", args, err)
		}
		parsed, err := runtimeServiceExecutable(updated)
		if err != nil || parsed != executable {
			t.Fatalf("probe/repair parsed %q %v", parsed, err)
		}
		if _, err := runtimeServiceExecutable(updated + " --extra"); err == nil {
			t.Fatal("additional argument admitted")
		}
	}
}

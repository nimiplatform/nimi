//go:build windows

package main

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"syscall"
	"testing"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

const shutdownTestRole = "NIMI_SOURCE_SUPERVISOR_SHUTDOWN_TEST_ROLE"

func TestWindowsOwnedRuntimeShutdown(t *testing.T) {
	for _, testCase := range []struct {
		name  string
		flags uint32
	}{
		{"detached", windows.DETACHED_PROCESS | windows.CREATE_NEW_PROCESS_GROUP},
		{"console", windows.CREATE_NEW_CONSOLE},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
			defer cancel()
			owner := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestWindowsShutdownProcessHelper$", "-test.v")
			owner.Env = append(os.Environ(), shutdownTestRole+"=owner")
			owner.SysProcAttr = &syscall.SysProcAttr{CreationFlags: testCase.flags, HideWindow: true}
			output, err := owner.CombinedOutput()
			if err != nil {
				t.Fatalf("isolated %s owner: %v\n%s", testCase.name, err, output)
			}
		})
	}
}

// All control events target a child created by this helper in its isolated
// console/process group. No actual Runtime, Home, service, or shared owner runs.
func TestWindowsShutdownProcessHelper(t *testing.T) {
	switch os.Getenv(shutdownTestRole) {
	case "runtime":
		interrupt := make(chan os.Signal, 1)
		signal.Notify(interrupt, os.Interrupt)
		defer signal.Stop(interrupt)
		fmt.Printf("ready console=%t\n", testHasConsole())
		select {
		case <-interrupt:
			fmt.Println("graceful-stop-observed")
		case <-time.After(5 * time.Second):
			t.Fatal("owned helper received no graceful stop")
		}
	case "owner":
		consoleBefore := testHasConsole()
		child := exec.Command(os.Args[0], "-test.run=^TestWindowsShutdownProcessHelper$")
		child.Env = append(os.Environ(), shutdownTestRole+"=runtime")
		child.Stderr = os.Stderr
		configureRuntimeCommand(child)
		child.SysProcAttr.HideWindow = true
		stdout, err := child.StdoutPipe()
		if err != nil {
			t.Fatal(err)
		}
		if err := child.Start(); err != nil {
			t.Fatal(err)
		}
		waited := false
		defer func() {
			if !waited {
				_ = child.Process.Kill()
				_ = child.Wait()
			}
		}()
		reader := bufio.NewReader(stdout)
		ready := make(chan string, 1)
		go func() { line, _ := reader.ReadString('\n'); ready <- line }()
		var line string
		select {
		case line = <-ready:
			if !strings.HasPrefix(line, "ready ") {
				t.Fatalf("owned helper did not become ready: %q", line)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("owned helper startup timed out")
		}
		if err := requestRuntimeStop(child.Process); err != nil {
			t.Fatalf("request owned stop (owner console=%t, child %s): %v", testHasConsole(), strings.TrimSpace(line), err)
		}
		if testHasConsole() != consoleBefore {
			t.Fatal("stop changed the supervisor's original console attachment")
		}
		remaining, err := io.ReadAll(reader)
		if err != nil {
			t.Fatal(err)
		}
		err = child.Wait()
		waited = true
		if err != nil || !strings.Contains(string(remaining), "graceful-stop-observed") {
			t.Fatalf("child did not finish through its signal handler: %v\n%s", err, remaining)
		}
	default:
		return
	}
}

func testHasConsole() bool {
	var processes [1]uint32
	count, _, _ := windows.NewLazySystemDLL("kernel32.dll").NewProc("GetConsoleProcessList").Call(
		uintptr(unsafe.Pointer(&processes[0])), uintptr(len(processes)))
	return count != 0
}

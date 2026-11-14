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
		{"no-window", windows.CREATE_NO_WINDOW | windows.CREATE_NEW_PROCESS_GROUP},
		{"detached-no-window", windows.DETACHED_PROCESS | windows.CREATE_NO_WINDOW | windows.CREATE_NEW_PROCESS_GROUP},
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
			t.Logf("isolated %s owner:\n%s", testCase.name, output)
		})
	}
}

// All control events target a child created by this helper in its isolated
// console/process group. No actual Runtime, Home, service, or shared owner runs.
func TestWindowsShutdownProcessHelper(t *testing.T) {
	switch os.Getenv(shutdownTestRole) {
	case "runtime", "bystander":
		interrupt := make(chan os.Signal, 1)
		signal.Notify(interrupt, os.Interrupt)
		defer signal.Stop(interrupt)
		fmt.Printf("ready console=%t visible=%t\n", testHasConsole(), testConsoleVisible())
		var finish <-chan struct{}
		if os.Getenv(shutdownTestRole) == "bystander" {
			done := make(chan struct{})
			finish = done
			go func() {
				_, _ = bufio.NewReader(os.Stdin).ReadString('\n')
				close(done)
			}()
		}
		select {
		case <-interrupt:
			if os.Getenv(shutdownTestRole) == "bystander" {
				t.Fatal("owned stop reached a different process group")
			}
			fmt.Println("graceful-stop-observed")
		case <-finish:
			fmt.Println("bystander-completed")
		case <-time.After(5 * time.Second):
			t.Fatal("owned helper received no graceful stop")
		}
	case "owner":
		consoleBefore := testHasConsole()
		bystander := exec.Command(os.Args[0], "-test.run=^TestWindowsShutdownProcessHelper$")
		bystander.Env = append(os.Environ(), shutdownTestRole+"=bystander")
		configureRuntimeCommand(bystander)
		finish, err := bystander.StdinPipe()
		if err != nil {
			t.Fatal(err)
		}
		bystanderOutput, err := bystander.StdoutPipe()
		if err != nil {
			t.Fatal(err)
		}
		if err := bystander.Start(); err != nil {
			t.Fatal(err)
		}
		defer func() {
			_ = finish.Close()
			if bystander.ProcessState == nil {
				_ = bystander.Process.Kill()
				_ = bystander.Wait()
			}
		}()
		bystanderReader := bufio.NewReader(bystanderOutput)
		if line, err := bystanderReader.ReadString('\n'); err != nil || !strings.HasPrefix(line, "ready console=true") {
			t.Fatalf("isolated bystander startup: %q, %v", line, err)
		}
		child := exec.Command(os.Args[0], "-test.run=^TestWindowsShutdownProcessHelper$")
		child.Env = append(os.Environ(), shutdownTestRole+"=runtime")
		child.Stderr = os.Stderr
		configureRuntimeCommand(child)
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
		fmt.Printf("owner console=%t, child %s", consoleBefore, line)
		if !strings.HasPrefix(line, "ready console=true visible=false") {
			t.Fatalf("owned helper needs a hidden controllable console: %q", line)
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
		if _, err := io.WriteString(finish, "finish\n"); err != nil {
			t.Fatalf("bystander exited before its independent completion: %v", err)
		}
		otherOutput, err := io.ReadAll(bystanderReader)
		if err != nil {
			t.Fatal(err)
		}
		if err := bystander.Wait(); err != nil || !strings.Contains(string(otherOutput), "bystander-completed") {
			t.Fatalf("owned stop changed another process group: %v\n%s", err, otherOutput)
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

func testConsoleVisible() bool {
	window, _, _ := windows.NewLazySystemDLL("kernel32.dll").NewProc("GetConsoleWindow").Call()
	if window == 0 {
		return false
	}
	visible, _, _ := windows.NewLazySystemDLL("user32.dll").NewProc("IsWindowVisible").Call(window)
	return visible != 0
}

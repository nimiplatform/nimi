//go:build windows

package main

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestManagedTimeoutKillsCompleteWindowsProcessTree(t *testing.T) {
	pidFile := filepath.Join(t.TempDir(), "child.pid")
	ctx, cancel := context.WithTimeout(context.Background(), 1200*time.Millisecond)
	defer cancel()
	cmd := exec.Command(os.Args[0], "-test.run=TestRuntimeComplianceProcessTreeHelper", "--")
	cmd.Env = append(os.Environ(),
		"NIMI_RUNTIME_COMPLIANCE_PROCESS_HELPER=1",
		"NIMI_RUNTIME_COMPLIANCE_CHILD_PID_FILE="+pidFile,
	)
	var output bytes.Buffer
	timedOut, err := runManagedCommand(ctx, cmd, &output, &output, nil)
	if !timedOut || err == nil {
		t.Fatalf("expected managed timeout, timedOut=%t err=%v output=%s", timedOut, err, output.String())
	}
	rawPID, readErr := os.ReadFile(pidFile)
	if readErr != nil {
		t.Fatalf("helper did not publish child pid: %v output=%s", readErr, output.String())
	}
	pid, parseErr := strconv.Atoi(strings.TrimSpace(string(rawPID)))
	if parseErr != nil {
		t.Fatalf("invalid child pid %q: %v", rawPID, parseErr)
	}
	deadline := time.Now().Add(3 * time.Second)
	for processExistsWindows(pid) && time.Now().Before(deadline) {
		time.Sleep(100 * time.Millisecond)
	}
	if processExistsWindows(pid) {
		t.Fatalf("child process %d survived managed process-tree timeout", pid)
	}
}

func TestRuntimeComplianceProcessTreeHelper(t *testing.T) {
	if os.Getenv("NIMI_RUNTIME_COMPLIANCE_PROCESS_HELPER") != "1" {
		return
	}
	child := exec.Command("ping.exe", "-t", "127.0.0.1")
	if err := child.Start(); err != nil {
		t.Fatalf("start child: %v", err)
	}
	pidFile := os.Getenv("NIMI_RUNTIME_COMPLIANCE_CHILD_PID_FILE")
	if err := os.WriteFile(pidFile, []byte(strconv.Itoa(child.Process.Pid)), 0o600); err != nil {
		t.Fatalf("write child pid: %v", err)
	}
	time.Sleep(10 * time.Minute)
}

func processExistsWindows(pid int) bool {
	output, err := exec.Command("tasklist.exe", "/FI", fmt.Sprintf("PID eq %d", pid), "/FO", "CSV", "/NH").Output()
	if err != nil {
		return false
	}
	return strings.Contains(string(output), fmt.Sprintf("\",\"%d\",", pid))
}

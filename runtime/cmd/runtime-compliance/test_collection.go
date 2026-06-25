package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"time"
)

type goTestEvent struct {
	Action  string `json:"Action"`
	Package string `json:"Package"`
	Test    string `json:"Test"`
}

func collectPassingTests() (map[string]bool, error) {
	passed, malformedEvents, err := collectPassingTestsOnce()
	if err == nil {
		reportMalformedTestEvents(malformedEvents)
		return passed, nil
	}
	time.Sleep(500 * time.Millisecond)
	retried, retryMalformedEvents, retryErr := collectPassingTestsOnce()
	if retryErr == nil {
		reportMalformedTestEvents(retryMalformedEvents)
		return retried, nil
	}
	return nil, errors.Join(
		fmt.Errorf("collectPassingTests attempt 1: %w", err),
		fmt.Errorf("collectPassingTests retry: %w", retryErr),
	)
}

func collectPassingTestsOnce() (map[string]bool, int, error) {
	cmd := exec.Command("go", goTestCollectionArgs()...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, 0, fmt.Errorf("collectPassingTestsOnce stdout pipe: %w", err)
	}
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return nil, 0, fmt.Errorf("collectPassingTestsOnce start go test: %w", err)
	}

	passed := make(map[string]bool)
	malformedEvents := 0
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 1024), 2*1024*1024)
	for scanner.Scan() {
		line := scanner.Bytes()
		var event goTestEvent
		if err := json.Unmarshal(line, &event); err != nil {
			malformedEvents++
			continue
		}
		if event.Action == "pass" && strings.TrimSpace(event.Test) != "" {
			passed[event.Package+":"+event.Test] = true
		}
	}
	if scanErr := scanner.Err(); scanErr != nil {
		return nil, malformedEvents, fmt.Errorf("collectPassingTestsOnce scan go test json: %w", scanErr)
	}
	if waitErr := cmd.Wait(); waitErr != nil {
		var exitErr *exec.ExitError
		if errors.As(waitErr, &exitErr) {
			return passed, malformedEvents, fmt.Errorf("collectPassingTestsOnce go test exited nonzero: %w", waitErr)
		}
		return nil, malformedEvents, fmt.Errorf("collectPassingTestsOnce wait go test: %w", waitErr)
	}
	return passed, malformedEvents, nil
}

func goTestCollectionArgs() []string {
	args := []string{"test", "-p=1", "-parallel=1", "./...", "-json", "-count=1"}
	if goruntime.GOOS != "windows" {
		return args
	}
	execPath := windowsGoTestExecSignerPath()
	if execPath == "" {
		return args
	}
	return []string{"test", "-exec", execPath, "-p=1", "-parallel=1", "./...", "-json", "-count=1"}
}

func windowsGoTestExecSignerPath() string {
	_, sourcePath, _, ok := goruntime.Caller(0)
	if !ok {
		return ""
	}
	repoRoot := filepath.Clean(filepath.Join(filepath.Dir(sourcePath), "..", "..", "..", ".."))
	execPath := filepath.Join(repoRoot, "scripts", "windows-go-test-exec-signer.cmd")
	if _, err := os.Stat(execPath); err != nil {
		return ""
	}
	return execPath
}

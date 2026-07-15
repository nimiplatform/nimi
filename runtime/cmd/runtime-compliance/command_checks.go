package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const maxCommandOutputBytes = 8192

var allowedComplianceBinaries = map[string]struct{}{
	"buf":  {},
	"go":   {},
	"node": {},
}

func runCommandCheck(ctx context.Context, spec commandCheckSpec, progress *progressReporter) commandCheckResult {
	startedAt := time.Now()
	result := commandCheckResult{
		Name:    spec.Name,
		Command: spec.Binary + " " + strings.Join(spec.Args, " "),
		Dir:     spec.Dir,
		Passed:  false,
	}

	binaryPath, err := resolveBinary(spec.Binary)
	if err != nil {
		result.Detail = err.Error()
		result.ElapsedSeconds = time.Since(startedAt).Seconds()
		return result
	}

	cmd := exec.Command(binaryPath, spec.Args...)
	if strings.TrimSpace(spec.Dir) != "" {
		cmd.Dir = spec.Dir
	}
	output := &limitedBuffer{limit: maxCommandOutputBytes}
	if progress != nil {
		progress.Item("check", spec.Name)
	}
	timedOut, err := runManagedCommand(ctx, cmd, output, output, progress)
	result.TimedOut = timedOut
	result.ElapsedSeconds = time.Since(startedAt).Seconds()
	if err != nil {
		detail := output.String()
		if detail == "" {
			detail = err.Error()
		}
		result.Detail = detail
		if progress != nil {
			progress.ItemDone("check", spec.Name, time.Since(startedAt), "fail")
		}
		return result
	}
	result.Passed = true
	if progress != nil {
		progress.ItemDone("check", spec.Name, time.Since(startedAt), "pass")
	}
	return result
}

func runChecklistCommands(
	ctx context.Context,
	checklist []checklistItemSpec,
	progress *progressReporter,
) (map[string]commandCheckResult, []commandCheckResult) {
	results := make(map[string]commandCheckResult)
	timings := make([]commandCheckResult, 0)
	for _, item := range checklist {
		for _, spec := range item.Commands {
			key := commandSpecKey(spec)
			if _, exists := results[key]; exists {
				continue
			}
			result := runCommandCheck(ctx, spec, progress)
			results[key] = result
			timings = append(timings, result)
		}
	}
	return results, timings
}

func commandSpecKey(spec commandCheckSpec) string {
	return spec.Name + "\x00" + spec.Dir + "\x00" + spec.Binary + "\x00" + strings.Join(spec.Args, "\x00")
}

func resolveBinary(name string) (string, error) {
	binaryName := strings.TrimSpace(name)
	if binaryName == "" {
		return "", errors.New("empty binary name")
	}
	if _, allowed := allowedComplianceBinaries[binaryName]; !allowed {
		return "", fmt.Errorf("binary %q is not allowed", binaryName)
	}
	if path, err := exec.LookPath(binaryName); err == nil {
		return path, nil
	}
	if binaryName == "buf" {
		out, err := exec.Command("go", "env", "GOPATH").Output()
		if err == nil {
			candidate := filepath.Join(strings.TrimSpace(string(out)), "bin", "buf")
			if info, statErr := os.Stat(candidate); statErr == nil && !info.IsDir() {
				return candidate, nil
			}
		}
	}
	return "", fmt.Errorf("binary %q not found", name)
}

type limitedBuffer struct {
	limit     int
	buffer    bytes.Buffer
	truncated bool
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	if b.limit <= 0 {
		return len(p), nil
	}
	remaining := b.limit - b.buffer.Len()
	if remaining > 0 {
		if len(p) > remaining {
			_, _ = b.buffer.Write(p[:remaining])
			b.truncated = true
			return len(p), nil
		}
		_, _ = b.buffer.Write(p)
		return len(p), nil
	}
	b.truncated = true
	return len(p), nil
}

func (b *limitedBuffer) String() string {
	text := strings.TrimSpace(b.buffer.String())
	if b.truncated {
		if text == "" {
			return "...(truncated)"
		}
		return text + "...(truncated)"
	}
	return text
}

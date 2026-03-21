package main

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const maxCommandOutputBytes = 8192

var allowedComplianceBinaries = map[string]struct{}{
	"buf":  {},
	"go":   {},
	"node": {},
}

func runCommandCheck(spec commandCheckSpec) commandCheckResult {
	result := commandCheckResult{
		Name:    spec.Name,
		Command: spec.Binary + " " + strings.Join(spec.Args, " "),
		Dir:     spec.Dir,
		Passed:  false,
	}

	binaryPath, err := resolveBinary(spec.Binary)
	if err != nil {
		result.Detail = err.Error()
		return result
	}

	cmd := exec.Command(binaryPath, spec.Args...)
	if strings.TrimSpace(spec.Dir) != "" {
		cmd.Dir = spec.Dir
	}
	output := &limitedBuffer{limit: maxCommandOutputBytes}
	cmd.Stdout = output
	cmd.Stderr = output
	err = cmd.Run()
	if err != nil {
		detail := output.String()
		if detail == "" {
			detail = err.Error()
		}
		result.Detail = detail
		return result
	}
	result.Passed = true
	return result
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

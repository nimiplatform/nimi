package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const sourceBindingSchema = "nimi.runtime-source-binding/v1"

type sourceBinding struct {
	SchemaVersion         string   `json:"schema_version"`
	HEAD                  string   `json:"head"`
	SourceSHA256          string   `json:"source_sha256"`
	Dirty                 bool     `json:"dirty"`
	DirtyEntries          []string `json:"dirty_entries"`
	DirtyDescriptorSHA256 string   `json:"dirty_descriptor_sha256"`
	GoVersion             string   `json:"go_version"`
	GOOS                  string   `json:"goos"`
	GOARCH                string   `json:"goarch"`
	CapturedAt            string   `json:"captured_at"`
}

func captureSourceBinding() (sourceBinding, error) {
	repoRootRaw, err := exec.Command("git", "rev-parse", "--show-toplevel").Output()
	if err != nil {
		return sourceBinding{}, fmt.Errorf("git repository root: %w", err)
	}
	repoRoot := strings.TrimSpace(string(repoRootRaw))

	head, err := commandOutput(repoRoot, "git", "rev-parse", "HEAD")
	if err != nil {
		return sourceBinding{}, err
	}
	statusRaw, err := commandOutputBytes(repoRoot, "git", "status", "--porcelain=v1", "-z", "--untracked-files=all")
	if err != nil {
		return sourceBinding{}, err
	}
	diffRaw, err := commandOutputBytes(repoRoot, "git", "diff", "--binary", "--no-ext-diff", "HEAD", "--")
	if err != nil {
		return sourceBinding{}, err
	}
	untrackedRaw, err := commandOutputBytes(repoRoot, "git", "ls-files", "--others", "--exclude-standard", "-z")
	if err != nil {
		return sourceBinding{}, err
	}
	goVersion, err := commandOutput(repoRoot, "go", "version")
	if err != nil {
		return sourceBinding{}, err
	}
	goEnv, err := commandOutput(repoRoot, "go", "env", "GOOS", "GOARCH")
	if err != nil {
		return sourceBinding{}, err
	}
	goEnvParts := strings.Fields(goEnv)
	if len(goEnvParts) != 2 {
		return sourceBinding{}, fmt.Errorf("go env GOOS GOARCH returned %q", goEnv)
	}

	dirtyEntries := splitNULStrings(statusRaw)
	dirtyHash := sha256.Sum256(statusRaw)
	sourceHash := sha256.New()
	writeHashSection(sourceHash, []byte(head))
	writeHashSection(sourceHash, diffRaw)
	untrackedPaths := splitNULStrings(untrackedRaw)
	sort.Strings(untrackedPaths)
	for _, relativePath := range untrackedPaths {
		cleanPath := filepath.Clean(filepath.FromSlash(relativePath))
		absolutePath := filepath.Join(repoRoot, cleanPath)
		info, statErr := os.Lstat(absolutePath)
		if statErr != nil {
			return sourceBinding{}, fmt.Errorf("stat untracked source %q: %w", relativePath, statErr)
		}
		content, readErr := os.ReadFile(absolutePath)
		if readErr != nil {
			return sourceBinding{}, fmt.Errorf("read untracked source %q: %w", relativePath, readErr)
		}
		writeHashSection(sourceHash, []byte(filepath.ToSlash(relativePath)))
		writeHashSection(sourceHash, []byte(info.Mode().String()))
		writeHashSection(sourceHash, content)
	}

	return sourceBinding{
		SchemaVersion:         sourceBindingSchema,
		HEAD:                  head,
		SourceSHA256:          hex.EncodeToString(sourceHash.Sum(nil)),
		Dirty:                 len(dirtyEntries) > 0,
		DirtyEntries:          dirtyEntries,
		DirtyDescriptorSHA256: hex.EncodeToString(dirtyHash[:]),
		GoVersion:             goVersion,
		GOOS:                  goEnvParts[0],
		GOARCH:                goEnvParts[1],
		CapturedAt:            time.Now().UTC().Format(time.RFC3339Nano),
	}, nil
}

func commandOutput(dir string, binary string, args ...string) (string, error) {
	raw, err := commandOutputBytes(dir, binary, args...)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(raw)), nil
}

func commandOutputBytes(dir string, binary string, args ...string) ([]byte, error) {
	cmd := exec.Command(binary, args...)
	cmd.Dir = dir
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	raw, err := cmd.Output()
	if err != nil {
		detail := strings.TrimSpace(stderr.String())
		if detail == "" {
			detail = err.Error()
		}
		return nil, fmt.Errorf("%s %s: %s", binary, strings.Join(args, " "), detail)
	}
	return raw, nil
}

func splitNULStrings(raw []byte) []string {
	parts := bytes.Split(raw, []byte{0})
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		if len(part) == 0 {
			continue
		}
		result = append(result, string(part))
	}
	return result
}

type hashWriter interface {
	Write([]byte) (int, error)
}

func writeHashSection(writer hashWriter, value []byte) {
	var size [8]byte
	binary.BigEndian.PutUint64(size[:], uint64(len(value)))
	_, _ = writer.Write(size[:])
	_, _ = writer.Write(value)
}

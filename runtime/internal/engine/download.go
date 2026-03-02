package engine

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"time"
)

// DownloadBinary downloads an engine binary to the engines base directory.
// Returns the final binary path and SHA256 hash.
func DownloadBinary(baseDir string, kind EngineKind, version string) (binaryPath string, sha256hex string, err error) {
	var url string
	var binaryName string

	switch kind {
	case EngineLocalAI:
		url, err = localAIDownloadURL(version)
		if err != nil {
			return "", "", err
		}
		binaryName = localAIBinaryName()
	default:
		return "", "", fmt.Errorf("download not supported for engine %q", kind)
	}

	destDir := filepath.Join(baseDir, string(kind), version)
	return downloadFromURL(url, destDir, binaryName)
}

// downloadFromURL downloads a binary from url into destDir/binaryName.
// It performs atomic write (via .download tmp file), SHA256 hashing, and chmod 0755.
func downloadFromURL(url, destDir, binaryName string) (string, string, error) {
	if err := os.MkdirAll(destDir, 0o755); err != nil {
		return "", "", fmt.Errorf("create engine directory: %w", err)
	}

	destPath := filepath.Join(destDir, binaryName)
	tmpPath := destPath + ".download"

	client := &http.Client{Timeout: 30 * time.Minute}
	resp, err := client.Get(url)
	if err != nil {
		return "", "", fmt.Errorf("download engine binary: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", "", fmt.Errorf("download engine binary: HTTP %d from %s", resp.StatusCode, url)
	}

	out, err := os.Create(tmpPath)
	if err != nil {
		return "", "", fmt.Errorf("create temp file: %w", err)
	}
	defer func() {
		out.Close()
		if err != nil {
			_ = os.Remove(tmpPath)
		}
	}()

	hasher := sha256.New()
	writer := io.MultiWriter(out, hasher)

	if _, err = io.Copy(writer, resp.Body); err != nil {
		return "", "", fmt.Errorf("write engine binary: %w", err)
	}

	if err = out.Close(); err != nil {
		return "", "", fmt.Errorf("close temp file: %w", err)
	}

	hash := hex.EncodeToString(hasher.Sum(nil))

	if err = os.Chmod(tmpPath, 0o755); err != nil {
		return "", "", fmt.Errorf("chmod engine binary: %w", err)
	}

	if err = os.Rename(tmpPath, destPath); err != nil {
		return "", "", fmt.Errorf("rename engine binary: %w", err)
	}

	return destPath, hash, nil
}

// PlatformString returns the current platform identifier (e.g., "darwin/arm64").
func PlatformString() string {
	return runtime.GOOS + "/" + runtime.GOARCH
}

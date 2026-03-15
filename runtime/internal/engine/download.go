package engine

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

var (
	// ErrEngineBinaryDownloadFailed indicates binary download/bootstrap failure.
	ErrEngineBinaryDownloadFailed = errors.New("engine binary download failed")
	// ErrEngineBinaryHashMismatch indicates checksum mismatch against authority.
	ErrEngineBinaryHashMismatch = errors.New("engine binary hash mismatch")
)

// DownloadBinary downloads an engine binary to the engines base directory.
// Returns the final binary path and SHA256 hash.
func DownloadBinary(baseDir string, kind EngineKind, version string) (binaryPath string, sha256hex string, err error) {
	var url string
	var binaryName string
	var expectedSHA256 string

	switch kind {
	case EngineLocalAI:
		assetName, assetErr := localAIAssetName(version)
		if assetErr != nil {
			return "", "", fmt.Errorf("%w: %v", ErrEngineBinaryDownloadFailed, assetErr)
		}
		url, err = localAIDownloadURL(version)
		if err != nil {
			return "", "", fmt.Errorf("%w: %v", ErrEngineBinaryDownloadFailed, err)
		}
		expectedSHA256, err = localAIExpectedSHA256(version, assetName)
		if err != nil {
			return "", "", err
		}
		binaryName = localAIBinaryName()
	default:
		return "", "", fmt.Errorf("%w: engine %q not supported", ErrEngineBinaryDownloadFailed, kind)
	}

	destDir := filepath.Join(baseDir, string(kind), version)
	return downloadFromURLWithExpectedSHA256(url, destDir, binaryName, expectedSHA256)
}

// downloadFromURL downloads a binary from url into destDir/binaryName.
// It performs atomic write (via .download tmp file), SHA256 hashing, and chmod 0755.
func downloadFromURL(url, destDir, binaryName string) (string, string, error) {
	return downloadFromURLWithExpectedSHA256(url, destDir, binaryName, "")
}

func downloadFromURLWithExpectedSHA256(url, destDir, binaryName, expectedSHA256 string) (string, string, error) {
	if err := os.MkdirAll(destDir, 0o755); err != nil {
		return "", "", fmt.Errorf("%w: create engine directory: %v", ErrEngineBinaryDownloadFailed, err)
	}

	destPath := filepath.Join(destDir, binaryName)
	tmpPath := destPath + ".download"

	client := &http.Client{Timeout: 30 * time.Minute}
	resp, err := client.Get(url)
	if err != nil {
		return "", "", fmt.Errorf("%w: request engine binary: %v", ErrEngineBinaryDownloadFailed, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", "", fmt.Errorf("%w: HTTP %d from %s", ErrEngineBinaryDownloadFailed, resp.StatusCode, url)
	}

	out, err := os.Create(tmpPath)
	if err != nil {
		return "", "", fmt.Errorf("%w: create temp file: %v", ErrEngineBinaryDownloadFailed, err)
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
		return "", "", fmt.Errorf("%w: write engine binary: %v", ErrEngineBinaryDownloadFailed, err)
	}

	if err = out.Close(); err != nil {
		return "", "", fmt.Errorf("%w: close temp file: %v", ErrEngineBinaryDownloadFailed, err)
	}

	hash := hex.EncodeToString(hasher.Sum(nil))
	if trimmedExpected := strings.TrimSpace(expectedSHA256); trimmedExpected != "" && !strings.EqualFold(hash, trimmedExpected) {
		return "", "", fmt.Errorf("%w: expected=%s actual=%s", ErrEngineBinaryHashMismatch, strings.ToLower(trimmedExpected), hash)
	}

	if err = os.Chmod(tmpPath, 0o755); err != nil {
		return "", "", fmt.Errorf("%w: chmod engine binary: %v", ErrEngineBinaryDownloadFailed, err)
	}

	if err = os.Rename(tmpPath, destPath); err != nil {
		return "", "", fmt.Errorf("%w: rename engine binary: %v", ErrEngineBinaryDownloadFailed, err)
	}

	return destPath, hash, nil
}

// PlatformString returns the current platform identifier (e.g., "darwin/arm64").
func PlatformString() string {
	return currentGOOS() + "/" + currentGOARCH()
}

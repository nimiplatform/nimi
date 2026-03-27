package engine

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
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

var githubReleaseRedirectHosts = map[string]struct{}{
	"github.com":                           {},
	"objects.githubusercontent.com":        {},
	"release-assets.githubusercontent.com": {},
}

// DownloadBinary downloads an engine binary to the engines base directory.
// Returns the final binary path and SHA256 hash.
func DownloadBinary(baseDir string, kind EngineKind, version string) (binaryPath string, sha256hex string, err error) {
	var url string
	var binaryName string
	var expectedSHA256 string

	switch kind {
	case EngineLlama:
		assetName, assetErr := llamaAssetName(version)
		if assetErr != nil {
			return "", "", fmt.Errorf("%w: %v", ErrEngineBinaryDownloadFailed, assetErr)
		}
		url, err = llamaDownloadURL(version)
		if err != nil {
			return "", "", fmt.Errorf("%w: %v", ErrEngineBinaryDownloadFailed, err)
		}
		expectedSHA256, err = llamaExpectedSHA256(version, assetName)
		if err != nil {
			return "", "", err
		}
		binaryName = llamaBinaryName()
	default:
		return "", "", fmt.Errorf("%w: engine %q not supported", ErrEngineBinaryDownloadFailed, kind)
	}

	destDir := filepath.Join(baseDir, string(kind), version)
	return downloadFromURLWithExpectedSHA256(url, destDir, binaryName, expectedSHA256)
}

func downloadFromURLWithExpectedSHA256(url, destDir, binaryName, expectedSHA256 string) (string, string, error) {
	if err := os.MkdirAll(destDir, 0o755); err != nil {
		return "", "", fmt.Errorf("%w: create engine directory: %v", ErrEngineBinaryDownloadFailed, err)
	}

	destPath := filepath.Join(destDir, binaryName)
	tmpPath := destPath + ".download"

	client := newEngineDownloadHTTPClient(url, nil, 30*time.Minute)
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
	shouldRemoveTmp := true
	defer func() {
		out.Close()
		if shouldRemoveTmp {
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
	shouldRemoveTmp = false

	return destPath, hash, nil
}

func newEngineDownloadHTTPClient(sourceURL string, base *http.Client, fallbackTimeout time.Duration) *http.Client {
	client := &http.Client{
		Timeout: fallbackTimeout,
	}
	if base != nil {
		*client = *base
		if client.Timeout <= 0 {
			client.Timeout = fallbackTimeout
		}
	}
	baseCheckRedirect := client.CheckRedirect
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) == 0 {
			return nil
		}
		if err := validateEngineDownloadRedirect(sourceURL, req.URL.String()); err != nil {
			return err
		}
		if baseCheckRedirect != nil {
			return baseCheckRedirect(req, via)
		}
		return nil
	}
	return client
}

func validateEngineDownloadRedirect(sourceURL string, redirectURL string) error {
	source, err := url.Parse(strings.TrimSpace(sourceURL))
	if err != nil {
		return fmt.Errorf("%w: invalid download source URL: %v", ErrEngineBinaryDownloadFailed, err)
	}
	target, err := url.Parse(strings.TrimSpace(redirectURL))
	if err != nil {
		return fmt.Errorf("%w: invalid redirect URL: %v", ErrEngineBinaryDownloadFailed, err)
	}

	sourceHost := strings.ToLower(strings.TrimSpace(source.Hostname()))
	targetHost := strings.ToLower(strings.TrimSpace(target.Hostname()))
	sourceScheme := strings.ToLower(strings.TrimSpace(source.Scheme))
	targetScheme := strings.ToLower(strings.TrimSpace(target.Scheme))

	if sourceHost == "" || targetHost == "" {
		return fmt.Errorf("%w: redirect missing host", ErrEngineBinaryDownloadFailed)
	}
	if sourceScheme != "https" || targetScheme != "https" {
		return fmt.Errorf("%w: redirect must remain https (source=%s target=%s)", ErrEngineBinaryDownloadFailed, sourceScheme, targetScheme)
	}
	if targetHost == sourceHost {
		return nil
	}
	if sourceHost == "github.com" {
		if _, ok := githubReleaseRedirectHosts[targetHost]; ok {
			return nil
		}
	}
	return fmt.Errorf("%w: redirect from %s to %s is not allowed", ErrEngineBinaryDownloadFailed, sourceHost, targetHost)
}

// PlatformString returns the current platform identifier (e.g., "darwin/arm64").
func PlatformString() string {
	return currentGOOS() + "/" + currentGOARCH()
}

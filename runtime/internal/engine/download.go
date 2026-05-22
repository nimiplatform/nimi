package engine

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/filedownload"
)

const (
	// engineDownloadMaxAttempts bounds the shared-core retry-with-backoff loop
	// for one engine binary asset: the first attempt plus a small number of
	// retries on transient body-stream failures (mid-stream EOF, reset, 5xx).
	engineDownloadMaxAttempts = 4
	// engineDownloadRetryBackoff is the base backoff between transient retries;
	// attempt N waits N*engineDownloadRetryBackoff.
	engineDownloadRetryBackoff = 300 * time.Millisecond
	// engineDownloadFallbackTimeout bounds a single engine binary download.
	engineDownloadFallbackTimeout = 30 * time.Minute
)

var (
	// ErrEngineBinaryDownloadFailed indicates binary download/bootstrap failure.
	ErrEngineBinaryDownloadFailed = errors.New("engine binary download failed")
	// ErrEngineBinaryHashMismatch indicates checksum mismatch against authority.
	ErrEngineBinaryHashMismatch = errors.New("engine binary hash mismatch")
)

var githubReleaseRedirectHosts = map[string]struct{}{
	"api.github.com":                       {},
	"github.com":                           {},
	"objects.githubusercontent.com":        {},
	"release-assets.githubusercontent.com": {},
}

type managedBinaryBootstrapSpec struct {
	BinaryName   string
	ResolveAsset func(version string) (managedBinaryReleaseAsset, error)
}

// DownloadBinary downloads an engine binary to the engines base directory.
// Returns the final binary path, binary SHA256 hash, and selected release asset.
func DownloadBinary(baseDir string, kind EngineKind, version string) (binaryPath string, sha256hex string, assetName string, err error) {
	switch kind {
	case EngineLlama:
		destDir := filepath.Join(baseDir, string(kind), version)
		return downloadManagedBinary(destDir, managedBinaryBootstrapSpec{
			BinaryName:   llamaBinaryName(),
			ResolveAsset: llamaReleaseAsset,
		}, version)
	default:
		return "", "", "", fmt.Errorf("%w: engine %q not supported", ErrEngineBinaryDownloadFailed, kind)
	}
}

func downloadManagedBinary(destDir string, spec managedBinaryBootstrapSpec, version string) (string, string, string, error) {
	if strings.TrimSpace(spec.BinaryName) == "" {
		return "", "", "", fmt.Errorf("%w: managed binary name is required", ErrEngineBinaryDownloadFailed)
	}

	asset, err := spec.ResolveAsset(version)
	if err != nil {
		return "", "", "", err
	}

	if err := os.MkdirAll(destDir, 0o755); err != nil {
		return "", "", "", fmt.Errorf("%w: create engine directory: %v", ErrEngineBinaryDownloadFailed, err)
	}

	tmpDir, err := os.MkdirTemp(filepath.Dir(destDir), "."+filepath.Base(destDir)+".bootstrap-*")
	if err != nil {
		return "", "", "", fmt.Errorf("%w: create bootstrap temp directory: %v", ErrEngineBinaryDownloadFailed, err)
	}
	defer func() { _ = os.RemoveAll(tmpDir) }()

	downloadPath := filepath.Join(tmpDir, asset.Name)
	archiveHash, err := downloadURLToFile(asset.DownloadURL, downloadPath)
	if err != nil {
		return "", "", "", err
	}
	if expected := strings.TrimSpace(asset.SHA256); expected != "" && !strings.EqualFold(expected, archiveHash) {
		return "", "", "", fmt.Errorf("%w: expected=%s actual=%s", ErrEngineBinaryHashMismatch, strings.ToLower(expected), archiveHash)
	}

	stagedPayloadDir := filepath.Join(tmpDir, "payload")
	finalTmpPath, err := stageManagedBinaryPayload(downloadPath, stagedPayloadDir, spec.BinaryName)
	if err != nil {
		return "", "", "", err
	}

	if err := os.Chmod(finalTmpPath, 0o755); err != nil {
		return "", "", "", fmt.Errorf("%w: chmod engine binary: %v", ErrEngineBinaryDownloadFailed, err)
	}

	finalHash, err := sha256File(finalTmpPath)
	if err != nil {
		return "", "", "", err
	}

	if err := installManagedBinaryPayload(destDir, stagedPayloadDir); err != nil {
		return "", "", "", err
	}

	destPath := filepath.Join(destDir, spec.BinaryName)
	return destPath, finalHash, asset.Name, nil
}

func downloadFromURLWithExpectedSHA256(url, destDir, binaryName, expectedSHA256 string) (string, string, error) {
	if err := os.MkdirAll(destDir, 0o755); err != nil {
		return "", "", fmt.Errorf("%w: create engine directory: %v", ErrEngineBinaryDownloadFailed, err)
	}

	destPath := filepath.Join(destDir, binaryName)
	hash, err := downloadURLToFile(url, destPath)
	if err != nil {
		return "", "", err
	}

	if trimmedExpected := strings.TrimSpace(expectedSHA256); trimmedExpected != "" && !strings.EqualFold(hash, trimmedExpected) {
		_ = os.Remove(destPath)
		return "", "", fmt.Errorf("%w: expected=%s actual=%s", ErrEngineBinaryHashMismatch, strings.ToLower(trimmedExpected), hash)
	}

	if err := os.Chmod(destPath, 0o755); err != nil {
		_ = os.Remove(destPath)
		return "", "", fmt.Errorf("%w: chmod engine binary: %v", ErrEngineBinaryDownloadFailed, err)
	}

	return destPath, hash, nil
}

// doEngineDownloadRequest issues a single engine-download GET through the
// HTTP/2-negotiating, redirect-validating client. Retry is NOT done here: the
// shared filedownload core (used by downloadURLToFile) is the one place that
// implements download retry + Range resume. This helper exists so the
// transport's HTTP/2 negotiation can be exercised directly.
func doEngineDownloadRequest(sourceURL string, base *http.Client, fallbackTimeout time.Duration) (*http.Response, error) {
	client := newEngineDownloadHTTPClient(sourceURL, base, fallbackTimeout)
	req, err := http.NewRequest(http.MethodGet, sourceURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "nimi-runtime/0.1")
	req.Header.Set("Accept", "application/vnd.github+json")
	return client.Do(req)
}

// downloadURLToFile downloads an engine binary asset via the shared
// filedownload core: one place implements retry + HTTP Range resume. The
// engine path keeps its HTTP/2-negotiating, redirect-validating client
// (newEngineDownloadHTTPClient) — that client is injected into the core, and
// the core covers connection-establishment retries AND the mid-stream body
// drop that the old `doEngineDownloadRequest` 3x loop could not.
func downloadURLToFile(sourceURL string, destPath string) (string, error) {
	client := newEngineDownloadHTTPClient(sourceURL, nil, engineDownloadFallbackTimeout)
	header := http.Header{}
	header.Set("User-Agent", "nimi-runtime/0.1")
	header.Set("Accept", "application/vnd.github+json")

	result, err := filedownload.Download(context.Background(), filedownload.Options{
		URL:          sourceURL,
		DestPath:     destPath,
		Client:       client,
		Header:       header,
		MaxAttempts:  engineDownloadMaxAttempts,
		RetryBackoff: engineDownloadRetryBackoff,
		IsTransient:  isRetryableEngineDownloadError,
	})
	if err != nil {
		if errors.Is(err, filedownload.ErrHTTPStatus) {
			return "", fmt.Errorf("%w: HTTP error from %s: %v", ErrEngineBinaryDownloadFailed, sourceURL, err)
		}
		return "", fmt.Errorf("%w: download engine binary: %v", ErrEngineBinaryDownloadFailed, err)
	}
	return result.SHA256, nil
}

func isEngineArchiveAsset(name string) bool {
	lower := strings.ToLower(strings.TrimSpace(name))
	return strings.HasSuffix(lower, ".tar.gz") || strings.HasSuffix(lower, ".tgz") || strings.HasSuffix(lower, ".zip")
}

func stageManagedBinaryPayload(assetPath string, stagedDir string, binaryName string) (string, error) {
	if err := os.MkdirAll(stagedDir, 0o755); err != nil {
		return "", fmt.Errorf("%w: create staged payload directory: %v", ErrEngineBinaryDownloadFailed, err)
	}
	if isEngineArchiveAsset(assetPath) {
		if err := extractManagedPayload(assetPath, stagedDir); err != nil {
			return "", err
		}
	} else if err := copyFile(assetPath, filepath.Join(stagedDir, binaryName)); err != nil {
		return "", err
	}

	binaryPath := filepath.Join(stagedDir, binaryName)
	if _, err := os.Stat(binaryPath); err != nil {
		return "", fmt.Errorf("%w: binary %s not found in staged payload", ErrEngineBinaryDownloadFailed, binaryName)
	}
	return binaryPath, nil
}

func extractManagedPayload(archivePath string, destDir string) error {
	lower := strings.ToLower(strings.TrimSpace(archivePath))
	switch {
	case strings.HasSuffix(lower, ".zip"):
		return extractManagedPayloadFromZip(archivePath, destDir)
	case strings.HasSuffix(lower, ".tar.gz"), strings.HasSuffix(lower, ".tgz"):
		return extractManagedPayloadFromTarGZ(archivePath, destDir)
	default:
		return fmt.Errorf("%w: unsupported archive format %s", ErrEngineBinaryDownloadFailed, archivePath)
	}
}

func extractManagedPayloadFromZip(archivePath string, destDir string) error {
	reader, err := zip.OpenReader(archivePath)
	if err != nil {
		return fmt.Errorf("%w: open zip archive: %v", ErrEngineBinaryDownloadFailed, err)
	}
	defer func() { _ = reader.Close() }()

	for _, file := range reader.File {
		relPath, err := normalizeManagedArchiveEntryPath(file.Name)
		if err != nil {
			return err
		}
		if relPath == "" {
			continue
		}
		destPath := filepath.Join(destDir, relPath)
		mode := file.Mode()
		if mode.IsDir() {
			if err := os.MkdirAll(destPath, 0o755); err != nil {
				return fmt.Errorf("%w: create extracted directory: %v", ErrEngineBinaryDownloadFailed, err)
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(destPath), 0o755); err != nil {
			return fmt.Errorf("%w: create extracted binary directory: %v", ErrEngineBinaryDownloadFailed, err)
		}
		if mode&os.ModeSymlink != 0 {
			rc, err := file.Open()
			if err != nil {
				return fmt.Errorf("%w: open archived symlink: %v", ErrEngineBinaryDownloadFailed, err)
			}
			target, readErr := io.ReadAll(rc)
			_ = rc.Close()
			if readErr != nil {
				return fmt.Errorf("%w: read archived symlink: %v", ErrEngineBinaryDownloadFailed, readErr)
			}
			if err := writeManagedSymlink(destPath, string(target)); err != nil {
				return err
			}
			continue
		}
		rc, err := file.Open()
		if err != nil {
			return fmt.Errorf("%w: open archived binary: %v", ErrEngineBinaryDownloadFailed, err)
		}
		err = copyReaderToFileWithMode(rc, destPath, mode.Perm())
		_ = rc.Close()
		if err != nil {
			return err
		}
	}

	return nil
}

func extractManagedPayloadFromTarGZ(archivePath string, destDir string) error {
	file, err := os.Open(archivePath)
	if err != nil {
		return fmt.Errorf("%w: open tar archive: %v", ErrEngineBinaryDownloadFailed, err)
	}
	defer func() { _ = file.Close() }()

	gzipReader, err := gzip.NewReader(file)
	if err != nil {
		return fmt.Errorf("%w: open gzip archive: %v", ErrEngineBinaryDownloadFailed, err)
	}
	defer func() { _ = gzipReader.Close() }()

	tarReader := tar.NewReader(gzipReader)
	for {
		header, err := tarReader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return fmt.Errorf("%w: read tar archive: %v", ErrEngineBinaryDownloadFailed, err)
		}
		if header == nil {
			continue
		}
		relPath, err := normalizeManagedArchiveEntryPath(header.Name)
		if err != nil {
			return err
		}
		if relPath == "" {
			continue
		}
		destPath := filepath.Join(destDir, relPath)
		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(destPath, 0o755); err != nil {
				return fmt.Errorf("%w: create extracted directory: %v", ErrEngineBinaryDownloadFailed, err)
			}
		case tar.TypeSymlink:
			if err := os.MkdirAll(filepath.Dir(destPath), 0o755); err != nil {
				return fmt.Errorf("%w: create extracted symlink directory: %v", ErrEngineBinaryDownloadFailed, err)
			}
			if err := writeManagedSymlink(destPath, header.Linkname); err != nil {
				return err
			}
		case tar.TypeReg, tar.TypeRegA:
			if err := os.MkdirAll(filepath.Dir(destPath), 0o755); err != nil {
				return fmt.Errorf("%w: create extracted binary directory: %v", ErrEngineBinaryDownloadFailed, err)
			}
			mode := os.FileMode(header.Mode) & os.ModePerm
			if err := copyReaderToFileWithMode(tarReader, destPath, mode); err != nil {
				return err
			}
		}
	}

	return nil
}

func normalizeManagedArchiveEntryPath(name string) (string, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" || trimmed == "." || trimmed == "./" {
		return "", nil
	}
	cleaned := filepath.Clean(filepath.FromSlash(trimmed))
	if cleaned == "." {
		return "", nil
	}
	if filepath.IsAbs(cleaned) || cleaned == ".." || strings.HasPrefix(cleaned, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("%w: unsafe archive entry %q", ErrEngineBinaryDownloadFailed, name)
	}
	parts := strings.Split(cleaned, string(filepath.Separator))
	if len(parts) > 1 {
		cleaned = filepath.Join(parts[1:]...)
	}
	if cleaned == "." || cleaned == "" {
		return "", nil
	}
	if filepath.IsAbs(cleaned) || cleaned == ".." || strings.HasPrefix(cleaned, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("%w: unsafe archive entry %q", ErrEngineBinaryDownloadFailed, name)
	}
	return cleaned, nil
}

func writeManagedSymlink(destPath string, target string) error {
	trimmedTarget := strings.TrimSpace(target)
	if trimmedTarget == "" || filepath.IsAbs(trimmedTarget) {
		return fmt.Errorf("%w: unsafe archive symlink target %q", ErrEngineBinaryDownloadFailed, target)
	}
	if err := os.Remove(destPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("%w: replace extracted symlink: %v", ErrEngineBinaryDownloadFailed, err)
	}
	if err := os.Symlink(trimmedTarget, destPath); err != nil {
		return fmt.Errorf("%w: create extracted symlink: %v", ErrEngineBinaryDownloadFailed, err)
	}
	return nil
}

func installManagedBinaryPayload(destDir string, stagedDir string) error {
	if err := os.RemoveAll(destDir); err != nil {
		return fmt.Errorf("%w: remove existing engine payload: %v", ErrEngineBinaryDownloadFailed, err)
	}
	if err := os.MkdirAll(destDir, 0o755); err != nil {
		return fmt.Errorf("%w: create engine payload directory: %v", ErrEngineBinaryDownloadFailed, err)
	}
	return filepath.Walk(stagedDir, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return fmt.Errorf("%w: walk staged payload: %v", ErrEngineBinaryDownloadFailed, walkErr)
		}
		relPath, err := filepath.Rel(stagedDir, path)
		if err != nil {
			return fmt.Errorf("%w: resolve staged payload path: %v", ErrEngineBinaryDownloadFailed, err)
		}
		if relPath == "." {
			return nil
		}
		destPath := filepath.Join(destDir, relPath)
		if info.IsDir() {
			if err := os.MkdirAll(destPath, 0o755); err != nil {
				return fmt.Errorf("%w: create engine payload directory: %v", ErrEngineBinaryDownloadFailed, err)
			}
			return nil
		}
		if info.Mode()&os.ModeSymlink != 0 {
			target, err := os.Readlink(path)
			if err != nil {
				return fmt.Errorf("%w: read staged symlink: %v", ErrEngineBinaryDownloadFailed, err)
			}
			return writeManagedSymlink(destPath, target)
		}
		source, err := os.Open(path)
		if err != nil {
			return fmt.Errorf("%w: open staged payload file: %v", ErrEngineBinaryDownloadFailed, err)
		}
		defer func() { _ = source.Close() }()
		if err := copyReaderToFileWithMode(source, destPath, info.Mode().Perm()); err != nil {
			return err
		}
		return nil
	})
}

func copyReaderToFile(reader io.Reader, destPath string) error {
	return copyReaderToFileWithMode(reader, destPath, 0o644)
}

func copyReaderToFileWithMode(reader io.Reader, destPath string, mode os.FileMode) error {
	out, err := os.Create(destPath)
	if err != nil {
		return fmt.Errorf("%w: create extracted binary: %v", ErrEngineBinaryDownloadFailed, err)
	}
	shouldRemove := true
	defer func() {
		_ = out.Close()
		if shouldRemove {
			_ = os.Remove(destPath)
		}
	}()

	if _, err := io.Copy(out, reader); err != nil {
		return fmt.Errorf("%w: extract engine binary: %v", ErrEngineBinaryDownloadFailed, err)
	}
	if err := out.Close(); err != nil {
		return fmt.Errorf("%w: close extracted binary: %v", ErrEngineBinaryDownloadFailed, err)
	}
	if err := os.Chmod(destPath, mode); err != nil {
		return fmt.Errorf("%w: chmod extracted binary: %v", ErrEngineBinaryDownloadFailed, err)
	}
	shouldRemove = false
	return nil
}

func copyFile(sourcePath string, destPath string) error {
	in, err := os.Open(sourcePath)
	if err != nil {
		return fmt.Errorf("%w: open downloaded asset: %v", ErrEngineBinaryDownloadFailed, err)
	}
	defer func() { _ = in.Close() }()
	return copyReaderToFile(in, destPath)
}

func sha256File(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("%w: open engine binary: %v", ErrEngineBinaryDownloadFailed, err)
	}
	defer func() { _ = file.Close() }()

	hasher := sha256.New()
	if _, err := io.Copy(hasher, file); err != nil {
		return "", fmt.Errorf("%w: hash engine binary: %v", ErrEngineBinaryDownloadFailed, err)
	}

	return hex.EncodeToString(hasher.Sum(nil)), nil
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
	if transport := cloneEngineDownloadTransport(sourceURL, client.Transport); transport != nil {
		client.Transport = transport
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

// cloneEngineDownloadTransport returns an engine-download transport that
// correctly negotiates HTTP/2.
//
// The release hosts the engine downloader talks to (api.github.com,
// github.com, objects.githubusercontent.com, releases.astral.sh, quay.io,
// huggingface.co) all serve HTTP/2 over ALPN. The transport must therefore be
// HTTP/2-capable: ForceAttemptHTTP2 alone does NOT govern this — a clone of an
// already-used http.DefaultTransport carries a populated TLSNextProto map
// (the h2 ALPN entry registered by onceSetNextProtoDefaults), so ALPN still
// negotiates h2 even when ForceAttemptHTTP2 is false. The earlier
// HTTP/2-"disabling" path produced exactly that mismatch: ALPN negotiated h2
// while the HTTP/1.x round-tripper kept reading, yielding
// `malformed HTTP response "\x00\x00\x12\x04..."` (an HTTP/2 SETTINGS frame).
//
// The fix is to keep HTTP/2 enabled and consistent: ForceAttemptHTTP2 = true
// so the h2 ALPN entry and the HTTP/2 round-tripper stay in agreement.
func cloneEngineDownloadTransport(_ string, base http.RoundTripper) *http.Transport {
	if typed, ok := base.(*http.Transport); ok && typed != nil {
		cloned := typed.Clone()
		cloned.ForceAttemptHTTP2 = true
		return cloned
	}
	if typed, ok := http.DefaultTransport.(*http.Transport); ok && typed != nil {
		cloned := typed.Clone()
		cloned.ForceAttemptHTTP2 = true
		return cloned
	}
	return nil
}

func isRetryableEngineDownloadError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, io.EOF) {
		return true
	}
	var netErr net.Error
	if errors.As(err, &netErr) {
		return true
	}
	lower := strings.ToLower(strings.TrimSpace(err.Error()))
	return strings.Contains(lower, "eof") ||
		strings.Contains(lower, "connection reset") ||
		strings.Contains(lower, "broken pipe") ||
		strings.Contains(lower, "tls handshake timeout")
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
	if sourceHost == "quay.io" && strings.HasSuffix(targetHost, ".quay.io") {
		return nil
	}
	return fmt.Errorf("%w: redirect from %s to %s is not allowed", ErrEngineBinaryDownloadFailed, sourceHost, targetHost)
}

// PlatformString returns the current platform identifier (e.g., "darwin/arm64").
func PlatformString() string {
	return currentGOOS() + "/" + currentGOARCH()
}

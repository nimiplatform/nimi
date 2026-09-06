package nimiappinstall

import (
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
	"github.com/nimiplatform/nimi/runtime/internal/publicappregistry"
)

const (
	downloadedPackageName  = "package.nimiapp"
	downloadAttemptTimeout = 30 * time.Minute
)

var (
	ErrInvalidDownloadTarget = errors.New("invalid public App download target")
	ErrDownloadDestination   = errors.New("invalid public App download destination")
	ErrDownloadRedirect      = errors.New("public App download redirect rejected")
	ErrDownloadedPackage     = errors.New("public App package download failed")
)

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-014a

type DownloadedPackage struct {
	Path   string
	Size   int64
	SHA256 [sha256.Size]byte
}

type Downloader struct {
	client      *http.Client
	retryDelays []time.Duration
}

// NewCanonicalDownloader creates the production GitHub Release downloader.
// It accepts no URL, mirror, client, filesystem, or trust configuration.
func NewCanonicalDownloader() *Downloader {
	transport := http.DefaultTransport
	if defaultTransport, ok := http.DefaultTransport.(*http.Transport); ok {
		transport = defaultTransport.Clone()
	}
	return newDownloader(transport, []time.Duration{250 * time.Millisecond, time.Second})
}

func newDownloader(transport http.RoundTripper, retryDelays []time.Duration) *Downloader {
	if transport == nil {
		transport = http.DefaultTransport
	}
	return &Downloader{
		client: &http.Client{
			Transport: transport,
			Timeout:   downloadAttemptTimeout,
			CheckRedirect: func(request *http.Request, previous []*http.Request) error {
				if len(previous) > 3 {
					return fmt.Errorf("redirect limit exceeded: %w", ErrDownloadRedirect)
				}
				if request.URL == nil || request.URL.Scheme != "https" || request.URL.User != nil || request.URL.Fragment != "" ||
					(request.URL.Port() != "" && request.URL.Port() != "443") || !githubDownloadHost(request.URL.Hostname()) {
					return fmt.Errorf("redirect must remain on a GitHub HTTPS asset host: %w", ErrDownloadRedirect)
				}
				return nil
			},
		},
		retryDelays: append([]time.Duration(nil), retryDelays...),
	}
}

func (downloader *Downloader) Download(
	ctx context.Context,
	resolved publicappregistry.ResolvedApprovedTarget,
	ownerRoot *os.Root,
) (DownloadedPackage, error) {
	if ctx == nil || downloader == nil || downloader.client == nil {
		return DownloadedPackage{}, fmt.Errorf("download public App package: %w", ErrInvalidDownloadTarget)
	}
	if resolved.Selector.DescriptorID() == "" || resolved.Selector.DescriptorID() != resolved.DescriptorID ||
		resolved.Selector.TargetID() != resolved.Target.TargetID ||
		resolved.Selector.ObservedRegistryCommit() != resolved.RegistryRevision || resolved.Visibility != "public" ||
		resolved.KillSwitch.Active || !resolved.Release.Immutable || resolved.Release.Prerelease {
		return DownloadedPackage{}, fmt.Errorf("validate approved public App download selection: %w", ErrInvalidDownloadTarget)
	}
	expectedAssetURL := resolved.Source.Repository + "/releases/download/" + url.PathEscape(resolved.Release.Tag) + "/" + url.PathEscape(resolved.Target.AssetName)
	if resolved.Target.AssetURL != expectedAssetURL {
		return DownloadedPackage{}, fmt.Errorf("validate approved public App asset lineage: %w", ErrInvalidDownloadTarget)
	}
	return downloader.downloadTarget(ctx, resolved.Target, ownerRoot)
}

func (downloader *Downloader) downloadTarget(
	ctx context.Context,
	target publicappregistry.Target,
	ownerRoot *os.Root,
) (DownloadedPackage, error) {
	if ctx == nil || downloader == nil || downloader.client == nil {
		return DownloadedPackage{}, fmt.Errorf("download public App package: %w", ErrInvalidDownloadTarget)
	}
	if err := validateDownloadTarget(target); err != nil {
		return DownloadedPackage{}, err
	}
	ownerPath, err := validateDownloadRoot(ownerRoot)
	if err != nil {
		return DownloadedPackage{}, err
	}
	if _, err := ownerRoot.Lstat(downloadedPackageName); err == nil {
		return DownloadedPackage{}, ErrDownloadDestination
	} else if !errors.Is(err, os.ErrNotExist) {
		return DownloadedPackage{}, fmt.Errorf("inspect public App package destination: %w", errors.Join(ErrDownloadDestination, err))
	}
	partialName := downloadedPackageName + ".download"
	if partial, err := ownerRoot.Lstat(partialName); err == nil {
		if !partial.Mode().IsRegular() || partial.Mode()&os.ModeSymlink != 0 || partial.Size() < 0 || partial.Size() > target.Size {
			return DownloadedPackage{}, ErrDownloadDestination
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return DownloadedPackage{}, fmt.Errorf("inspect public App partial download: %w", errors.Join(ErrDownloadDestination, err))
	}
	destination := filepath.Join(ownerPath, downloadedPackageName)
	result, err := filedownload.Download(ctx, filedownload.Options{
		URL: target.AssetURL, DestPath: destination, Client: downloader.client,
		Header: http.Header{
			"Accept":          []string{"application/octet-stream"},
			"Accept-Encoding": []string{"identity"},
			"User-Agent":      []string{"nimi-runtime-public-app-installer/1"},
		},
		ExpectedSHA256: target.SHA256, MaxBodyBytes: target.Size,
		MaxAttempts: len(downloader.retryDelays) + 1, RetryDelays: downloader.retryDelays,
		IsTransient: transientDownloadError,
	})
	if err != nil {
		return DownloadedPackage{}, fmt.Errorf("download public App package: %w", errors.Join(ErrDownloadedPackage, err))
	}
	info, err := ownerRoot.Lstat(downloadedPackageName)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Size() != target.Size || result.BytesTotal != target.Size {
		removeErr := ownerRoot.Remove(downloadedPackageName)
		return DownloadedPackage{}, fmt.Errorf("verify downloaded public App package size: %w",
			errors.Join(ErrDownloadedPackage, err, removeErr))
	}
	digestRaw, err := hex.DecodeString(target.SHA256)
	if err != nil || len(digestRaw) != sha256.Size || result.SHA256 != target.SHA256 {
		removeErr := ownerRoot.Remove(downloadedPackageName)
		return DownloadedPackage{}, fmt.Errorf("verify downloaded public App package digest: %w",
			errors.Join(ErrDownloadedPackage, err, removeErr))
	}
	var digest [sha256.Size]byte
	copy(digest[:], digestRaw)
	return DownloadedPackage{Path: destination, Size: target.Size, SHA256: digest}, nil
}

func validateDownloadTarget(target publicappregistry.Target) error {
	parsed, err := url.Parse(target.AssetURL)
	if err != nil || parsed.Scheme != "https" || parsed.Host != "github.com" || parsed.User != nil ||
		parsed.RawQuery != "" || parsed.Fragment != "" || target.Size <= 0 || !lowerSHA256(target.SHA256) ||
		target.AssetName == "" || target.AssetName != strings.TrimSpace(target.AssetName) || strings.ContainsAny(target.AssetName, `/\`) {
		return fmt.Errorf("validate public App download target: %w", errors.Join(ErrInvalidDownloadTarget, err))
	}
	segments := strings.Split(strings.TrimPrefix(parsed.EscapedPath(), "/"), "/")
	if len(segments) != 6 || segments[0] == "" || segments[1] == "" || segments[2] != "releases" ||
		segments[3] != "download" || segments[4] == "" || segments[5] != url.PathEscape(target.AssetName) {
		return fmt.Errorf("validate public App Release asset locator: %w", ErrInvalidDownloadTarget)
	}
	return nil
}

func githubDownloadHost(host string) bool {
	switch strings.ToLower(host) {
	case "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com", "github-releases.githubusercontent.com":
		return true
	default:
		return false
	}
}

func validateDownloadRoot(root *os.Root) (string, error) {
	if root == nil {
		return "", ErrDownloadDestination
	}
	rootPath := filepath.Clean(root.Name())
	info, err := root.Stat(".")
	if !filepath.IsAbs(rootPath) || rootPath != root.Name() || err != nil || !info.IsDir() {
		return "", fmt.Errorf("validate public App download root: %w", errors.Join(ErrDownloadDestination, err))
	}
	return rootPath, nil
}

func transientDownloadError(err error) bool {
	if err == nil || errors.Is(err, ErrDownloadRedirect) {
		return false
	}
	if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
		return true
	}
	var networkError net.Error
	if errors.As(err, &networkError) {
		return true
	}
	lower := strings.ToLower(strings.TrimSpace(err.Error()))
	return strings.Contains(lower, "connection reset") || strings.Contains(lower, "broken pipe") ||
		strings.Contains(lower, "tls handshake timeout")
}

func lowerSHA256(value string) bool {
	if len(value) != sha256.Size*2 {
		return false
	}
	for _, character := range value {
		if (character < '0' || character > '9') && (character < 'a' || character > 'f') {
			return false
		}
	}
	return true
}

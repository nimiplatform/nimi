package appinstallgateway

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/appreleasecatalog"
)

// HTTPSDownloader is the concrete Downloader for external immutable artifacts.
// It downloads the descriptor artifact locator over HTTPS only. The gateway
// computes and compares the sha256 over the returned bytes before unpack, so
// the downloader is a transport, not a verifier: it must not rescue digest,
// content-type, or schema failures.
type HTTPSDownloader struct {
	client       *http.Client
	maxBytes     int64
	userAgent    string
	allowedHosts map[string]struct{}
}

// DownloaderOption configures an HTTPSDownloader.
type DownloaderOption func(*HTTPSDownloader)

const (
	// defaultMaxArtifactBytes caps a single artifact download. An artifact
	// larger than this fails closed rather than streaming unbounded bytes.
	defaultMaxArtifactBytes = int64(512) << 20
	defaultDownloadTimeout  = 5 * time.Minute
)

var (
	// ErrArtifactLocatorNotHTTPS rejects any non-HTTPS artifact locator.
	ErrArtifactLocatorNotHTTPS = errors.New("app install artifact locator must be an https url")
	// ErrArtifactLocatorHostNotAllowed rejects a host outside the allow list
	// when an allow list is configured.
	ErrArtifactLocatorHostNotAllowed = errors.New("app install artifact locator host is not allowed")
	// ErrArtifactDownloadStatus reports a non-200 HTTP response.
	ErrArtifactDownloadStatus = errors.New("app install artifact download returned non-200 status")
	// ErrArtifactTooLarge reports an artifact exceeding the size cap.
	ErrArtifactTooLarge = errors.New("app install artifact exceeds maximum size")
	// ErrBundledDescriptorNotDownloadable rejects routing a bundled descriptor
	// through the network downloader.
	ErrBundledDescriptorNotDownloadable = errors.New("bundled descriptor must not be network downloaded")
)

// NewHTTPSDownloader constructs an HTTPSDownloader.
func NewHTTPSDownloader(options ...DownloaderOption) *HTTPSDownloader {
	downloader := &HTTPSDownloader{
		client:       &http.Client{Timeout: defaultDownloadTimeout},
		maxBytes:     defaultMaxArtifactBytes,
		userAgent:    "nimi-runtime-app-install/1",
		allowedHosts: nil,
	}
	for _, option := range options {
		if option != nil {
			option(downloader)
		}
	}
	return downloader
}

// WithHTTPClient overrides the HTTP client.
func WithHTTPClient(client *http.Client) DownloaderOption {
	return func(d *HTTPSDownloader) {
		if client != nil {
			d.client = client
		}
	}
}

// WithMaxArtifactBytes overrides the artifact size cap.
func WithMaxArtifactBytes(maxBytes int64) DownloaderOption {
	return func(d *HTTPSDownloader) {
		if maxBytes > 0 {
			d.maxBytes = maxBytes
		}
	}
}

// WithAllowedArtifactHosts restricts artifact locator hosts to the allow list.
func WithAllowedArtifactHosts(hosts ...string) DownloaderOption {
	return func(d *HTTPSDownloader) {
		set := make(map[string]struct{}, len(hosts))
		for _, host := range hosts {
			trimmed := strings.ToLower(strings.TrimSpace(host))
			if trimmed != "" {
				set[trimmed] = struct{}{}
			}
		}
		d.allowedHosts = set
	}
}

// Download fetches the descriptor artifact locator over HTTPS. It fails closed
// for bundled descriptors, non-HTTPS locators, disallowed hosts, non-200
// responses, and oversize payloads.
func (d *HTTPSDownloader) Download(ctx context.Context, descriptor appreleasecatalog.Descriptor) ([]byte, error) {
	if descriptor.DescriptorClass == appreleasecatalog.DescriptorClassBundledWithNimi {
		return nil, fmt.Errorf("appinstallgateway download: %w", ErrBundledDescriptorNotDownloadable)
	}
	locator := strings.TrimSpace(descriptor.Artifact.Locator)
	parsed, err := url.Parse(locator)
	if err != nil {
		return nil, fmt.Errorf("appinstallgateway download: parse artifact locator: %w", err)
	}
	if !strings.EqualFold(parsed.Scheme, "https") {
		return nil, fmt.Errorf("appinstallgateway download: %w: %q", ErrArtifactLocatorNotHTTPS, locator)
	}
	host := strings.ToLower(parsed.Hostname())
	if d.allowedHosts != nil {
		if _, ok := d.allowedHosts[host]; !ok {
			return nil, fmt.Errorf("appinstallgateway download: %w: %q", ErrArtifactLocatorHostNotAllowed, host)
		}
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("appinstallgateway download: build request: %w", err)
	}
	request.Header.Set("User-Agent", d.userAgent)

	response, err := d.client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("appinstallgateway download: %w", err)
	}
	defer func() { _ = response.Body.Close() }()

	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("appinstallgateway download: %w: %d", ErrArtifactDownloadStatus, response.StatusCode)
	}

	limited := io.LimitReader(response.Body, d.maxBytes+1)
	payload, err := io.ReadAll(limited)
	if err != nil {
		return nil, fmt.Errorf("appinstallgateway download: read body: %w", err)
	}
	if int64(len(payload)) > d.maxBytes {
		return nil, fmt.Errorf("appinstallgateway download: %w: %d", ErrArtifactTooLarge, d.maxBytes)
	}
	return payload, nil
}

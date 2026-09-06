package nimiappinstall

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/filedownload"
	"github.com/nimiplatform/nimi/runtime/internal/publicappregistry"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (roundTrip roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return roundTrip(request)
}

type droppingBody struct {
	prefix []byte
	sent   bool
}

func (body *droppingBody) Read(target []byte) (int, error) {
	if !body.sent {
		body.sent = true
		return copy(target, body.prefix), nil
	}
	return 0, &net.OpError{Op: "read", Net: "tcp", Err: errors.New("connection reset by peer")}
}

func (*droppingBody) Close() error { return nil }

type contextBlockingBody struct{ ctx context.Context }

func (body *contextBlockingBody) Read([]byte) (int, error) {
	<-body.ctx.Done()
	return 0, body.ctx.Err()
}

func (*contextBlockingBody) Close() error { return nil }

func TestDownloaderConsumesExactGitHubReleaseAsset(t *testing.T) {
	payload := []byte("exact nimiapp bytes")
	target := downloadTarget(payload)
	requests := 0
	downloader := newDownloader(roundTripFunc(func(request *http.Request) (*http.Response, error) {
		requests++
		if request.URL.String() != target.AssetURL || request.Header.Get("Accept") != "application/octet-stream" ||
			request.Header.Get("Accept-Encoding") != "identity" {
			t.Fatalf("request = %s headers=%v", request.URL, request.Header)
		}
		return downloadResponse(http.StatusOK, request, payload), nil
	}), nil)
	ownerRoot, ownerPath := openDownloadRoot(t)
	result, err := downloader.downloadTarget(context.Background(), target, ownerRoot)
	if err != nil {
		t.Fatal(err)
	}
	if requests != 1 || result.Path != filepath.Join(ownerPath, downloadedPackageName) ||
		result.Size != int64(len(payload)) || result.SHA256 != sha256.Sum256(payload) {
		t.Fatalf("result=%+v requests=%d", result, requests)
	}
	if raw, err := os.ReadFile(result.Path); err != nil || !bytes.Equal(raw, payload) {
		t.Fatalf("downloaded bytes=%q err=%v", raw, err)
	}
}

func TestDownloaderRejectsUnissuedResolvedSelection(t *testing.T) {
	payload := []byte("exact bytes")
	resolved := publicappregistry.ResolvedApprovedTarget{
		DescriptorID: "publisher.app@1.2.3", RegistryRevision: strings.Repeat("a", 40), Visibility: "public",
		Source:  publicappregistry.Source{Repository: "https://github.com/publisher/app"},
		Release: publicappregistry.Release{Tag: "v1.2.3", Immutable: true}, Target: downloadTarget(payload),
	}
	downloader := newDownloader(roundTripFunc(func(*http.Request) (*http.Response, error) {
		t.Fatal("unissued selection must fail before network")
		return nil, nil
	}), nil)
	ownerRoot, _ := openDownloadRoot(t)
	if _, err := downloader.Download(context.Background(), resolved, ownerRoot); !errors.Is(err, ErrInvalidDownloadTarget) {
		t.Fatalf("unissued selection error = %v", err)
	}
}

func TestDownloaderAllowsOnlyBoundedHTTPSRedirects(t *testing.T) {
	payload := []byte("redirected exact bytes")
	target := downloadTarget(payload)
	downloader := newDownloader(roundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.URL.Host == "github.com" {
			response := downloadResponse(http.StatusFound, request, nil)
			response.Header.Set("Location", "https://release-assets.githubusercontent.com/exact-asset")
			return response, nil
		}
		if request.URL.String() != "https://release-assets.githubusercontent.com/exact-asset" {
			t.Fatalf("redirect target = %s", request.URL)
		}
		return downloadResponse(http.StatusOK, request, payload), nil
	}), nil)
	ownerRoot, _ := openDownloadRoot(t)
	if _, err := downloader.downloadTarget(context.Background(), target, ownerRoot); err != nil {
		t.Fatal(err)
	}

	insecure := newDownloader(roundTripFunc(func(request *http.Request) (*http.Response, error) {
		response := downloadResponse(http.StatusFound, request, nil)
		response.Header.Set("Location", "http://release-assets.githubusercontent.com/exact-asset")
		return response, nil
	}), nil)
	ownerRoot, ownerPath := openDownloadRoot(t)
	if _, err := insecure.downloadTarget(context.Background(), target, ownerRoot); !errors.Is(err, ErrDownloadedPackage) {
		t.Fatalf("insecure redirect error = %v", err)
	}
	assertDownloadAbsent(t, ownerPath)
}

func TestDownloaderResumesAfterConnectionReset(t *testing.T) {
	payload := []byte("exact resumable nimiapp bytes")
	prefix := payload[:7]
	target := downloadTarget(payload)
	requests := 0
	downloader := newDownloader(roundTripFunc(func(request *http.Request) (*http.Response, error) {
		requests++
		if requests == 1 {
			response := downloadResponse(http.StatusOK, request, nil)
			response.ContentLength = int64(len(payload))
			response.Body = &droppingBody{prefix: prefix}
			return response, nil
		}
		if request.Header.Get("Range") != "bytes=7-" {
			t.Fatalf("resume range = %q", request.Header.Get("Range"))
		}
		response := downloadResponse(http.StatusPartialContent, request, payload[len(prefix):])
		response.Header.Set("Content-Range", "bytes 7-"+strconv.Itoa(len(payload)-1)+"/"+strconv.Itoa(len(payload)))
		return response, nil
	}), []time.Duration{0})
	ownerRoot, ownerPath := openDownloadRoot(t)
	if _, err := downloader.downloadTarget(context.Background(), target, ownerRoot); err != nil {
		t.Fatal(err)
	}
	if requests != 2 {
		t.Fatalf("requests = %d", requests)
	}
	if raw, err := os.ReadFile(filepath.Join(ownerPath, downloadedPackageName)); err != nil || !bytes.Equal(raw, payload) {
		t.Fatalf("resumed bytes=%q err=%v", raw, err)
	}
}

func TestDownloaderAttemptTimeoutCannotHangForever(t *testing.T) {
	payload := []byte("timeout fixture")
	target := downloadTarget(payload)
	requests := 0
	downloader := newDownloader(roundTripFunc(func(request *http.Request) (*http.Response, error) {
		requests++
		response := downloadResponse(http.StatusOK, request, nil)
		response.ContentLength = int64(len(payload))
		response.Body = &contextBlockingBody{ctx: request.Context()}
		return response, nil
	}), []time.Duration{0, 0})
	downloader.client.Timeout = 10 * time.Millisecond
	ownerRoot, ownerPath := openDownloadRoot(t)
	if _, err := downloader.downloadTarget(context.Background(), target, ownerRoot); !errors.Is(err, filedownload.ErrTransientAttemptsExhausted) {
		t.Fatalf("stalled download error = %v", err)
	}
	if requests != 3 {
		t.Fatalf("stalled requests = %d", requests)
	}
	if _, err := os.Stat(filepath.Join(ownerPath, downloadedPackageName)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("stalled download created final file: %v", err)
	}
}

func TestDownloaderRejectsWrongBytesSizeAndExistingDestination(t *testing.T) {
	payload := []byte("expected bytes")
	target := downloadTarget(payload)
	tests := []struct {
		name   string
		mutate func(*publicappregistry.Target)
		body   []byte
	}{
		{name: "wrong digest", body: []byte("different bytes")},
		{name: "wrong declared size", body: payload, mutate: func(target *publicappregistry.Target) { target.Size++ }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			candidate := target
			if test.mutate != nil {
				test.mutate(&candidate)
			}
			downloader := newDownloader(roundTripFunc(func(request *http.Request) (*http.Response, error) {
				return downloadResponse(http.StatusOK, request, test.body), nil
			}), nil)
			ownerRoot, ownerPath := openDownloadRoot(t)
			if _, err := downloader.downloadTarget(context.Background(), candidate, ownerRoot); !errors.Is(err, ErrDownloadedPackage) {
				t.Fatalf("bad download error = %v", err)
			}
			assertDownloadAbsent(t, ownerPath)
		})
	}

	downloader := newDownloader(roundTripFunc(func(*http.Request) (*http.Response, error) {
		t.Fatal("existing destination must fail before network")
		return nil, nil
	}), nil)
	ownerRoot, ownerPath := openDownloadRoot(t)
	if err := os.WriteFile(filepath.Join(ownerPath, downloadedPackageName), []byte("existing"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := downloader.downloadTarget(context.Background(), target, ownerRoot); !errors.Is(err, ErrDownloadDestination) {
		t.Fatalf("existing destination error = %v", err)
	}

	ownerRoot, ownerPath = openDownloadRoot(t)
	if err := os.Mkdir(filepath.Join(ownerPath, downloadedPackageName+".download"), 0o700); err != nil {
		t.Fatal(err)
	}
	if _, err := downloader.downloadTarget(context.Background(), target, ownerRoot); !errors.Is(err, ErrDownloadDestination) {
		t.Fatalf("invalid partial error = %v", err)
	}
}

func TestDownloaderRejectsNonCanonicalSourceAndCancellation(t *testing.T) {
	payload := []byte("exact bytes")
	for _, assetURL := range []string{
		"http://github.com/publisher/app/releases/download/v1.2.3/app.nimiapp",
		"https://example.com/publisher/app/releases/download/v1.2.3/app.nimiapp",
		"https://github.com/publisher/app/releases/latest/download/app.nimiapp",
		"https://github.com/publisher/app/releases/download/v1.2.3/nested/app.nimiapp",
	} {
		target := downloadTarget(payload)
		target.AssetURL = assetURL
		downloader := newDownloader(roundTripFunc(func(*http.Request) (*http.Response, error) {
			t.Fatal("invalid source must fail before network")
			return nil, nil
		}), nil)
		ownerRoot, _ := openDownloadRoot(t)
		if _, err := downloader.downloadTarget(context.Background(), target, ownerRoot); !errors.Is(err, ErrInvalidDownloadTarget) {
			t.Fatalf("source %q error = %v", assetURL, err)
		}
	}

	target := downloadTarget(payload)
	downloader := newDownloader(roundTripFunc(func(*http.Request) (*http.Response, error) {
		t.Fatal("canceled download must not issue a request")
		return nil, nil
	}), nil)
	ownerRoot, ownerPath := openDownloadRoot(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := downloader.downloadTarget(ctx, target, ownerRoot); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled download error = %v", err)
	}
	assertDownloadAbsent(t, ownerPath)
}

func downloadTarget(payload []byte) publicappregistry.Target {
	digest := sha256.Sum256(payload)
	return publicappregistry.Target{
		TargetID: "windows-x86_64", OS: "windows", Arch: "x86_64",
		AssetID: 42, AssetName: "publisher.app-1.2.3-windows-x86_64.nimiapp",
		AssetURL: "https://github.com/publisher/app/releases/download/v1.2.3/publisher.app-1.2.3-windows-x86_64.nimiapp",
		Size:     int64(len(payload)), SHA256: hex.EncodeToString(digest[:]),
	}
}

func downloadResponse(status int, request *http.Request, payload []byte) *http.Response {
	return &http.Response{
		StatusCode: status, Status: http.StatusText(status), Header: make(http.Header),
		Body: io.NopCloser(bytes.NewReader(payload)), ContentLength: int64(len(payload)), Request: request,
	}
}

func openDownloadRoot(t *testing.T) (*os.Root, string) {
	t.Helper()
	path := t.TempDir()
	root, err := os.OpenRoot(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	return root, path
}

func assertDownloadAbsent(t *testing.T, ownerPath string) {
	t.Helper()
	for _, name := range []string{downloadedPackageName, downloadedPackageName + ".download"} {
		if _, err := os.Stat(filepath.Join(ownerPath, name)); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("download residue %s: %v", name, err)
		}
	}
}

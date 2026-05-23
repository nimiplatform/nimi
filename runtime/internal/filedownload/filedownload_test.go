package filedownload

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func hashHex(payload []byte) string {
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}

// TestDownloadRetriesMidStreamDrop covers scenario (a): the server drops the
// connection mid-body on the first attempt; the shared core auto-retries and
// completes with the correct sha256.
func TestDownloadRetriesMidStreamDrop(t *testing.T) {
	payload := []byte(strings.Repeat("nimi-shared-core-download-payload\n", 4096))
	var requests int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempt := atomic.AddInt32(&requests, 1)
		if attempt == 1 {
			// Mid-stream connection drop: write part of the body, then hijack
			// and close the raw connection.
			w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(payload[:1024])
			if flusher, ok := w.(http.Flusher); ok {
				flusher.Flush()
			}
			hijacker, ok := w.(http.Hijacker)
			if !ok {
				t.Errorf("expected hijacker support")
				return
			}
			conn, _, err := hijacker.Hijack()
			if err != nil {
				t.Errorf("hijack: %v", err)
				return
			}
			_ = conn.Close()
			return
		}
		// A resume attempt: honour Range so the partial is reused.
		serveWithRange(w, r, payload)
	}))
	defer server.Close()

	destPath := filepath.Join(t.TempDir(), "model.bin")
	result, err := Download(context.Background(), Options{
		URL:          server.URL + "/model.bin",
		DestPath:     destPath,
		Client:       server.Client(),
		MaxAttempts:  4,
		RetryBackoff: time.Millisecond,
		IsTransient:  func(error) bool { return true },
	})
	if err != nil {
		t.Fatalf("Download: %v", err)
	}
	if result.Attempts < 2 {
		t.Fatalf("expected a retry after the mid-stream drop, got %d attempts", result.Attempts)
	}
	if result.SHA256 != hashHex(payload) {
		t.Fatalf("sha256 mismatch: got=%s want=%s", result.SHA256, hashHex(payload))
	}
	assertFileContents(t, destPath, payload)
	assertNoPartial(t, destPath)
}

// TestDownloadResumesFromExistingPartial covers scenario (b): a `<dest>.download`
// partial already holds N bytes; the core sends `Range: bytes=N-`, the server
// returns 206, and the assembled file hashes correctly over the WHOLE file.
func TestDownloadResumesFromExistingPartial(t *testing.T) {
	payload := []byte(strings.Repeat("resume-from-partial-block\n", 8192))
	prefixLen := 5000
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got, want := r.Header.Get("Range"), "bytes=5000-"; got != want {
			t.Errorf("Range header = %q, want %q", got, want)
		}
		serveWithRange(w, r, payload)
	}))
	defer server.Close()

	destPath := filepath.Join(t.TempDir(), "model.bin")
	if err := os.WriteFile(destPath+".download", payload[:prefixLen], 0o644); err != nil {
		t.Fatalf("seed partial: %v", err)
	}

	result, err := Download(context.Background(), Options{
		URL:            server.URL + "/model.bin",
		DestPath:       destPath,
		Client:         server.Client(),
		ExpectedSHA256: hashHex(payload),
		MaxAttempts:    3,
		RetryBackoff:   time.Millisecond,
	})
	if err != nil {
		t.Fatalf("Download: %v", err)
	}
	if !result.Resumed {
		t.Fatal("expected the download to resume from the partial")
	}
	if result.SHA256 != hashHex(payload) {
		t.Fatalf("sha256 over the whole assembled file mismatch: got=%s want=%s", result.SHA256, hashHex(payload))
	}
	assertFileContents(t, destPath, payload)
	assertNoPartial(t, destPath)
}

// TestDownloadFullFallbackWhenServerIgnoresRange covers scenario (c): a
// `<dest>.download` partial exists, the core sends a Range request, but the
// server returns 200 OK (ignored Range) — the core must restart from byte 0
// and still produce the correct final hash.
func TestDownloadFullFallbackWhenServerIgnoresRange(t *testing.T) {
	payload := []byte(strings.Repeat("server-ignores-range\n", 6000))
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Deliberately ignore Range: always 200 OK with the full body.
		w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(payload)
	}))
	defer server.Close()

	destPath := filepath.Join(t.TempDir(), "model.bin")
	if err := os.WriteFile(destPath+".download", []byte("stale-partial-bytes"), 0o644); err != nil {
		t.Fatalf("seed stale partial: %v", err)
	}

	result, err := Download(context.Background(), Options{
		URL:            server.URL + "/model.bin",
		DestPath:       destPath,
		Client:         server.Client(),
		ExpectedSHA256: hashHex(payload),
		MaxAttempts:    3,
		RetryBackoff:   time.Millisecond,
	})
	if err != nil {
		t.Fatalf("Download: %v", err)
	}
	if result.SHA256 != hashHex(payload) {
		t.Fatalf("sha256 mismatch after 200 fallback: got=%s want=%s", result.SHA256, hashHex(payload))
	}
	assertFileContents(t, destPath, payload)
	assertNoPartial(t, destPath)
}

// TestDownloadFailsClosedOnHashMismatch covers scenario (d): a fully delivered
// body whose sha256 does not match the expected digest fails closed with
// ErrHashMismatch, is NOT retried, and leaves no partial behind.
func TestDownloadFailsClosedOnHashMismatch(t *testing.T) {
	payload := []byte("the-bytes-the-server-actually-served")
	var requests int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&requests, 1)
		w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(payload)
	}))
	defer server.Close()

	destPath := filepath.Join(t.TempDir(), "model.bin")
	_, err := Download(context.Background(), Options{
		URL:            server.URL + "/model.bin",
		DestPath:       destPath,
		Client:         server.Client(),
		ExpectedSHA256: strings.Repeat("0", 64),
		MaxAttempts:    4,
		RetryBackoff:   time.Millisecond,
		IsTransient:    func(error) bool { return true },
	})
	if err == nil {
		t.Fatal("expected a hash-mismatch failure")
	}
	if !errors.Is(err, ErrHashMismatch) {
		t.Fatalf("expected ErrHashMismatch, got %v", err)
	}
	if got := atomic.LoadInt32(&requests); got != 1 {
		t.Fatalf("hash mismatch must not be retried: got %d requests", got)
	}
	assertNoPartial(t, destPath)
}

// TestDownloadContextCancellationAborts covers scenario (e): a cancelled
// context aborts the download immediately with no further retry.
func TestDownloadContextCancellationAborts(t *testing.T) {
	payload := []byte(strings.Repeat("slow-streaming-body\n", 100000))
	var requests int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&requests, 1)
		w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
		w.WriteHeader(http.StatusOK)
		flusher, _ := w.(http.Flusher)
		for offset := 0; offset < len(payload); offset += 256 {
			end := offset + 256
			if end > len(payload) {
				end = len(payload)
			}
			if _, err := w.Write(payload[offset:end]); err != nil {
				return
			}
			if flusher != nil {
				flusher.Flush()
			}
			time.Sleep(time.Millisecond)
		}
	}))
	defer server.Close()

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(15 * time.Millisecond)
		cancel()
	}()

	destPath := filepath.Join(t.TempDir(), "model.bin")
	_, err := Download(ctx, Options{
		URL:          server.URL + "/model.bin",
		DestPath:     destPath,
		Client:       server.Client(),
		MaxAttempts:  4,
		RetryBackoff: time.Millisecond,
		IsTransient:  func(error) bool { return true },
	})
	if err == nil {
		t.Fatal("expected a context-cancellation failure")
	}
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context.Canceled, got %v", err)
	}
	if got := atomic.LoadInt32(&requests); got != 1 {
		t.Fatalf("cancellation must not trigger a retry: got %d requests", got)
	}
	assertNoPartial(t, destPath)
}

// TestDownloadRetriesClientReadTimeout covers the long-download path where the
// injected HTTP client times out while reading the response body. That error is
// context.DeadlineExceeded-shaped, but the caller ctx is still alive, so the
// core must treat it as a transport timeout and allow the caller's transient
// classifier to resume from the partial.
func TestDownloadRetriesClientReadTimeout(t *testing.T) {
	payload := []byte(strings.Repeat("client-timeout-resume-payload\n", 4096))
	prefixLen := 2048
	var requests int32
	client := &http.Client{
		Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			attempt := atomic.AddInt32(&requests, 1)
			if attempt == 1 {
				return &http.Response{
					StatusCode:    http.StatusOK,
					Status:        "200 OK",
					Header:        make(http.Header),
					Body:          &timeoutAfterPrefixBody{chunk: payload[:prefixLen]},
					ContentLength: int64(len(payload)),
					Request:       r,
				}, nil
			}
			if got, want := r.Header.Get("Range"), "bytes="+strconv.Itoa(prefixLen)+"-"; got != want {
				t.Errorf("Range header = %q, want %q", got, want)
			}
			header := make(http.Header)
			header.Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", prefixLen, len(payload)-1, len(payload)))
			return &http.Response{
				StatusCode:    http.StatusPartialContent,
				Status:        "206 Partial Content",
				Header:        header,
				Body:          io.NopCloser(bytes.NewReader(payload[prefixLen:])),
				ContentLength: int64(len(payload) - prefixLen),
				Request:       r,
			}, nil
		}),
	}

	destPath := filepath.Join(t.TempDir(), "model.bin")
	result, err := Download(context.Background(), Options{
		URL:          "https://example.invalid/model.bin",
		DestPath:     destPath,
		Client:       client,
		MaxAttempts:  2,
		RetryBackoff: time.Millisecond,
		IsTransient:  func(err error) bool { return errors.Is(err, context.DeadlineExceeded) },
	})
	if err != nil {
		t.Fatalf("Download: %v", err)
	}
	if !result.Resumed {
		t.Fatal("expected client timeout retry to resume from the partial")
	}
	if got := atomic.LoadInt32(&requests); got != 2 {
		t.Fatalf("expected exactly two requests, got %d", got)
	}
	assertFileContents(t, destPath, payload)
	assertNoPartial(t, destPath)
}

// TestDownloadFailsClosedOn4xx asserts a 4xx is non-transient: it fails closed
// without a retry.
func TestDownloadFailsClosedOn4xx(t *testing.T) {
	var requests int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&requests, 1)
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	destPath := filepath.Join(t.TempDir(), "model.bin")
	_, err := Download(context.Background(), Options{
		URL:          server.URL + "/missing.bin",
		DestPath:     destPath,
		Client:       server.Client(),
		MaxAttempts:  4,
		RetryBackoff: time.Millisecond,
		IsTransient:  func(error) bool { return true },
	})
	if err == nil {
		t.Fatal("expected a 4xx failure")
	}
	if !errors.Is(err, ErrHTTPStatus) {
		t.Fatalf("expected ErrHTTPStatus, got %v", err)
	}
	if got := atomic.LoadInt32(&requests); got != 1 {
		t.Fatalf("a 4xx must not be retried: got %d requests", got)
	}
}

// TestDownloadRetriesTransient5xx asserts a 5xx is transient: the core retries
// and a later success completes.
func TestDownloadRetriesTransient5xx(t *testing.T) {
	payload := []byte("recovered-after-a-503")
	var requests int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if atomic.AddInt32(&requests, 1) == 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		serveWithRange(w, r, payload)
	}))
	defer server.Close()

	destPath := filepath.Join(t.TempDir(), "model.bin")
	result, err := Download(context.Background(), Options{
		URL:          server.URL + "/model.bin",
		DestPath:     destPath,
		Client:       server.Client(),
		MaxAttempts:  3,
		RetryBackoff: time.Millisecond,
	})
	if err != nil {
		t.Fatalf("Download: %v", err)
	}
	if result.SHA256 != hashHex(payload) {
		t.Fatalf("sha256 mismatch: got=%s want=%s", result.SHA256, hashHex(payload))
	}
}

// TestDownloadFailsClosedOnOversizeBody asserts the MaxBodyBytes budget is a
// non-transient failure.
func TestDownloadFailsClosedOnOversizeBody(t *testing.T) {
	payload := []byte(strings.Repeat("x", 4096))
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(payload)
	}))
	defer server.Close()

	destPath := filepath.Join(t.TempDir(), "model.bin")
	_, err := Download(context.Background(), Options{
		URL:          server.URL + "/model.bin",
		DestPath:     destPath,
		Client:       server.Client(),
		MaxBodyBytes: 1024,
		MaxAttempts:  3,
		RetryBackoff: time.Millisecond,
		IsTransient:  func(error) bool { return true },
	})
	if err == nil {
		t.Fatal("expected an oversize failure")
	}
	if !errors.Is(err, ErrMaxBodyExceeded) {
		t.Fatalf("expected ErrMaxBodyExceeded, got %v", err)
	}
	assertNoPartial(t, destPath)
}

// serveWithRange serves payload, honouring an HTTP `Range: bytes=N-` request
// with a 206 + Content-Range so the shared core can resume.
func serveWithRange(w http.ResponseWriter, r *http.Request, payload []byte) {
	rangeHeader := strings.TrimSpace(r.Header.Get("Range"))
	if rangeHeader == "" {
		w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(payload)
		return
	}
	const prefix = "bytes="
	if !strings.HasPrefix(rangeHeader, prefix) {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	startToken := strings.TrimSuffix(strings.TrimPrefix(rangeHeader, prefix), "-")
	start, err := strconv.Atoi(startToken)
	if err != nil || start < 0 || start > len(payload) {
		w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
		return
	}
	w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, len(payload)-1, len(payload)))
	w.Header().Set("Content-Length", strconv.Itoa(len(payload)-start))
	w.WriteHeader(http.StatusPartialContent)
	_, _ = w.Write(payload[start:])
}

func assertFileContents(t *testing.T, path string, want []byte) {
	t.Helper()
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	if string(got) != string(want) {
		t.Fatalf("file contents mismatch: got %d bytes want %d bytes", len(got), len(want))
	}
}

func assertNoPartial(t *testing.T, destPath string) {
	t.Helper()
	if _, err := os.Stat(destPath + ".download"); !os.IsNotExist(err) {
		t.Fatalf("expected no .download partial residue, stat err=%v", err)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}

type timeoutAfterPrefixBody struct {
	chunk []byte
	sent  bool
}

func (b *timeoutAfterPrefixBody) Read(p []byte) (int, error) {
	if !b.sent {
		b.sent = true
		return copy(p, b.chunk), nil
	}
	return 0, context.DeadlineExceeded
}

func (b *timeoutAfterPrefixBody) Close() error {
	return nil
}

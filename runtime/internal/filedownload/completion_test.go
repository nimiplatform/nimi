package filedownload

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

type completionTransport struct {
	base   http.RoundTripper
	closed *atomic.Bool
}

func (t completionTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	response, err := t.base.RoundTrip(r)
	if err == nil {
		response.Body = completionBody{ReadCloser: response.Body, closed: t.closed}
	}
	return response, err
}

type completionBody struct {
	io.ReadCloser
	closed *atomic.Bool
}

func (b completionBody) Close() error {
	err := b.ReadCloser.Close()
	b.closed.Store(true)
	return err
}

func TestDownloadTransferCompleteAfterIOBeforeVerification(t *testing.T) {
	payload := []byte("the transfer is complete, but the admitted digest must still be checked")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(payload)
	}))
	defer server.Close()
	closed := &atomic.Bool{}
	client := server.Client()
	client.Transport = completionTransport{base: client.Transport, closed: closed}
	dest := filepath.Join(t.TempDir(), "app.nimiapp")
	called := false
	_, err := Download(context.Background(), Options{
		URL: server.URL, Client: client, DestPath: dest,
		ExpectedSize: int64(len(payload)), ExpectedSHA256: strings.Repeat("0", 64),
		TransferComplete: func() error {
			called = true
			if !closed.Load() {
				t.Fatal("released network slot before response body closed")
			}
			assertFileContents(t, dest+".download", payload)
			if _, err := os.Stat(dest); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("transfer callback observed promoted file: %v", err)
			}
			return nil
		},
	})
	if !called || !errors.Is(err, ErrHashMismatch) {
		t.Fatalf("callback=%v error=%v; transfer completion must not bypass verification", called, err)
	}
	assertNoPartial(t, dest)
}

func TestDownloadCompleteRetainedPartialVerifiesWithoutRangeRequest(t *testing.T) {
	for _, corrupt := range []bool{false, true} {
		name := "valid"
		if corrupt {
			name = "invalid-digest"
		}
		t.Run(name, func(t *testing.T) {
			payload := []byte("complete before the interruption")
			retained := append([]byte(nil), payload...)
			if corrupt {
				retained[0] ^= 1
			}
			var requests atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				requests.Add(1)
				w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
			}))
			defer server.Close()
			dest := filepath.Join(t.TempDir(), "app.nimiapp")
			if err := os.WriteFile(dest+".download", retained, 0o600); err != nil {
				t.Fatal(err)
			}
			called := false
			result, err := Download(context.Background(), Options{
				URL: server.URL, Client: server.Client(), DestPath: dest,
				ExpectedSize: int64(len(payload)), ExpectedSHA256: hashHex(payload),
				TransferComplete: func() error { called = true; return nil },
			})
			if requests.Load() != 0 || !called {
				t.Fatalf("requests=%d callback=%v", requests.Load(), called)
			}
			if corrupt {
				if !errors.Is(err, ErrHashMismatch) {
					t.Fatalf("invalid retained file accepted: %v", err)
				}
				assertNoPartial(t, dest)
				return
			}
			if err != nil || result.Attempts != 0 || !result.Resumed {
				t.Fatalf("local verification: result=%+v err=%v", result, err)
			}
			assertFileContents(t, dest, payload)
			assertNoPartial(t, dest)
		})
	}
}

func TestDownloadExactSizeDoesNotAcceptShortCompletedResponse(t *testing.T) {
	payload := []byte("short")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(payload)
	}))
	defer server.Close()
	dest := filepath.Join(t.TempDir(), "app.nimiapp")
	_, err := Download(context.Background(), Options{
		URL: server.URL, Client: server.Client(), DestPath: dest,
		ExpectedSize: 100, ExpectedSHA256: hashHex(payload),
		TransferComplete: func() error { t.Fatal("short file reported complete"); return nil },
	})
	if !errors.Is(err, ErrSizeMismatch) {
		t.Fatalf("short transfer: %v", err)
	}
	assertNoPartial(t, dest)
}

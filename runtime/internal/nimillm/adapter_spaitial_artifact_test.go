package nimillm

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSpaitialSignedArtifactStreamDoesNotForwardCredential(t *testing.T) {
	asset := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" || r.Header.Get("X-Private") != "" {
			t.Error("API credential crossed into signed asset request")
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = w.Write([]byte("captured-artifact"))
	}))
	defer asset.Close()
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-key" || r.URL.Path != "/v1/worlds/requests/req_owned/splat" {
			t.Error("incorrect credentialed proxy identity")
		}
		http.Redirect(w, r, asset.URL+"/asset?signature=private", http.StatusFound)
	}))
	defer api.Close()
	stream, _, size, err := openSpaitialArtifactStream(loopbackProviderTestContext(context.Background()), MediaAdapterConfig{BaseURL: api.URL, APIKey: "test-key", Headers: map[string]string{"X-Private": "private"}}, "req_owned", "splat")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = stream.Close() }()
	body, err := io.ReadAll(stream)
	if err != nil || string(body) != "captured-artifact" || size != int64(len(body)) {
		t.Fatalf("stream body=%q size=%d err=%v", body, size, err)
	}
	if _, _, _, err = openSpaitialArtifactStream(context.Background(), MediaAdapterConfig{BaseURL: "https://uncontrolled.example", APIKey: "secret"}, "req_owned", "splat"); err == nil {
		t.Fatal("credentialed arbitrary origin accepted")
	}
}

func TestSpaitialArtifactStreamUsesCustodyLimitInsteadOfInlineLimit(t *testing.T) {
	const payloadBytes = 33 << 20
	asset := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oversized" {
			w.Header().Set("Content-Length", "8589934593")
			return
		}
		chunk := make([]byte, 64<<10)
		for i := 0; i < payloadBytes/len(chunk); i++ {
			if _, err := w.Write(chunk); err != nil {
				return
			}
		}
	}))
	defer asset.Close()
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := "/large"
		if strings.Contains(r.URL.Path, "req_oversized") {
			path = "/oversized"
		}
		http.Redirect(w, r, asset.URL+path, http.StatusFound)
	}))
	defer api.Close()
	cfg := MediaAdapterConfig{BaseURL: api.URL, APIKey: "test-key"}
	ctx := loopbackProviderTestContext(context.Background())
	stream, _, _, err := openSpaitialArtifactStream(ctx, cfg, "req_owned", "splat")
	if err != nil {
		t.Fatal(err)
	}
	count, err := io.Copy(io.Discard, stream)
	_ = stream.Close()
	if err != nil || count != payloadBytes {
		t.Fatalf("stream count=%d err=%v", count, err)
	}
	if stream, _, _, err = openSpaitialArtifactStream(ctx, cfg, "req_oversized", "splat"); err == nil {
		_ = stream.Close()
		t.Fatal("oversized custody output accepted")
	}
}

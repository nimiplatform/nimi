package nimillm

import (
	"context"
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func TestDecodeMediaBase64(t *testing.T) {
	backend := NewBackend("llama", "http://127.0.0.1", "", time.Second)
	payload, err := backend.DecodeMedia(context.Background(), base64.StdEncoding.EncodeToString([]byte("hello")), "")
	if err != nil {
		t.Fatalf("DecodeMedia(base64) failed: %v", err)
	}
	if string(payload) != "hello" {
		t.Fatalf("unexpected payload: %q", string(payload))
	}
}

func TestDecodeMediaURLHonorsContext(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
			return
		case <-time.After(300 * time.Millisecond):
			_, _ = w.Write([]byte("late"))
		}
	}))
	defer server.Close()

	backend := NewBackend("llama", server.URL, "", time.Second)
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	_, err := backend.DecodeMedia(ctx, "", server.URL)
	if err == nil {
		t.Fatal("expected context deadline error")
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT {
		t.Fatalf("expected AI_PROVIDER_TIMEOUT, got=%v err=%v", reason, err)
	}
}

func TestDecodeMediaURLRejectsOversizedPayload(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = io.Copy(w, io.LimitReader(zeroReader{}, maxDecodedMediaURLBytes+1))
	}))
	defer server.Close()

	backend := NewBackend("llama", server.URL, "", time.Second)
	_, err := backend.DecodeMedia(context.Background(), "", server.URL)
	if err == nil {
		t.Fatal("expected oversized payload error")
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
		t.Fatalf("expected AI_OUTPUT_INVALID, got=%v err=%v", reason, err)
	}
}

func TestArtifactUsageEstimatesBinaryBySize(t *testing.T) {
	usage := ArtifactUsage("prompt", []byte{0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49}, 123)
	if usage == nil {
		t.Fatal("expected usage")
	}
	if got, want := usage.GetOutputTokens(), int64(3); got != want {
		t.Fatalf("unexpected binary token estimate: got=%d want=%d", got, want)
	}
}

type zeroReader struct{}

func (zeroReader) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = 0
	}
	return len(p), nil
}

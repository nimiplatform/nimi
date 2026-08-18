package nimillm

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestDetachMediaArtifactBodiesStreamsProviderURLWithBackpressureAndCancellation(t *testing.T) {
	headersSent := make(chan struct{})
	allowChunk := make(chan struct{})
	requestCanceled := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		w.Header().Set("Content-Type", "video/mp4")
		w.WriteHeader(http.StatusOK)
		w.(http.Flusher).Flush()
		close(headersSent)
		select {
		case <-allowChunk:
			_, _ = w.Write([]byte("chunk-one"))
			w.(http.Flusher).Flush()
		case <-request.Context().Done():
			close(requestCanceled)
			return
		}
		<-request.Context().Done()
		close(requestCanceled)
	}))
	defer server.Close()

	ctx, cancel := context.WithCancel(WithMediaAdapterEndpointPolicy(context.Background(), MediaAdapterConfig{AllowLoopbackEndpoint: true}))
	artifact := &runtimev1.ScenarioArtifact{ArtifactId: "provider-video", MimeType: "video/mp4", Uri: server.URL + "/video.mp4"}
	bodies, err := detachMediaArtifactBodies(ctx, []*runtimev1.ScenarioArtifact{artifact})
	if err != nil {
		t.Fatalf("detach body: %v", err)
	}
	<-headersSent
	if len(artifact.GetBytes()) != 0 || artifact.GetUri() != "" || bodies[artifact.GetArtifactId()] == nil || bodies[artifact.GetArtifactId()].Stream == nil {
		t.Fatalf("detached artifact=%+v body=%+v", artifact, bodies[artifact.GetArtifactId()])
	}
	readResult := make(chan struct {
		payload string
		err     error
	}, 1)
	go func() {
		payload := make([]byte, len("chunk-one"))
		read, readErr := io.ReadFull(bodies[artifact.GetArtifactId()].Stream, payload)
		readResult <- struct {
			payload string
			err     error
		}{payload: string(payload[:read]), err: readErr}
	}()
	select {
	case result := <-readResult:
		t.Fatalf("provider stream ignored backpressure: %+v", result)
	case <-time.After(50 * time.Millisecond):
	}
	close(allowChunk)
	result := <-readResult
	if result.err != nil || result.payload != "chunk-one" {
		t.Fatalf("streamed chunk=%q err=%v", result.payload, result.err)
	}
	cancel()
	buffer := make([]byte, 1)
	if _, err := bodies[artifact.GetArtifactId()].Stream.Read(buffer); err == nil {
		t.Fatal("provider stream read survived context cancellation")
	}
	if err := bodies[artifact.GetArtifactId()].Stream.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-requestCanceled:
	case <-time.After(time.Second):
		t.Fatal("provider request did not observe cancellation")
	}
}

func TestDetachMediaArtifactBodiesRejectsKnownOversizeBeforeStreamAcceptance(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Length", "8589934593")
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	artifact := &runtimev1.ScenarioArtifact{ArtifactId: "provider-oversize", MimeType: "video/mp4", Uri: server.URL + "/video.mp4"}
	ctx := WithMediaAdapterEndpointPolicy(context.Background(), MediaAdapterConfig{AllowLoopbackEndpoint: true})
	if _, err := detachMediaArtifactBodies(ctx, []*runtimev1.ScenarioArtifact{artifact}); err == nil {
		t.Fatal("known oversize provider body was accepted")
	}
}

func TestTranscriptionInputURINeverBecomesOutputArtifactURI(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests++
		w.Header().Set("Content-Type", "audio/wav")
		_, _ = w.Write([]byte("input-audio"))
	}))
	defer server.Close()

	artifact := BinaryArtifact("text/plain", []byte("captured transcript"), map[string]any{
		"audio_uri": server.URL + "/input.wav",
	})
	ApplyTranscriptionSpecMetadata(artifact, &runtimev1.SpeechTranscribeScenarioSpec{})
	ctx := WithMediaAdapterEndpointPolicy(context.Background(), MediaAdapterConfig{AllowLoopbackEndpoint: true})
	bodies, err := detachMediaArtifactBodies(ctx, []*runtimev1.ScenarioArtifact{artifact})
	if err != nil {
		t.Fatalf("detach transcript body: %v", err)
	}
	defer func() {
		if body := bodies[artifact.GetArtifactId()]; body != nil && body.Stream != nil {
			_ = body.Stream.Close()
		}
	}()
	if requests != 0 {
		t.Fatalf("transcription input URI was fetched as output custody: requests=%d", requests)
	}
	if artifact.GetUri() != "" {
		t.Fatalf("transcription output retained input URI as body location: %q", artifact.GetUri())
	}
	body := bodies[artifact.GetArtifactId()]
	if body == nil || string(body.Bytes) != "captured transcript" || body.Stream != nil {
		t.Fatalf("transcript body=%+v", body)
	}
}

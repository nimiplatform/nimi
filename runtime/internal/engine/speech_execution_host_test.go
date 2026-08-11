package engine

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
)

type speechExecutionHostMaterializerStub struct {
	endpoint       string
	materializeErr error
	onMaterialize  func()
	capabilities   []string
	stopped        chan struct{}
	stopRelease    chan struct{}
	stopErr        error
}

func TestSpeechExecutionHostTransportCannotPreemptAdmittedJobTimeout(t *testing.T) {
	materializer := &speechExecutionHostMaterializerStub{endpoint: "http://127.0.0.1:8330"}
	if got := NewSpeechExecutionHost(materializer, 8330, 0).timeout; got != 30*time.Minute {
		t.Fatalf("default speech Host timeout = %s, want 30m", got)
	}
	if got := NewSpeechExecutionHost(materializer, 8330, 45*time.Minute).timeout; got != 30*time.Minute {
		t.Fatalf("clamped speech Host timeout = %s, want 30m", got)
	}
	if got := NewSpeechExecutionHost(materializer, 8330, 20*time.Minute).timeout; got != 20*time.Minute {
		t.Fatalf("explicit speech Host timeout = %s, want 20m", got)
	}
}

func (stub *speechExecutionHostMaterializerStub) MaterializeSpeechExecutionHost(_ context.Context, capabilityContract string, _ string, _ int) (string, error) {
	stub.capabilities = append(stub.capabilities, capabilityContract)
	if stub.onMaterialize != nil {
		stub.onMaterialize()
	}
	return stub.endpoint, stub.materializeErr
}

func (stub *speechExecutionHostMaterializerStub) StopSpeechExecutionHost() error {
	if stub.stopped != nil {
		select {
		case <-stub.stopped:
		default:
			close(stub.stopped)
		}
	}
	if stub.stopRelease != nil {
		<-stub.stopRelease
	}
	return stub.stopErr
}

func TestSpeechExecutionHostUsesExactPlanAssetIdentity(t *testing.T) {
	digest := strings.Repeat("d", 64)
	root := t.TempDir()
	ttsHostModelID := "local-import/Qwen3-TTS-12Hz-0.6B-CustomVoice"
	asrHostModelID := "local-import/Qwen3-ASR-0.6B-hf"
	ttsPlan, err := (capabilitydriver.Qwen3TTSDriver{}).PlanSpeechSynthesizeInvocation(capabilitydriver.SpeechSynthesizeInvocationInput{
		ExactBindings: []capabilitydriver.InvocationExactBinding{{RequirementID: capabilitydriver.Qwen3TTSModelRequirementID, AssetID: ttsHostModelID, LocalAssetID: "tts-exact-asset", AbsolutePath: filepath.Join(root, "tts.safetensors"), VerifiedContentID: "sha256:" + digest, EntrySHA256: digest}},
		Request:       &runtimev1.SpeechSynthesizeScenarioSpec{Text: "hello"},
	})
	if err != nil {
		t.Fatal(err)
	}
	asrPlan, err := (capabilitydriver.Qwen3ASRDriver{}).PlanSpeechTranscribeInvocation(capabilitydriver.SpeechTranscribeInvocationInput{
		ExactBindings: []capabilitydriver.InvocationExactBinding{{RequirementID: capabilitydriver.Qwen3ASRModelRequirementID, AssetID: asrHostModelID, LocalAssetID: "asr-exact-asset", AbsolutePath: filepath.Join(root, "asr.safetensors"), VerifiedContentID: "sha256:" + digest, EntrySHA256: digest}},
		Request:       &runtimev1.SpeechTranscribeScenarioSpec{MimeType: "audio/wav", Language: "en"},
		AudioBytes:    []byte("audio-bytes"),
		MIMEType:      "audio/wav",
	})
	if err != nil {
		t.Fatal(err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/v1/audio/speech":
			var payload map[string]any
			if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
				t.Errorf("decode TTS payload: %v", err)
				writer.WriteHeader(http.StatusBadRequest)
				return
			}
			if payload["model"] != ttsHostModelID || payload["input"] != "hello" {
				t.Errorf("TTS payload=%+v", payload)
			}
			writer.Header().Set("Content-Type", "audio/wav")
			_, _ = writer.Write([]byte("RIFF-host-audio"))
		case "/v1/audio/transcriptions":
			if err := request.ParseMultipartForm(1 << 20); err != nil {
				t.Errorf("parse ASR multipart: %v", err)
				writer.WriteHeader(http.StatusBadRequest)
				return
			}
			if request.FormValue("model") != asrHostModelID || request.FormValue("language") != "en" {
				t.Errorf("ASR form=%+v", request.MultipartForm.Value)
			}
			writer.Header().Set("Content-Type", "application/json")
			_, _ = writer.Write([]byte(`{"text":"host transcript"}`))
		default:
			writer.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	materializer := &speechExecutionHostMaterializerStub{endpoint: server.URL}
	host := NewSpeechExecutionHost(materializer, 8330, 0)
	ttsResult, err := host.ExecuteSpeechSynthesis(context.Background(), ttsPlan, nil)
	if err != nil || ttsResult.AudioBody == nil || len(ttsResult.AudioBytes) != 0 || ttsResult.MIMEType != "audio/wav" {
		t.Fatalf("TTS result=%+v error=%v", ttsResult, err)
	}
	ttsPayload, readErr := io.ReadAll(ttsResult.AudioBody)
	closeErr := ttsResult.AudioBody.Close()
	if readErr != nil || closeErr != nil || string(ttsPayload) != "RIFF-host-audio" {
		t.Fatalf("read TTS body: payload=%q read=%v close=%v", ttsPayload, readErr, closeErr)
	}
	asrResult, err := host.ExecuteSpeechTranscription(context.Background(), asrPlan, nil)
	if err != nil || asrResult.Text != "host transcript" {
		t.Fatalf("ASR result=%+v error=%v", asrResult, err)
	}
	if got, want := strings.Join(materializer.capabilities, ","), "audio.synthesize,audio.transcribe"; got != want {
		t.Fatalf("materialized capabilities = %q, want %q", got, want)
	}
}

type speechZeroReader struct{}

func (speechZeroReader) Read(target []byte) (int, error) {
	for index := range target {
		target[index] = 0
	}
	return len(target), nil
}

func TestSpeechExecutionHostStreamsSynthesisBeyondInlineLimit(t *testing.T) {
	const bodySize = int64(32<<20 + 1)
	digest := strings.Repeat("d", 64)
	root := t.TempDir()
	modelID := "local-import/Qwen3-TTS-12Hz-0.6B-CustomVoice"
	plan, err := (capabilitydriver.Qwen3TTSDriver{}).PlanSpeechSynthesizeInvocation(capabilitydriver.SpeechSynthesizeInvocationInput{
		ExactBindings: []capabilitydriver.InvocationExactBinding{{RequirementID: capabilitydriver.Qwen3TTSModelRequirementID, AssetID: modelID, LocalAssetID: "tts-exact-asset", AbsolutePath: filepath.Join(root, "tts.safetensors"), VerifiedContentID: "sha256:" + digest, EntrySHA256: digest}},
		Request:       &runtimev1.SpeechSynthesizeScenarioSpec{Text: "large local speech"},
	})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v1/audio/speech" {
			writer.WriteHeader(http.StatusNotFound)
			return
		}
		writer.Header().Set("Content-Type", "audio/wav")
		writer.Header().Set("Content-Length", strconv.FormatInt(bodySize, 10))
		_, _ = io.CopyN(writer, speechZeroReader{}, bodySize)
	}))
	defer server.Close()

	host := NewSpeechExecutionHost(&speechExecutionHostMaterializerStub{endpoint: server.URL}, 8330, 0)
	result, err := host.ExecuteSpeechSynthesis(context.Background(), plan, nil)
	if err != nil {
		t.Fatalf("ExecuteSpeechSynthesis: %v", err)
	}
	if result.AudioBody == nil || len(result.AudioBytes) != 0 || result.SizeBytes != bodySize {
		t.Fatalf("streamed TTS result=%+v", result)
	}
	observed, readErr := io.Copy(io.Discard, result.AudioBody)
	closeErr := result.AudioBody.Close()
	if readErr != nil || closeErr != nil || observed != bodySize {
		t.Fatalf("streamed TTS body: bytes=%d read=%v close=%v", observed, readErr, closeErr)
	}
}

func TestSpeechExecutionHostFIFOAndQueuedCancellation(t *testing.T) {
	firstRelease := make(chan struct{})
	t.Cleanup(func() {
		select {
		case <-firstRelease:
		default:
			close(firstRelease)
		}
	})
	requests := make(chan string, 3)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v1/audio/speech" {
			writer.WriteHeader(http.StatusNotFound)
			return
		}
		var payload map[string]any
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			writer.WriteHeader(http.StatusBadRequest)
			return
		}
		text, _ := payload["input"].(string)
		requests <- text
		if text == "first" {
			<-firstRelease
		}
		writer.Header().Set("Content-Type", "audio/wav")
		_, _ = writer.Write([]byte("RIFF-" + text))
	}))
	defer server.Close()

	host := NewSpeechExecutionHost(&speechExecutionHostMaterializerStub{endpoint: server.URL}, 8330, 0)
	started := make(chan string, 3)
	firstPlan := speechSynthesisPlanForHostTest(t, "first")
	secondPlan := speechTranscriptionPlanForHostTest(t, "second")
	thirdPlan := speechSynthesisPlanForHostTest(t, "third")
	executeSynthesis := func(ctx context.Context, plan *capabilitydriver.SpeechSynthesizeInvocationPlan, text string) error {
		result, err := host.ExecuteSpeechSynthesis(ctx, plan, func() error {
			started <- text
			return nil
		})
		if result.AudioBody != nil {
			_, _ = io.Copy(io.Discard, result.AudioBody)
			_ = result.AudioBody.Close()
		}
		return err
	}

	firstDone := make(chan error, 1)
	go func() { firstDone <- executeSynthesis(context.Background(), firstPlan, "first") }()
	select {
	case got := <-started:
		if got != "first" {
			t.Fatalf("first start=%q", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("first request did not start")
	}
	select {
	case got := <-requests:
		if got != "first" {
			t.Fatalf("first request=%q", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("first request did not reach backend")
	}

	secondCtx, cancelSecond := context.WithCancel(context.Background())
	secondDone := make(chan error, 1)
	go func() {
		_, err := host.ExecuteSpeechTranscription(secondCtx, secondPlan, func() error {
			started <- "second"
			return nil
		})
		secondDone <- err
	}()
	waitSpeechExecutionQueueLength(t, host, 1)
	cancelSecond()
	select {
	case err := <-secondDone:
		if localexecution.FailureKindOf(err) != localexecution.FailureCanceled {
			t.Fatalf("queued cancel error=%v kind=%q", err, localexecution.FailureKindOf(err))
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("queued speech cancellation waited for active request")
	}
	select {
	case got := <-started:
		t.Fatalf("canceled queued request started: %q", got)
	default:
	}

	thirdDone := make(chan error, 1)
	go func() { thirdDone <- executeSynthesis(context.Background(), thirdPlan, "third") }()
	waitSpeechExecutionQueueLength(t, host, 1)
	select {
	case got := <-started:
		t.Fatalf("queued third request started before lease release: %q", got)
	default:
	}
	close(firstRelease)
	if err := <-firstDone; err != nil {
		t.Fatalf("first request: %v", err)
	}
	select {
	case got := <-started:
		if got != "third" {
			t.Fatalf("next start=%q", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("third request did not start after lease release")
	}
	if err := <-thirdDone; err != nil {
		t.Fatalf("third request: %v", err)
	}
	select {
	case got := <-requests:
		if got != "third" {
			t.Fatalf("next backend request=%q", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("third request did not reach backend")
	}
}

func TestSpeechExecutionHostDoesNotPublishRunningBeforeMaterialization(t *testing.T) {
	materializer := &speechExecutionHostMaterializerStub{materializeErr: errors.New("profile unavailable")}
	host := NewSpeechExecutionHost(materializer, 8330, 0)
	started := false
	_, err := host.ExecuteSpeechTranscription(
		context.Background(),
		speechTranscriptionPlanForHostTest(t, "materialization-failure"),
		func() error {
			started = true
			return nil
		},
	)
	if localexecution.FailureKindOf(err) != localexecution.FailureLoad {
		t.Fatalf("materialization failure error=%v kind=%q", err, localexecution.FailureKindOf(err))
	}
	if started {
		t.Fatal("materialization failure published RUNNING before exact Host was available")
	}
}

func TestSpeechExecutionHostKeepsLeaseUntilTTSBodyIsDrainedOrClosed(t *testing.T) {
	ttsHeaders := make(chan struct{})
	ttsBodyRelease := make(chan struct{})
	transcriptionEntered := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/v1/audio/speech":
			writer.Header().Set("Content-Type", "audio/wav")
			_, _ = writer.Write([]byte("RIFF"))
			if flusher, ok := writer.(http.Flusher); ok {
				flusher.Flush()
			}
			select {
			case <-ttsHeaders:
			default:
				close(ttsHeaders)
			}
			<-ttsBodyRelease
			_, _ = writer.Write([]byte("-complete"))
		case "/v1/audio/transcriptions":
			select {
			case <-transcriptionEntered:
			default:
				close(transcriptionEntered)
			}
			writer.Header().Set("Content-Type", "application/json")
			_, _ = writer.Write([]byte(`{"text":"unexpected"}`))
		default:
			writer.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(func() {
		select {
		case <-ttsBodyRelease:
		default:
			close(ttsBodyRelease)
		}
		server.Close()
	})

	stopped := make(chan struct{})
	host := NewSpeechExecutionHost(&speechExecutionHostMaterializerStub{endpoint: server.URL, stopped: stopped}, 8330, 0)
	first, err := host.ExecuteSpeechSynthesis(context.Background(), speechSynthesisPlanForHostTest(t, "slow-body"), nil)
	if err != nil {
		t.Fatalf("start TTS body: %v", err)
	}
	select {
	case <-ttsHeaders:
	case <-time.After(2 * time.Second):
		t.Fatal("TTS response headers were not flushed")
	}

	secondCtx, cancelSecond := context.WithCancel(context.Background())
	secondDone := make(chan error, 1)
	go func() {
		_, err := host.ExecuteSpeechTranscription(secondCtx, speechTranscriptionPlanForHostTest(t, "behind-slow-body"), nil)
		secondDone <- err
	}()
	waitSpeechExecutionQueueLength(t, host, 1)
	select {
	case <-transcriptionEntered:
		t.Fatal("second request entered Host before first TTS body completed")
	default:
	}
	cancelSecond()
	select {
	case err := <-secondDone:
		if localexecution.FailureKindOf(err) != localexecution.FailureCanceled {
			t.Fatalf("queued second request error=%v kind=%q", err, localexecution.FailureKindOf(err))
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("queued second request did not cancel while TTS body was open")
	}
	select {
	case <-stopped:
		t.Fatal("queued cancellation stopped Host backing the active TTS body")
	default:
	}

	close(ttsBodyRelease)
	if _, err := io.Copy(io.Discard, first.AudioBody); err != nil {
		t.Fatalf("drain first TTS body: %v", err)
	}
	if err := first.AudioBody.Close(); err != nil {
		t.Fatalf("close first TTS body: %v", err)
	}
}

func TestSpeechExecutionHostCanceledTTSBodyStopsHostBeforeLeaseRelease(t *testing.T) {
	ttsHeaders := make(chan struct{})
	transcriptionEntered := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/v1/audio/speech":
			writer.Header().Set("Content-Type", "audio/wav")
			_, _ = writer.Write([]byte("RIFF"))
			if flusher, ok := writer.(http.Flusher); ok {
				flusher.Flush()
			}
			close(ttsHeaders)
			<-request.Context().Done()
		case "/v1/audio/transcriptions":
			close(transcriptionEntered)
			writer.Header().Set("Content-Type", "application/json")
			_, _ = writer.Write([]byte(`{"text":"after-cancel"}`))
		default:
			writer.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	materializer := &speechExecutionHostMaterializerStub{
		endpoint:    server.URL,
		stopped:     make(chan struct{}),
		stopRelease: make(chan struct{}),
	}
	t.Cleanup(func() {
		select {
		case <-materializer.stopRelease:
		default:
			close(materializer.stopRelease)
		}
	})
	host := NewSpeechExecutionHost(materializer, 8330, 0)
	ctx, cancel := context.WithCancel(context.Background())
	first, err := host.ExecuteSpeechSynthesis(ctx, speechSynthesisPlanForHostTest(t, "cancel-body"), nil)
	if err != nil {
		t.Fatalf("start TTS body: %v", err)
	}
	select {
	case <-ttsHeaders:
	case <-time.After(2 * time.Second):
		t.Fatal("TTS response headers were not flushed")
	}
	readDone := make(chan error, 1)
	go func() {
		_, readErr := io.Copy(io.Discard, first.AudioBody)
		readDone <- readErr
	}()

	secondDone := make(chan error, 1)
	go func() {
		_, secondErr := host.ExecuteSpeechTranscription(context.Background(), speechTranscriptionPlanForHostTest(t, "after-cancel"), nil)
		secondDone <- secondErr
	}()
	waitSpeechExecutionQueueLength(t, host, 1)
	cancel()
	select {
	case <-materializer.stopped:
	case <-transcriptionEntered:
		t.Fatal("second request entered Host before canceled TTS Host stop")
	case readErr := <-readDone:
		t.Fatalf("canceled TTS body returned before supervised Host stop: %v", readErr)
	case <-time.After(2 * time.Second):
		t.Fatal("canceled TTS body did not stop supervised Host")
	}
	select {
	case <-transcriptionEntered:
		t.Fatal("second request entered Host while canceled TTS Host stop was blocked")
	case readErr := <-readDone:
		t.Fatalf("canceled TTS body released lease while Host stop was blocked: %v", readErr)
	case <-time.After(100 * time.Millisecond):
	}
	close(materializer.stopRelease)
	select {
	case readErr := <-readDone:
		if readErr == nil {
			t.Fatal("canceled TTS body read returned nil error")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("canceled TTS body did not return after Host stop")
	}
	select {
	case <-transcriptionEntered:
	case <-time.After(2 * time.Second):
		t.Fatal("second request did not enter Host after canceled TTS cleanup")
	}
	if err := <-secondDone; err != nil {
		t.Fatalf("second request after canceled TTS: %v", err)
	}
	_ = first.AudioBody.Close()
}

func TestSpeechExecutionHostEarlyTTSBodyCloseStopsHostBeforeLeaseRelease(t *testing.T) {
	ttsHeaders := make(chan struct{})
	ttsHandlerRelease := make(chan struct{})
	transcriptionEntered := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/v1/audio/speech":
			writer.Header().Set("Content-Type", "audio/wav")
			_, _ = writer.Write([]byte("RIFF"))
			if flusher, ok := writer.(http.Flusher); ok {
				flusher.Flush()
			}
			close(ttsHeaders)
			<-ttsHandlerRelease
		case "/v1/audio/transcriptions":
			close(transcriptionEntered)
			writer.Header().Set("Content-Type", "application/json")
			_, _ = writer.Write([]byte(`{"text":"after-close"}`))
		default:
			writer.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(func() {
		select {
		case <-ttsHandlerRelease:
		default:
			close(ttsHandlerRelease)
		}
		server.Close()
	})

	materializer := &speechExecutionHostMaterializerStub{
		endpoint:    server.URL,
		stopped:     make(chan struct{}),
		stopRelease: make(chan struct{}),
	}
	t.Cleanup(func() {
		select {
		case <-materializer.stopRelease:
		default:
			close(materializer.stopRelease)
		}
	})
	host := NewSpeechExecutionHost(materializer, 8330, 0)
	first, err := host.ExecuteSpeechSynthesis(context.Background(), speechSynthesisPlanForHostTest(t, "close-body"), nil)
	if err != nil {
		t.Fatalf("start TTS body: %v", err)
	}
	select {
	case <-ttsHeaders:
	case <-time.After(2 * time.Second):
		t.Fatal("TTS response headers were not flushed")
	}

	secondDone := make(chan error, 1)
	go func() {
		_, secondErr := host.ExecuteSpeechTranscription(context.Background(), speechTranscriptionPlanForHostTest(t, "after-close"), nil)
		secondDone <- secondErr
	}()
	waitSpeechExecutionQueueLength(t, host, 1)
	closeDone := make(chan error, 1)
	go func() { closeDone <- first.AudioBody.Close() }()
	select {
	case <-materializer.stopped:
	case <-transcriptionEntered:
		t.Fatal("second request entered Host before early-close Host stop")
	case closeErr := <-closeDone:
		t.Fatalf("early TTS body Close returned before supervised Host stop: %v", closeErr)
	case <-time.After(2 * time.Second):
		t.Fatal("early TTS body Close did not stop supervised Host")
	}
	select {
	case <-transcriptionEntered:
		t.Fatal("second request entered Host while early-close Host stop was blocked")
	case closeErr := <-closeDone:
		t.Fatalf("early TTS body Close released lease while Host stop was blocked: %v", closeErr)
	case <-time.After(100 * time.Millisecond):
	}
	close(materializer.stopRelease)
	select {
	case closeErr := <-closeDone:
		if closeErr != nil {
			t.Fatalf("early TTS body Close after successful stop: %v", closeErr)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("early TTS body Close did not return after Host stop")
	}
	select {
	case <-transcriptionEntered:
	case <-time.After(2 * time.Second):
		t.Fatal("second request did not enter Host after early-close cleanup")
	}
	if err := <-secondDone; err != nil {
		t.Fatalf("second request after early-close TTS: %v", err)
	}
}

func TestSpeechExecutionHostCompletedTTSBodyCloseDoesNotStopHost(t *testing.T) {
	stopped := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/v1/audio/speech":
			writer.Header().Set("Content-Type", "audio/wav")
			_, _ = writer.Write([]byte("RIFF-complete"))
		case "/v1/audio/transcriptions":
			writer.Header().Set("Content-Type", "application/json")
			_, _ = writer.Write([]byte(`{"text":"after-complete"}`))
		default:
			writer.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	host := NewSpeechExecutionHost(&speechExecutionHostMaterializerStub{endpoint: server.URL, stopped: stopped}, 8330, 0)
	first, err := host.ExecuteSpeechSynthesis(context.Background(), speechSynthesisPlanForHostTest(t, "complete-body"), nil)
	if err != nil {
		t.Fatalf("execute complete TTS body: %v", err)
	}
	payload, readErr := io.ReadAll(first.AudioBody)
	if readErr != nil || string(payload) != "RIFF-complete" {
		t.Fatalf("drain complete TTS body: payload=%q read=%v", payload, readErr)
	}
	result, err := host.ExecuteSpeechTranscription(context.Background(), speechTranscriptionPlanForHostTest(t, "after-complete"), nil)
	if err != nil || result.Text != "after-complete" {
		t.Fatalf("request after complete TTS body: result=%+v error=%v", result, err)
	}
	if closeErr := first.AudioBody.Close(); closeErr != nil {
		t.Fatalf("close complete TTS body: %v", closeErr)
	}
	select {
	case <-stopped:
		t.Fatal("normal EOF and Close stopped healthy Speech Host")
	default:
	}
}

func TestSpeechExecutionHostTTSBodyStopFailurePoisonsHost(t *testing.T) {
	ttsHeaders := make(chan struct{})
	ttsHandlerRelease := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v1/audio/speech" {
			writer.WriteHeader(http.StatusNotFound)
			return
		}
		writer.Header().Set("Content-Type", "audio/wav")
		_, _ = writer.Write([]byte("RIFF"))
		if flusher, ok := writer.(http.Flusher); ok {
			flusher.Flush()
		}
		close(ttsHeaders)
		<-ttsHandlerRelease
	}))
	t.Cleanup(func() {
		close(ttsHandlerRelease)
		server.Close()
	})

	materializer := &speechExecutionHostMaterializerStub{endpoint: server.URL, stopErr: errors.New("supervisor stop failed")}
	host := NewSpeechExecutionHost(materializer, 8330, 0)
	first, err := host.ExecuteSpeechSynthesis(context.Background(), speechSynthesisPlanForHostTest(t, "close-stop-failure"), nil)
	if err != nil {
		t.Fatalf("start TTS body: %v", err)
	}
	select {
	case <-ttsHeaders:
	case <-time.After(2 * time.Second):
		t.Fatal("TTS response headers were not flushed")
	}
	if closeErr := first.AudioBody.Close(); localexecution.FailureKindOf(closeErr) != localexecution.FailureProcessCrash {
		t.Fatalf("early-close stop failure error=%v kind=%q", closeErr, localexecution.FailureKindOf(closeErr))
	}
	_, err = host.ExecuteSpeechTranscription(context.Background(), speechTranscriptionPlanForHostTest(t, "poisoned-after-body"), nil)
	if localexecution.FailureKindOf(err) != localexecution.FailureProcessCrash {
		t.Fatalf("poisoned Host error=%v kind=%q", err, localexecution.FailureKindOf(err))
	}
	if got := len(materializer.capabilities); got != 1 {
		t.Fatalf("poisoned Host materialization calls=%d, want 1", got)
	}
}

func TestSpeechExecutionHostRunningCancelStopsSupervisedHostBeforeLeaseRelease(t *testing.T) {
	requestEntered := make(chan struct{})
	handlerRelease := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v1/audio/transcriptions" {
			writer.WriteHeader(http.StatusNotFound)
			return
		}
		select {
		case <-requestEntered:
		default:
			close(requestEntered)
		}
		select {
		case <-request.Context().Done():
		case <-handlerRelease:
		}
	}))
	t.Cleanup(func() {
		close(handlerRelease)
		server.Close()
	})

	materializer := &speechExecutionHostMaterializerStub{
		endpoint:    server.URL,
		stopped:     make(chan struct{}),
		stopRelease: make(chan struct{}),
	}
	t.Cleanup(func() {
		select {
		case <-materializer.stopRelease:
		default:
			close(materializer.stopRelease)
		}
	})
	host := NewSpeechExecutionHost(materializer, 8330, 0)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := host.ExecuteSpeechTranscription(ctx, speechTranscriptionPlanForHostTest(t, "running-cancel"), nil)
		done <- err
	}()
	select {
	case <-requestEntered:
	case <-time.After(2 * time.Second):
		t.Fatal("transcription request did not reach Host")
	}
	cancel()
	select {
	case <-materializer.stopped:
	case err := <-done:
		t.Fatalf("canceled execution returned before supervised Host stop: %v", err)
	case <-time.After(2 * time.Second):
		t.Fatal("canceled execution did not stop supervised Host")
	}
	select {
	case err := <-done:
		t.Fatalf("canceled execution released lease before Host stop completed: %v", err)
	case <-time.After(100 * time.Millisecond):
	}
	close(materializer.stopRelease)
	select {
	case err := <-done:
		if localexecution.FailureKindOf(err) != localexecution.FailureCanceled {
			t.Fatalf("canceled execution error=%v kind=%q", err, localexecution.FailureKindOf(err))
		}
	case <-time.After(2 * time.Second):
		t.Fatal("canceled execution did not return after Host stop")
	}
}

func TestSpeechExecutionHostCancellationAfterMaterializationStopsHost(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	stopped := make(chan struct{})
	materializer := &speechExecutionHostMaterializerStub{
		endpoint:      "http://127.0.0.1:8330",
		onMaterialize: cancel,
		stopped:       stopped,
	}
	host := NewSpeechExecutionHost(materializer, 8330, 0)

	_, err := host.ExecuteSpeechTranscription(ctx, speechTranscriptionPlanForHostTest(t, "cancel-after-materialization"), nil)
	if localexecution.FailureKindOf(err) != localexecution.FailureCanceled {
		t.Fatalf("canceled execution error=%v kind=%q", err, localexecution.FailureKindOf(err))
	}
	select {
	case <-stopped:
	default:
		t.Fatal("cancellation observed after materialization did not stop supervised Host")
	}
}

func TestSpeechExecutionHostStopFailurePoisonsHostAndBlocksReplacementExecution(t *testing.T) {
	requestEntered := make(chan struct{})
	handlerRelease := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v1/audio/transcriptions" {
			writer.WriteHeader(http.StatusNotFound)
			return
		}
		select {
		case <-requestEntered:
		default:
			close(requestEntered)
		}
		select {
		case <-request.Context().Done():
		case <-handlerRelease:
		}
	}))
	t.Cleanup(func() {
		close(handlerRelease)
		server.Close()
	})

	materializer := &speechExecutionHostMaterializerStub{
		endpoint: server.URL,
		stopErr:  errors.New("supervisor stop failed"),
	}
	host := NewSpeechExecutionHost(materializer, 8330, 0)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := host.ExecuteSpeechTranscription(ctx, speechTranscriptionPlanForHostTest(t, "stop-failure"), nil)
		done <- err
	}()
	select {
	case <-requestEntered:
	case <-time.After(2 * time.Second):
		t.Fatal("transcription request did not reach Host")
	}
	cancel()
	select {
	case err := <-done:
		if localexecution.FailureKindOf(err) != localexecution.FailureProcessCrash {
			t.Fatalf("stop failure error=%v kind=%q", err, localexecution.FailureKindOf(err))
		}
	case <-time.After(2 * time.Second):
		t.Fatal("stop failure did not return")
	}

	_, err := host.ExecuteSpeechTranscription(context.Background(), speechTranscriptionPlanForHostTest(t, "poisoned"), nil)
	if localexecution.FailureKindOf(err) != localexecution.FailureProcessCrash {
		t.Fatalf("poisoned Host error=%v kind=%q", err, localexecution.FailureKindOf(err))
	}
	if got := len(materializer.capabilities); got != 1 {
		t.Fatalf("poisoned Host materialization calls=%d, want 1", got)
	}
}

func speechTranscriptionPlanForHostTest(t *testing.T, label string) *capabilitydriver.SpeechTranscribeInvocationPlan {
	t.Helper()
	digest := strings.Repeat("d", 64)
	plan, err := (capabilitydriver.Qwen3ASRDriver{}).PlanSpeechTranscribeInvocation(capabilitydriver.SpeechTranscribeInvocationInput{
		ExactBindings: []capabilitydriver.InvocationExactBinding{{
			RequirementID:     capabilitydriver.Qwen3ASRModelRequirementID,
			AssetID:           "local-import/Qwen3-ASR-0.6B-hf",
			LocalAssetID:      "asr-" + label,
			AbsolutePath:      filepath.Join(t.TempDir(), label+".safetensors"),
			VerifiedContentID: "sha256:" + digest,
			EntrySHA256:       digest,
		}},
		Request:    &runtimev1.SpeechTranscribeScenarioSpec{MimeType: "audio/wav", Language: "en"},
		AudioBytes: []byte("audio-" + label),
		MIMEType:   "audio/wav",
	})
	if err != nil {
		t.Fatalf("transcription plan %q: %v", label, err)
	}
	return plan
}

func speechSynthesisPlanForHostTest(t *testing.T, text string) *capabilitydriver.SpeechSynthesizeInvocationPlan {
	t.Helper()
	digest := strings.Repeat("d", 64)
	plan, err := (capabilitydriver.Qwen3TTSDriver{}).PlanSpeechSynthesizeInvocation(capabilitydriver.SpeechSynthesizeInvocationInput{
		ExactBindings: []capabilitydriver.InvocationExactBinding{{
			RequirementID:     capabilitydriver.Qwen3TTSModelRequirementID,
			AssetID:           "local-import/Qwen3-TTS-12Hz-0.6B-CustomVoice",
			LocalAssetID:      "tts-" + text,
			AbsolutePath:      filepath.Join(t.TempDir(), text+".safetensors"),
			VerifiedContentID: "sha256:" + digest,
			EntrySHA256:       digest,
		}},
		Request: &runtimev1.SpeechSynthesizeScenarioSpec{Text: text},
	})
	if err != nil {
		t.Fatalf("plan %q: %v", text, err)
	}
	return plan
}

func waitSpeechExecutionQueueLength(t *testing.T, host *SpeechExecutionHost, wanted int) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		host.lease.mu.Lock()
		length := len(host.lease.queue)
		host.lease.mu.Unlock()
		if length == wanted {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("speech Host queue did not reach length %d", wanted)
}

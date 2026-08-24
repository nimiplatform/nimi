package engine

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
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
	registrations  []SpeechExecutionModelRegistration
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

func (stub *speechExecutionHostMaterializerStub) RegisterSpeechExecutionModel(_ context.Context, _ string, registration SpeechExecutionModelRegistration) error {
	registration.DeclaredFiles = append([]string(nil), registration.DeclaredFiles...)
	stub.registrations = append(stub.registrations, registration)
	return nil
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

func TestSpeechExecutionHostPersistsRunningBeforeMaterialization(t *testing.T) {
	plan := speechSynthesisPlanForHostTest(t, "persist-running-first")
	materializer := &speechExecutionHostMaterializerStub{endpoint: "http://127.0.0.1:8330"}
	host := NewSpeechExecutionHost(materializer, 8330, 0)

	_, err := host.ExecuteSpeechSynthesis(context.Background(), plan, func() error {
		return errors.New("persist RUNNING")
	})
	if err == nil {
		t.Fatal("ExecuteSpeechSynthesis succeeded after RUNNING persistence failure")
	}
	if len(materializer.capabilities) != 0 || len(materializer.registrations) != 0 {
		t.Fatalf("RUNNING persistence failure produced materialization side effects: capabilities=%v registrations=%d", materializer.capabilities, len(materializer.registrations))
	}
}

func TestSpeechExecutionHostRejectsDeclaredBundleDriftBeforeMaterialization(t *testing.T) {
	binding := speechBindingFixture(t, "model.safetensors", map[string][]byte{
		"model.safetensors": []byte("captured-model"),
		"tokenizer.json":    []byte("captured-tokenizer"),
	})
	plan, err := (capabilitydriver.VoxCPMDriver{}).PlanSpeechSynthesizeInvocation(capabilitydriver.SpeechSynthesizeInvocationInput{
		ExactBindings: []capabilitydriver.InvocationExactBinding{binding},
		Request:       &runtimev1.SpeechSynthesizeScenarioSpec{Text: "bundle drift"},
	})
	if err != nil {
		t.Fatalf("plan VoxCPM synthesis: %v", err)
	}
	if err := os.WriteFile(filepath.Join(binding.BundleDir, "tokenizer.json"), []byte("mutated-tokenizer"), 0o600); err != nil {
		t.Fatalf("mutate declared tokenizer: %v", err)
	}
	materializer := &speechExecutionHostMaterializerStub{endpoint: "http://127.0.0.1:8330"}
	host := NewSpeechExecutionHost(materializer, 8330, 0)

	_, err = host.ExecuteSpeechSynthesis(context.Background(), plan, nil)
	if localexecution.FailureKindOf(err) != localexecution.FailureContentMismatch {
		t.Fatalf("bundle drift error=%v kind=%q, want content mismatch", err, localexecution.FailureKindOf(err))
	}
	if len(materializer.capabilities) != 0 || len(materializer.registrations) != 0 {
		t.Fatalf("bundle drift produced materialization side effects: capabilities=%v registrations=%d", materializer.capabilities, len(materializer.registrations))
	}
}

func TestSpeechExecutionHostRejectsMissingExactRegistrationBeforeMaterialization(t *testing.T) {
	binding := speechBindingFixture(t, "model.safetensors", map[string][]byte{"model.safetensors": []byte("captured-model")})
	binding.RequirementID = capabilitydriver.Qwen3TTSModelRequirementID
	binding.ModelAssetID = "model-asset/qwen3-tts"
	binding.BundleDir = ""
	binding.DeclaredFiles = nil
	plan, err := (capabilitydriver.Qwen3TTSDriver{}).PlanSpeechSynthesizeInvocation(capabilitydriver.SpeechSynthesizeInvocationInput{
		ExactBindings: []capabilitydriver.InvocationExactBinding{binding},
		Request:       &runtimev1.SpeechSynthesizeScenarioSpec{Text: "missing exact registration"},
	})
	if err != nil {
		t.Fatalf("plan synthesis: %v", err)
	}
	materializer := &speechExecutionHostMaterializerStub{endpoint: "http://127.0.0.1:8330"}
	host := NewSpeechExecutionHost(materializer, 8330, 0)

	_, err = host.ExecuteSpeechSynthesis(context.Background(), plan, nil)
	if localexecution.FailureKindOf(err) != localexecution.FailureLoad {
		t.Fatalf("missing registration error=%v kind=%q, want load failure", err, localexecution.FailureKindOf(err))
	}
	if len(materializer.capabilities) != 0 || len(materializer.registrations) != 0 {
		t.Fatalf("missing registration materialized Host: capabilities=%v registrations=%d", materializer.capabilities, len(materializer.registrations))
	}
}

func TestSpeechExecutionHostUsesExactPlanAssetIdentity(t *testing.T) {
	ttsHostModelID := "local-import/Qwen3-TTS-12Hz-0.6B-CustomVoice"
	asrHostModelID := "local-import/Qwen3-ASR-0.6B-hf"
	ttsBinding := speechBindingFixture(t, "tts.safetensors", map[string][]byte{
		"tts.safetensors": []byte("captured-tts-model"),
		"config.json":     []byte("captured-tts-config"),
	})
	ttsBinding.RequirementID = capabilitydriver.Qwen3TTSModelRequirementID
	ttsBinding.ModelAssetID = ttsHostModelID
	ttsPlan, err := (capabilitydriver.Qwen3TTSDriver{}).PlanSpeechSynthesizeInvocation(capabilitydriver.SpeechSynthesizeInvocationInput{
		ExactBindings: []capabilitydriver.InvocationExactBinding{ttsBinding},
		Request:       &runtimev1.SpeechSynthesizeScenarioSpec{Text: "hello"},
	})
	if err != nil {
		t.Fatal(err)
	}
	asrBinding := speechBindingFixture(t, "asr.safetensors", map[string][]byte{"asr.safetensors": []byte("captured-asr-model")})
	asrBinding.RequirementID = capabilitydriver.Qwen3ASRModelRequirementID
	asrBinding.ModelAssetID = asrHostModelID
	asrPlan, err := (capabilitydriver.Qwen3ASRDriver{}).PlanSpeechTranscribeInvocation(capabilitydriver.SpeechTranscribeInvocationInput{
		ExactBindings: []capabilitydriver.InvocationExactBinding{asrBinding},
		Request:       &runtimev1.SpeechTranscribeScenarioSpec{MimeType: "audio/wav", Language: "en"},
		AudioBytes:    []byte("audio-bytes"),
		MIMEType:      "audio/wav",
	})
	if err != nil {
		t.Fatal(err)
	}
	voiceHostModelID := "local-import/Qwen3-TTS-12Hz-0.6B-Base"
	voiceBinding := speechBindingFixture(t, "voice.safetensors", map[string][]byte{"voice.safetensors": []byte("captured-voice-model")})
	voiceBinding.RequirementID = capabilitydriver.Qwen3VoiceCreateModelRequirementID
	voiceBinding.ModelAssetID = voiceHostModelID
	voicePlan, err := (capabilitydriver.Qwen3VoiceCreateDriver{}).PlanVoiceCreateInvocation(capabilitydriver.VoiceCreateInvocationInput{
		ExactBindings:     []capabilitydriver.InvocationExactBinding{voiceBinding},
		SupportedFeatures: []string{"input.audio"},
		Request:           &runtimev1.VoiceCreateScenarioSpec{Source: &runtimev1.VoiceCreateScenarioSpec_ReferenceAudio{ReferenceAudio: &runtimev1.VoiceV2VInput{ReferenceAudioBytes: []byte("RIFF-reference"), ReferenceAudioMime: "audio/wav", Text: "hello"}}},
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
		case "/v1/voice/create":
			var payload map[string]any
			if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
				t.Errorf("decode voice.create payload: %v", err)
				writer.WriteHeader(http.StatusBadRequest)
				return
			}
			if payload["target_model_id"] != voiceHostModelID || payload["creation_source"] != "reference_audio" {
				t.Errorf("voice.create payload=%+v", payload)
			}
			writer.Header().Set("Content-Type", "application/json")
			_, _ = writer.Write([]byte(`{"voice_id":"opaque-local-voice","metadata":{"driver":"qwen3_tts"}}`))
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
	voiceResult, err := host.ExecuteVoiceCreate(context.Background(), voicePlan, nil)
	if err != nil || voiceResult.ProviderVoiceRef != "opaque-local-voice" || voiceResult.Metadata["driver"] != "qwen3_tts" {
		t.Fatalf("voice.create result=%+v error=%v", voiceResult, err)
	}
	if got, want := strings.Join(materializer.capabilities, ","), "audio.synthesize,audio.transcribe,voice.create"; got != want {
		t.Fatalf("materialized capabilities = %q, want %q", got, want)
	}
	if len(materializer.registrations) != 3 {
		t.Fatalf("speech model registrations = %d, want one exact registration per execution", len(materializer.registrations))
	}
	ttsRegistration := materializer.registrations[0]
	if ttsRegistration.CapabilityContract != capabilitydriver.AudioSynthesizeContract || ttsRegistration.DriverID != capabilitydriver.Qwen3TTSDriverID ||
		ttsRegistration.ModelAssetID != ttsHostModelID || ttsRegistration.BundleDir != ttsBinding.BundleDir || ttsRegistration.EntryPath != ttsBinding.AbsolutePath ||
		strings.Join(ttsRegistration.DeclaredFiles, ",") != "config.json,tts.safetensors" || ttsRegistration.VerifiedContentID != ttsBinding.VerifiedContentID || ttsRegistration.EntrySHA256 != ttsBinding.EntrySHA256 ||
		ttsRegistration.VoiceCreationSource != "" || ttsRegistration.WorkflowModelID != "" {
		t.Fatalf("TTS Loadout binding registration = %+v", ttsRegistration)
	}
	asrRegistration := materializer.registrations[1]
	if asrRegistration.CapabilityContract != capabilitydriver.AudioTranscribeContract || asrRegistration.DriverID != capabilitydriver.Qwen3ASRDriverID ||
		asrRegistration.ModelAssetID != asrHostModelID || asrRegistration.BundleDir != asrBinding.BundleDir || asrRegistration.EntryPath != asrBinding.AbsolutePath ||
		asrRegistration.VoiceCreationSource != "" || asrRegistration.WorkflowModelID != "" {
		t.Fatalf("ASR Loadout binding registration = %+v", asrRegistration)
	}
	voiceRegistration := materializer.registrations[2]
	if voiceRegistration.CapabilityContract != capabilitydriver.VoiceCreateContract || voiceRegistration.DriverID != capabilitydriver.Qwen3TTSDriverID ||
		voiceRegistration.ModelAssetID != voiceHostModelID || voiceRegistration.BundleDir != voiceBinding.BundleDir || voiceRegistration.EntryPath != voiceBinding.AbsolutePath ||
		voiceRegistration.VoiceCreationSource != "reference_audio" || voiceRegistration.WorkflowModelID != capabilitydriver.Qwen3VoiceCloneRecipeID {
		t.Fatalf("voice.create Loadout binding registration = %+v", voiceRegistration)
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
	modelID := "local-import/Qwen3-TTS-12Hz-0.6B-CustomVoice"
	binding := speechBindingFixture(t, "tts.safetensors", map[string][]byte{"tts.safetensors": []byte("captured-stream-model")})
	binding.RequirementID = capabilitydriver.Qwen3TTSModelRequirementID
	binding.ModelAssetID = modelID
	plan, err := (capabilitydriver.Qwen3TTSDriver{}).PlanSpeechSynthesizeInvocation(capabilitydriver.SpeechSynthesizeInvocationInput{
		ExactBindings: []capabilitydriver.InvocationExactBinding{binding},
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

func TestSpeechExecutionHostPublishesRunningBeforeMaterialization(t *testing.T) {
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
	if !started {
		t.Fatal("materialization began before the Job durably entered RUNNING")
	}
}

func TestSpeechExecutionHostReleasesLeaseWhenTTSResponseIsEstablished(t *testing.T) {
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

	secondDone := make(chan error, 1)
	go func() {
		result, secondErr := host.ExecuteSpeechTranscription(context.Background(), speechTranscriptionPlanForHostTest(t, "behind-slow-body"), nil)
		if secondErr == nil && result.Text != "unexpected" {
			secondErr = fmt.Errorf("second transcription text=%q", result.Text)
		}
		secondDone <- secondErr
	}()
	select {
	case <-transcriptionEntered:
	case <-time.After(2 * time.Second):
		t.Fatal("second request remained queued after the TTS response was established")
	}
	if err := <-secondDone; err != nil {
		t.Fatalf("second request while TTS body remained open: %v", err)
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

func TestSpeechExecutionHostCanceledTTSBodyDoesNotStopHost(t *testing.T) {
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

	materializer := &speechExecutionHostMaterializerStub{endpoint: server.URL, stopped: make(chan struct{})}
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

	cancel()
	select {
	case readErr := <-readDone:
		if readErr == nil {
			t.Fatal("canceled TTS body read returned nil error")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("canceled TTS body did not stop reading")
	}
	select {
	case <-materializer.stopped:
		t.Fatal("body transfer cancellation stopped the inference Host")
	default:
	}
	secondDone := make(chan error, 1)
	go func() {
		result, secondErr := host.ExecuteSpeechTranscription(context.Background(), speechTranscriptionPlanForHostTest(t, "after-cancel"), nil)
		if secondErr == nil && result.Text != "after-cancel" {
			secondErr = fmt.Errorf("second transcription text=%q", result.Text)
		}
		secondDone <- secondErr
	}()
	select {
	case <-transcriptionEntered:
	case <-time.After(2 * time.Second):
		t.Fatal("second request did not enter Host after canceled body transfer")
	}
	if err := <-secondDone; err != nil {
		t.Fatalf("second request after canceled TTS body: %v", err)
	}
	_ = first.AudioBody.Close()
}

func TestSpeechExecutionHostEarlyTTSBodyCloseDoesNotStopHost(t *testing.T) {
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

	materializer := &speechExecutionHostMaterializerStub{endpoint: server.URL, stopped: make(chan struct{})}
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

	if closeErr := first.AudioBody.Close(); closeErr != nil {
		t.Fatalf("early TTS body Close: %v", closeErr)
	}
	select {
	case <-materializer.stopped:
		t.Fatal("early TTS body Close stopped the inference Host")
	default:
	}
	secondDone := make(chan error, 1)
	go func() {
		result, secondErr := host.ExecuteSpeechTranscription(context.Background(), speechTranscriptionPlanForHostTest(t, "after-close"), nil)
		if secondErr == nil && result.Text != "after-close" {
			secondErr = fmt.Errorf("second transcription text=%q", result.Text)
		}
		secondDone <- secondErr
	}()
	select {
	case <-transcriptionEntered:
	case <-time.After(2 * time.Second):
		t.Fatal("second request did not enter Host after early body Close")
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

func TestSpeechExecutionHostTTSBodyCloseDoesNotInvokeHostStop(t *testing.T) {
	ttsHeaders := make(chan struct{})
	ttsHandlerRelease := make(chan struct{})
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
			writer.Header().Set("Content-Type", "application/json")
			_, _ = writer.Write([]byte(`{"text":"after-body-close"}`))
		default:
			writer.WriteHeader(http.StatusNotFound)
		}
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
	if closeErr := first.AudioBody.Close(); closeErr != nil {
		t.Fatalf("close TTS response body: %v", closeErr)
	}
	result, err := host.ExecuteSpeechTranscription(context.Background(), speechTranscriptionPlanForHostTest(t, "after-body-close"), nil)
	if err != nil || result.Text != "after-body-close" {
		t.Fatalf("request after TTS body Close: result=%+v error=%v", result, err)
	}
	if got := len(materializer.capabilities); got != 2 {
		t.Fatalf("Host materialization calls=%d, want 2", got)
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
	binding := speechBindingFixture(t, label+".safetensors", map[string][]byte{label + ".safetensors": []byte("captured-asr-" + label)})
	binding.RequirementID = capabilitydriver.Qwen3ASRModelRequirementID
	binding.ModelAssetID = "local-import/Qwen3-ASR-0.6B-hf"
	plan, err := (capabilitydriver.Qwen3ASRDriver{}).PlanSpeechTranscribeInvocation(capabilitydriver.SpeechTranscribeInvocationInput{
		ExactBindings: []capabilitydriver.InvocationExactBinding{binding},
		Request:       &runtimev1.SpeechTranscribeScenarioSpec{MimeType: "audio/wav", Language: "en"},
		AudioBytes:    []byte("audio-" + label),
		MIMEType:      "audio/wav",
	})
	if err != nil {
		t.Fatalf("transcription plan %q: %v", label, err)
	}
	return plan
}

func TestSpeechExecutionHostPersistsAudioCppReferenceVoiceExactly(t *testing.T) {
	var registration capabilitydriver.AudioCppSpeechRegistration
	for _, candidate := range capabilitydriver.AudioCppReferenceVoiceRegistrations() {
		if candidate.Family == "glm_tts" {
			registration = candidate
			break
		}
	}
	driverValue, reason := capabilitydriver.NewProductionRegistry().Resolve(capabilitydriver.VoiceCreateContract, registration.Identity)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		t.Fatal(reason)
	}
	driver := driverValue.(capabilitydriver.VoiceCreateInvocationDriver)
	binding := speechBindingFixture(t, "glm.gguf", map[string][]byte{"glm.gguf": []byte("captured-glm-gguf")})
	binding.RequirementID = capabilitydriver.AudioCppTTSModelRequirementID
	binding.ModelAssetID = "audio-cpp/glm"
	root := filepath.Join(t.TempDir(), "voices")
	providerRef := capabilitydriver.AudioCppReferenceVoicePrefix + "01HZZZZZZZZZZZZZZZZZZZZZZZ"
	wav := audioCppReferenceWAVForHostTest()
	plan, err := driver.PlanVoiceCreateInvocation(capabilitydriver.VoiceCreateInvocationInput{
		ExactBindings: []capabilitydriver.InvocationExactBinding{binding}, SupportedFeatures: []string{"input.audio"},
		Request:               &runtimev1.VoiceCreateScenarioSpec{Source: &runtimev1.VoiceCreateScenarioSpec_ReferenceAudio{ReferenceAudio: &runtimev1.VoiceV2VInput{ReferenceAudioBytes: wav, ReferenceAudioMime: "audio/wav", Text: "reference words"}}},
		AudioCppReferenceRoot: root, AudioCppProviderVoiceRef: providerRef,
	})
	if err != nil {
		t.Fatalf("reference plan: %v", err)
	}
	host := &SpeechExecutionHost{}
	started := false
	result, err := host.ExecuteVoiceCreate(context.Background(), plan, func() error { started = true; return nil })
	if err != nil || !started || result.ProviderVoiceRef != providerRef {
		t.Fatalf("reference result=%+v started=%v err=%v", result, started, err)
	}
	if result.Metadata["audio_cpp_family"] != "glm_tts" {
		t.Fatalf("audio_cpp_family=%v, want glm_tts", result.Metadata["audio_cpp_family"])
	}
	id := strings.TrimPrefix(providerRef, capabilitydriver.AudioCppReferenceVoicePrefix)
	stored, err := os.ReadFile(filepath.Join(root, id+".wav"))
	if err != nil || string(stored) != string(wav) {
		t.Fatalf("stored WAV=%d err=%v", len(stored), err)
	}
	if _, err := host.ExecuteVoiceCreate(context.Background(), plan, nil); err != nil {
		t.Fatalf("idempotent reference create: %v", err)
	}
}

func audioCppReferenceWAVForHostTest() []byte {
	value := make([]byte, 46)
	copy(value[:4], "RIFF")
	binary.LittleEndian.PutUint32(value[4:8], uint32(len(value)-8))
	copy(value[8:12], "WAVE")
	copy(value[12:16], "fmt ")
	binary.LittleEndian.PutUint32(value[16:20], 16)
	binary.LittleEndian.PutUint16(value[20:22], 1)
	binary.LittleEndian.PutUint16(value[22:24], 1)
	binary.LittleEndian.PutUint32(value[24:28], 16000)
	binary.LittleEndian.PutUint32(value[28:32], 32000)
	binary.LittleEndian.PutUint16(value[32:34], 2)
	binary.LittleEndian.PutUint16(value[34:36], 16)
	copy(value[36:40], "data")
	binary.LittleEndian.PutUint32(value[40:44], 2)
	return value
}

func speechBindingFixture(t *testing.T, entry string, files map[string][]byte) capabilitydriver.InvocationExactBinding {
	t.Helper()
	root := t.TempDir()
	declared := make([]string, 0, len(files))
	for name := range files {
		declared = append(declared, name)
	}
	slices.Sort(declared)
	contentHasher := sha256.New()
	entryDigest := ""
	for _, name := range declared {
		path := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			t.Fatalf("create speech fixture directory: %v", err)
		}
		payload := files[name]
		if err := os.WriteFile(path, payload, 0o600); err != nil {
			t.Fatalf("write speech fixture %q: %v", name, err)
		}
		digest := sha256.Sum256(payload)
		_, _ = contentHasher.Write(digest[:])
		if name == entry {
			entryDigest = hex.EncodeToString(digest[:])
		}
	}
	if entryDigest == "" {
		t.Fatalf("speech fixture entry %q is not declared", entry)
	}
	contentDigest := entryDigest
	if len(declared) > 1 {
		contentDigest = hex.EncodeToString(contentHasher.Sum(nil))
	}
	return capabilitydriver.InvocationExactBinding{
		RequirementID:     capabilitydriver.VoxCPMModelRequirementID,
		ModelAssetID:      "fixture/speech-model",
		AbsolutePath:      filepath.Join(root, filepath.FromSlash(entry)),
		BundleDir:         root,
		DeclaredFiles:     declared,
		VerifiedContentID: "sha256:" + contentDigest,
		EntrySHA256:       entryDigest,
	}
}

func speechSynthesisPlanForHostTest(t *testing.T, text string) *capabilitydriver.SpeechSynthesizeInvocationPlan {
	t.Helper()
	binding := speechBindingFixture(t, text+".safetensors", map[string][]byte{text + ".safetensors": []byte("captured-tts-" + text)})
	binding.RequirementID = capabilitydriver.Qwen3TTSModelRequirementID
	binding.ModelAssetID = "local-import/Qwen3-TTS-12Hz-0.6B-CustomVoice"
	plan, err := (capabilitydriver.Qwen3TTSDriver{}).PlanSpeechSynthesizeInvocation(capabilitydriver.SpeechSynthesizeInvocationInput{
		ExactBindings: []capabilitydriver.InvocationExactBinding{binding},
		Request:       &runtimev1.SpeechSynthesizeScenarioSpec{Text: text},
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

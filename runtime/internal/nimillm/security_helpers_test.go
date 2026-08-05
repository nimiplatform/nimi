package nimillm

import (
	"context"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func TestResolveVoiceWorkflowBaseURLRequiresExactTargetBaseURL(t *testing.T) {
	cfg := MediaAdapterConfig{BaseURL: "https://api.example.com/v1/"}
	if got := resolveVoiceWorkflowBaseURL("elevenlabs", cfg); got != "https://api.example.com/v1" {
		t.Fatalf("exact base URL = %q", got)
	}
	if got := resolveVoiceWorkflowBaseURL("elevenlabs", MediaAdapterConfig{}); got != "" {
		t.Fatalf("missing exact base URL fell back to %q", got)
	}
}

func TestVoiceWorkflowHeadersUseOnlyExactTargetConfiguration(t *testing.T) {
	cfg := MediaAdapterConfig{
		APIKey: "secret",
		Headers: map[string]string{
			"Authorization": "Exact connector header",
			"X-Trace-Id":    "trace-1",
		},
	}
	headers := voiceWorkflowHeaders("elevenlabs", cfg)
	if got := headers["Authorization"]; got != "Exact connector header" {
		t.Fatalf("exact connector header mismatch: %#v", headers)
	}
	if got := headers["X-Trace-Id"]; got != "trace-1" {
		t.Fatalf("exact trace header mismatch: %#v", headers)
	}
	if got := headers["xi-api-key"]; got != "secret" {
		t.Fatalf("provider auth header mismatch: %#v", headers)
	}
}

func TestExecuteAWSPollyTTSRequiresAPIKey(t *testing.T) {
	_, _, _, err := ExecuteAWSPollyTTS(context.Background(), MediaAdapterConfig{
		BaseURL: "https://example.com",
	}, newTTSSecurityJob("hello", "voice-1"), "aws_polly/polly-voice")
	if err == nil {
		t.Fatal("expected auth failure")
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED {
		t.Fatalf("unexpected reason: ok=%v reason=%v err=%v", ok, reason, err)
	}
}

func TestExecuteElevenLabsTTSEscapesVoiceID(t *testing.T) {
	var escapedPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		escapedPath = r.URL.EscapedPath()
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write([]byte("audio"))
	}))
	defer func() { server.Close() }()

	_, _, _, err := ExecuteElevenLabsTTS(context.Background(), MediaAdapterConfig{
		BaseURL:               server.URL,
		AllowLoopbackEndpoint: true,
		APIKey:                "test-key",
	}, newTTSSecurityJob("hello", "voice/id with space"), "elevenlabs/native")
	if err != nil {
		t.Fatalf("ExecuteElevenLabsTTS: %v", err)
	}
	if got, want := escapedPath, "/v1/text-to-speech/voice%2Fid%20with%20space"; got != want {
		t.Fatalf("escaped path mismatch: got=%q want=%q", got, want)
	}
}

func TestIsContentFilterMessageRequiresSpecificPatterns(t *testing.T) {
	if !IsContentFilterMessage("request blocked by safety policy") {
		t.Fatal("expected specific safety-policy message to match")
	}
	if IsContentFilterMessage("safety review pending") {
		t.Fatal("generic safety wording should not match")
	}
	if IsContentFilterMessage("request blocked in queue") {
		t.Fatal("generic blocked wording should not match")
	}
}

func TestDoJSONOrBinaryRequestRejectsLoopbackWithoutExplicitOptIn(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write(make([]byte, maxJSONOrBinaryResponseBytes+1))
	}))
	defer func() { server.Close() }()

	_, err := DoJSONOrBinaryRequest(context.Background(), http.MethodPost, server.URL, "", map[string]any{"ok": true}, nil)
	if err == nil {
		t.Fatal("expected loopback without explicit opt-in to fail")
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN {
		t.Fatalf("unexpected reason: ok=%v reason=%v err=%v", ok, reason, err)
	}
}

func TestApplyProviderRequestHeadersRejectsSensitiveOverrides(t *testing.T) {
	request, err := http.NewRequest(http.MethodPost, "https://example.com", nil)
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}
	applyProviderRequestHeaders(request, map[string]string{
		"Authorization": "Bearer injected",
		"Host":          "evil.example.com",
		"X-Trace-Id":    "trace-1",
	})
	request.Header.Set("Authorization", "Bearer real-key")

	if got := request.Header.Get("Authorization"); got != "Bearer real-key" {
		t.Fatalf("unexpected Authorization header: %q", got)
	}
	if got := request.Header.Get("X-Trace-Id"); got != "trace-1" {
		t.Fatalf("unexpected X-Trace-Id header: %q", got)
	}
	if got := request.Header.Get("Host"); got != "" {
		t.Fatalf("host header should be filtered, got %q", got)
	}
}

func TestDecodeBase64ArtifactPayloadSupportsRawAndURLSafeVariants(t *testing.T) {
	payload := []byte("hello-audio")
	for _, encoded := range []string{
		base64.RawStdEncoding.EncodeToString(payload),
		base64.RawURLEncoding.EncodeToString(payload),
	} {
		decoded, ok := DecodeBase64ArtifactPayload(encoded)
		if !ok || string(decoded) != string(payload) {
			t.Fatalf("expected decode success for %q", encoded)
		}
	}
}

func TestExtractBinaryArtifactBytesAndMIMEDecodesURLSafeBase64(t *testing.T) {
	payload := []byte("artifact")
	decoded, _, _ := ExtractBinaryArtifactBytesAndMIME(context.Background(), map[string]any{
		"audio_base64": base64.RawURLEncoding.EncodeToString(payload),
	})
	if string(decoded) != "artifact" {
		t.Fatalf("decoded artifact mismatch: %q", string(decoded))
	}
}

func TestFetchBinaryArtifactRejectsLoopbackWithoutExplicitOptIn(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(make([]byte, maxDecodedMediaURLBytes+1))
	}))
	defer func() { server.Close() }()

	_, _, err := fetchBinaryArtifact(context.Background(), server.URL)
	if err == nil {
		t.Fatal("expected loopback artifact fetch without explicit opt-in to fail")
	}
}

func TestExtractBinaryArtifactBytesAndMIMEHonorsCanceledContext(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write([]byte("detached fetch would succeed"))
	}))
	defer func() { server.Close() }()

	ctx, cancel := context.WithCancel(loopbackProviderTestContext(context.Background()))
	cancel()

	artifactBytes, _, _ := ExtractBinaryArtifactBytesAndMIME(ctx, map[string]any{
		"url": server.URL,
	})
	if len(artifactBytes) != 0 {
		t.Fatalf("expected canceled context to prevent artifact fetch, got %q", string(artifactBytes))
	}
}

func TestFetchAudioFromURIRejectsLoopbackWithoutExplicitOptIn(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "audio/wav")
		_, _ = w.Write(make([]byte, maxDecodedMediaURLBytes+1))
	}))
	defer func() { server.Close() }()

	_, _, err := FetchAudioFromURI(context.Background(), server.URL)
	if err == nil {
		t.Fatal("expected loopback audio fetch without explicit opt-in to fail")
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN {
		t.Fatalf("unexpected reason: ok=%v reason=%v err=%v", ok, reason, err)
	}
}

func TestFetchAudioFromURIRejectsNonHTTPSchemes(t *testing.T) {
	_, _, err := FetchAudioFromURI(context.Background(), "ftp://example.com/audio.wav")
	if err == nil {
		t.Fatal("expected invalid scheme to fail")
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_INPUT_INVALID {
		t.Fatalf("unexpected reason: ok=%v reason=%v err=%v", ok, reason, err)
	}
}

func TestIsAsyncTaskPendingStatusUsesNormalizedStatus(t *testing.T) {
	if !IsAsyncTaskPendingStatus(ResolveAsyncTaskStatus(map[string]any{"status": " Pending "})) {
		t.Fatal("normalized pending status should match")
	}
	if IsAsyncTaskPendingStatus(" Pending ") {
		t.Fatal("unnormalized status should not be re-normalized here")
	}
	if IsAsyncTaskPendingStatus("") {
		t.Fatal("empty status should not be treated as pending")
	}
}

func TestExtractTaskIDFromAdapterPayloadUsesAdapterSpecificPaths(t *testing.T) {
	testCases := []struct {
		name    string
		adapter string
		payload map[string]any
		want    string
	}{
		{
			name:    "dashscope async task uses output task id",
			adapter: AdapterAlibabaNative,
			payload: map[string]any{"output": map[string]any{"task_id": "dash-1"}, "id": "wrong"},
			want:    "dash-1",
		},
		{
			name:    "google veo uses operation name",
			adapter: AdapterGoogleVeoOperation,
			payload: map[string]any{"name": "operations/veo-1", "task_id": "wrong"},
			want:    "operations/veo-1",
		},
		{
			name:    "runway uses top level id only",
			adapter: AdapterRunwayTask,
			payload: map[string]any{"id": "runway-1", "output": map[string]any{"task_id": "wrong"}},
			want:    "runway-1",
		},
		{
			name:    "bytedance uses data task id",
			adapter: AdapterBytedanceARKTask,
			payload: map[string]any{"data": map[string]any{"task_id": "ark-1"}, "id": "wrong"},
			want:    "ark-1",
		},
		{
			name:    "elevenlabs voice uses job id",
			adapter: "voice:elevenlabs",
			payload: map[string]any{"job_id": "el-1", "output": map[string]any{"task_id": "wrong"}},
			want:    "el-1",
		},
		{
			name:    "unknown adapter does not guess",
			adapter: "unknown",
			payload: map[string]any{"task_id": "wrong"},
			want:    "",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			if got := ExtractTaskIDFromAdapterPayload(tc.adapter, tc.payload); got != tc.want {
				t.Fatalf("ExtractTaskIDFromAdapterPayload(%q) = %q, want %q", tc.adapter, got, tc.want)
			}
		})
	}
}

func TestValueAsPositiveInt32RejectsNegativeValues(t *testing.T) {
	if got := ValueAsPositiveInt32(-5); got != 0 {
		t.Fatalf("negative values should clamp to 0, got %d", got)
	}
	if got := ValueAsInt32("12"); got != 12 {
		t.Fatalf("ValueAsInt32 should parse full int32 values, got %d", got)
	}
	if got := ValueAsInt32(-5); got != -5 {
		t.Fatalf("ValueAsInt32 should preserve negative values in range, got %d", got)
	}
}

func TestExecuteBytedanceOpenSpeechRejectsOversizedInlineAudio(t *testing.T) {
	audio := make([]byte, bytedanceOpenSpeechMaxInlineAudioBytes+1)
	_, _, _, err := ExecuteBytedanceOpenSpeech(context.Background(), MediaAdapterConfig{
		BaseURL: "https://example.com",
		APIKey:  "key",
	}, &runtimev1.SubmitScenarioJobRequest{
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_SpeechTranscribe{
				SpeechTranscribe: &runtimev1.SpeechTranscribeScenarioSpec{
					AudioSource: &runtimev1.SpeechTranscriptionAudioSource{
						Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{
							AudioBytes: audio,
						},
					},
				},
			},
		},
	}, "bytedance/model")
	if err == nil {
		t.Fatal("expected oversized audio to fail")
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_INPUT_INVALID {
		t.Fatalf("unexpected reason: ok=%v reason=%v err=%v", ok, reason, err)
	}
}

func TestResolveBytedanceOpenSpeechWSReadTimeoutClampsToMaximum(t *testing.T) {
	got := resolveBytedanceOpenSpeechWSReadTimeout(map[string]any{
		"ws_read_timeout_ms": int64((90 * time.Second) / time.Millisecond),
	})
	if got != bytedanceOpenSpeechMaxWSReadTimeout {
		t.Fatalf("expected clamp to %v, got %v", bytedanceOpenSpeechMaxWSReadTimeout, got)
	}
}

func TestResolveBytedanceOpenSpeechWSURLUsesExactTargetOriginAndAdapterPath(t *testing.T) {
	got := resolveBytedanceOpenSpeechWSURL("https://openspeech.example.com/api/v1")
	if got != "wss://openspeech.example.com/api/v3/auc/bigmodel/recognize/stream" {
		t.Fatalf("adapter-owned websocket URL = %q", got)
	}
}

func TestValidateBytedanceOpenSpeechWSURLRejectsPlaintextPublicEndpoint(t *testing.T) {
	err := validateBytedanceOpenSpeechWSURL(context.Background(), "ws://openspeech.example.com/api/v3/auc/bigmodel/recognize/stream")
	if err == nil {
		t.Fatal("expected plaintext public websocket endpoint to fail closed")
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN {
		t.Fatalf("unexpected reason: ok=%v reason=%v err=%v", ok, reason, err)
	}
}

func TestExtractSpeechArtifactFromResponseBodyRejectsTextOnlyJSON(t *testing.T) {
	artifactBytes, mimeType := ExtractSpeechArtifactFromResponseBody(context.Background(), &JSONOrBinaryBody{
		Bytes: []byte(`{"text":"not-audio"}`),
		Text:  "not-audio",
		MIME:  "application/json",
	})
	if len(artifactBytes) != 0 {
		t.Fatalf("expected no artifact bytes, got %q", string(artifactBytes))
	}
	if mimeType != "" {
		t.Fatalf("expected empty mime type when response is text only, got %q", mimeType)
	}
}

func newTTSSecurityJob(text, voiceRef string) *runtimev1.SubmitScenarioJobRequest {
	return &runtimev1.SubmitScenarioJobRequest{
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
				SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{
					Text: text,
					VoiceRef: &runtimev1.VoiceReference{
						Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF,
						Reference: &runtimev1.VoiceReference_ProviderVoiceRef{
							ProviderVoiceRef: strings.TrimSpace(voiceRef),
						},
					},
				},
			},
		},
		Head: &runtimev1.ScenarioRequestHead{
			TimeoutMs: 1000,
		},
	}
}

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

func TestResolveVoiceWorkflowBaseURLRejectsForeignAndPathOverride(t *testing.T) {
	cfg := MediaAdapterConfig{BaseURL: "https://api.example.com/v1"}

	got := resolveVoiceWorkflowBaseURL("elevenlabs", cfg, map[string]any{
		"base_url": "https://evil.example.com/voice",
	})
	if got != "https://api.example.com/v1" {
		t.Fatalf("foreign override should fall back to config base URL, got %q", got)
	}

	got = resolveVoiceWorkflowBaseURL("elevenlabs", cfg, map[string]any{
		"base_url": "https://api.example.com/custom",
	})
	if got != "https://api.example.com/v1" {
		t.Fatalf("same-origin path override should fall back to config base URL, got %q", got)
	}

	got = resolveVoiceWorkflowBaseURL("elevenlabs", cfg, map[string]any{
		"base_url": "https://api.example.com/v1/",
	})
	if got != "https://api.example.com/v1" {
		t.Fatalf("same base URL should still be allowed, got %q", got)
	}
}

func TestVoiceWorkflowHeadersAllowOnlySafeCustomHeaders(t *testing.T) {
	headers := voiceWorkflowHeaders("elevenlabs", "secret", map[string]any{
		"headers": map[string]any{
			"Authorization": "Bearer injected",
			"Host":          "evil.example.com",
			"X-Trace-Id":    "trace-1",
		},
		"api_key_header": "x-api-key",
	})

	if _, exists := headers["Authorization"]; exists {
		t.Fatalf("authorization header should be filtered: %#v", headers)
	}
	if _, exists := headers["Host"]; exists {
		t.Fatalf("host header should be filtered: %#v", headers)
	}
	if got := headers["X-Trace-Id"]; got != "trace-1" {
		t.Fatalf("custom x-* header mismatch: %#v", headers)
	}
	if got := headers["x-api-key"]; got != "secret" {
		t.Fatalf("api key header mismatch: %#v", headers)
	}
}

func TestVoiceWorkflowHeadersRejectUnsafeAPIKeyHeaderOverride(t *testing.T) {
	headers := voiceWorkflowHeaders("elevenlabs", "secret", map[string]any{
		"api_key_header": "Authorization",
	})
	if _, exists := headers["Authorization"]; exists {
		t.Fatalf("unsafe api key header should be rejected: %#v", headers)
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
	defer server.Close()

	_, _, _, err := ExecuteElevenLabsTTS(context.Background(), MediaAdapterConfig{
		BaseURL: server.URL,
		APIKey:  "test-key",
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

func TestDoJSONOrBinaryRequestRejectsOversizedBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write(make([]byte, maxJSONOrBinaryResponseBytes+1))
	}))
	defer server.Close()

	_, err := DoJSONOrBinaryRequest(context.Background(), http.MethodPost, server.URL, "", map[string]any{"ok": true}, nil)
	if err == nil {
		t.Fatal("expected oversized body to fail")
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
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
	decoded, _, _ := ExtractBinaryArtifactBytesAndMIME(map[string]any{
		"audio_base64": base64.RawURLEncoding.EncodeToString(payload),
	})
	if string(decoded) != "artifact" {
		t.Fatalf("decoded artifact mismatch: %q", string(decoded))
	}
}

func TestFetchBinaryArtifactRejectsOversizedResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(make([]byte, maxDecodedMediaURLBytes+1))
	}))
	defer server.Close()

	_, _, err := fetchBinaryArtifact(context.Background(), server.URL)
	if err == nil {
		t.Fatal("expected oversized artifact fetch to fail")
	}
}

func TestFetchAudioFromURIRejectsOversizedResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "audio/wav")
		_, _ = w.Write(make([]byte, maxDecodedMediaURLBytes+1))
	}))
	defer server.Close()

	_, _, err := FetchAudioFromURI(context.Background(), server.URL)
	if err == nil {
		t.Fatal("expected oversized audio fetch to fail")
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
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

func TestExtractSpeechArtifactFromResponseBodyRejectsTextOnlyJSON(t *testing.T) {
	artifactBytes, mimeType := ExtractSpeechArtifactFromResponseBody(&JSONOrBinaryBody{
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
			ModelId:   "test-model",
			TimeoutMs: 1000,
		},
	}
}

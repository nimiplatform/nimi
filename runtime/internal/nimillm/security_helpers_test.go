package nimillm

import (
	"context"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func TestResolveVoiceWorkflowBaseURLRejectsForeignOverride(t *testing.T) {
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
	if got != "https://api.example.com/custom" {
		t.Fatalf("same-origin override should be allowed, got %q", got)
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

func TestIsAsyncTaskPendingStatusUsesNormalizedStatus(t *testing.T) {
	if !IsAsyncTaskPendingStatus(ResolveAsyncTaskStatus(map[string]any{"status": " Pending "})) {
		t.Fatal("normalized pending status should match")
	}
	if IsAsyncTaskPendingStatus(" Pending ") {
		t.Fatal("unnormalized status should not be re-normalized here")
	}
}

func TestValueAsPositiveInt32RejectsNegativeValues(t *testing.T) {
	if got := ValueAsPositiveInt32(-5); got != 0 {
		t.Fatalf("negative values should clamp to 0, got %d", got)
	}
	if got := ValueAsInt32("12"); got != 12 {
		t.Fatalf("ValueAsInt32 should delegate to positive conversion, got %d", got)
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

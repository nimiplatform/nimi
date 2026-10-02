package nimillm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func TestDeleteProviderVoiceDashScopeDialects(t *testing.T) {
	for _, tc := range []struct{ adapter, model, action, field, response string }{
		{"dashscope_voice_delete_adapter", "voice-enrollment", "delete_voice", "voice_id", `{"request_id":"request-1","output":{}}`},
		{"dashscope_qwen_clone_voice_delete_adapter", "qwen-voice-enrollment", "delete", "voice", `{"request_id":"request-1","output":{"voice":"opaque-voice"}}`},
		{"dashscope_qwen_design_voice_delete_adapter", "qwen-voice-design", "delete", "voice", `{"request_id":"request-1","output":{"voice":"opaque-voice"}}`},
	} {
		t.Run(tc.model, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
					return
				}
				input, _ := body["input"].(map[string]any)
				if r.Method != http.MethodPost || r.URL.Path != "/api/v1/services/audio/tts/customization" || r.Header.Get("Authorization") != "Bearer test-key" ||
					body["model"] != tc.model || len(body) != 2 || len(input) != 2 || input["action"] != tc.action || input[tc.field] != "opaque-voice" {
					t.Errorf("wrong delete wire: %s %s %+v", r.Method, r.URL.Path, body)
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(tc.response))
			}))
			defer server.Close()
			err := DeleteProviderVoiceAdapter(context.Background(), tc.adapter, "dashscope", "opaque-voice", MediaAdapterConfig{BaseURL: server.URL + "/compatible-mode/v1", APIKey: "test-key", AllowLoopbackEndpoint: true})
			if err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestDeleteProviderVoiceDashScopeRejectsUnconfirmedDeletion(t *testing.T) {
	for _, body := range []string{`{}`, `{"request_id":"r","output":null}`, `{"request_id":"r","output":{"voice":"another-voice"}}`, `{"output":{"voice":"opaque-voice"}}`, `{"request_id":"r","output":{"voice":"opaque-voice"},"code":"failure"}`} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(body))
		}))
		err := DeleteProviderVoiceAdapter(context.Background(), "dashscope_qwen_design_voice_delete_adapter", "dashscope", "opaque-voice", MediaAdapterConfig{BaseURL: server.URL, APIKey: "test-key", AllowLoopbackEndpoint: true})
		server.Close()
		if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
			t.Fatalf("unconfirmed deletion admitted: body=%s err=%v", body, err)
		}
	}
}

func TestDashScopeVoiceDesignMissingPreviewNeverDispatches(t *testing.T) {
	for _, model := range []string{"qwen-voice-design", "voice-enrollment-design"} {
		calls := 0
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { calls++ }))
		_, err := executeDashScopeVoiceWorkflow(context.Background(), VoiceWorkflowRequest{
			WorkflowType: "text_description", WorkflowModelID: model, ModelID: "qwen3-tts-vd-2026-01-26",
			Payload: map[string]any{"instruction_text": "A calm adult narrator."},
		}, MediaAdapterConfig{BaseURL: server.URL, AllowLoopbackEndpoint: true, APIKey: "test-key"})
		server.Close()
		if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID || calls != 0 {
			t.Fatalf("missing preview was fabricated: workflow=%s calls=%d err=%v", model, calls, err)
		}
	}
}

func TestDeleteProviderVoice_ElevenLabs(t *testing.T) {
	var (
		gotMethod string
		gotPath   string
		gotAPIKey string
	)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		gotMethod = request.Method
		gotPath = request.URL.Path
		gotAPIKey = request.Header.Get("xi-api-key")
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer func() { server.Close() }()

	err := DeleteProviderVoiceAdapter(context.Background(), "elevenlabs_voice_delete_adapter", "elevenlabs", "voice_123", MediaAdapterConfig{
		BaseURL:               server.URL,
		AllowLoopbackEndpoint: true,
		APIKey:                "test-key",
	})
	if err != nil {
		t.Fatalf("DeleteProviderVoice: %v", err)
	}
	if gotMethod != http.MethodDelete {
		t.Fatalf("unexpected method: %q", gotMethod)
	}
	if gotPath != "/v1/voices/voice_123" {
		t.Fatalf("unexpected path: %q", gotPath)
	}
	if gotAPIKey != "test-key" {
		t.Fatalf("unexpected xi-api-key: %q", gotAPIKey)
	}
}

func TestDeleteProviderVoice_ElevenLabsNotFoundIsIgnored(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		writer.WriteHeader(http.StatusNotFound)
		_, _ = writer.Write([]byte(`{"detail":{"message":"voice not found"}}`))
	}))
	defer func() { server.Close() }()

	err := DeleteProviderVoiceAdapter(context.Background(), "elevenlabs_voice_delete_adapter", "elevenlabs", "voice_missing", MediaAdapterConfig{
		BaseURL:               server.URL,
		AllowLoopbackEndpoint: true,
		APIKey:                "test-key",
	})
	if err != nil {
		t.Fatalf("DeleteProviderVoice notfound should be ignored: %v", err)
	}
}

func TestDeleteProviderVoice_FishAudio(t *testing.T) {
	var (
		gotMethod string
		gotPath   string
		gotAuth   string
	)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		gotMethod = request.Method
		gotPath = request.URL.Path
		gotAuth = request.Header.Get("Authorization")
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer func() { server.Close() }()

	err := DeleteProviderVoiceAdapter(context.Background(), "fish_audio_voice_delete_adapter", "fish_audio", "model_123", MediaAdapterConfig{
		BaseURL:               server.URL,
		AllowLoopbackEndpoint: true,
		APIKey:                "test-key",
	})
	if err != nil {
		t.Fatalf("DeleteProviderVoice(fish_audio): %v", err)
	}
	if gotMethod != http.MethodDelete {
		t.Fatalf("unexpected method: %q", gotMethod)
	}
	if gotPath != "/model/model_123" {
		t.Fatalf("unexpected path: %q", gotPath)
	}
	if gotAuth != "Bearer test-key" {
		t.Fatalf("unexpected Authorization header: %q", gotAuth)
	}
}

func TestDeleteProviderVoice_FishAudioNotFoundIsIgnored(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		writer.WriteHeader(http.StatusNotFound)
		_, _ = writer.Write([]byte(`{"message":"model not found"}`))
	}))
	defer func() { server.Close() }()

	err := DeleteProviderVoiceAdapter(context.Background(), "fish_audio_voice_delete_adapter", "fish_audio", "model_missing", MediaAdapterConfig{
		BaseURL:               server.URL,
		AllowLoopbackEndpoint: true,
		APIKey:                "test-key",
	})
	if err != nil {
		t.Fatalf("DeleteProviderVoice fish_audio notfound should be ignored: %v", err)
	}
}

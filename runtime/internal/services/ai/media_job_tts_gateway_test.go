package ai

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"google.golang.org/genproto/googleapis/rpc/errdetails"
	"google.golang.org/grpc/status"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

func buildConnectorTTSRequest(modelID string, voice string) *runtimev1.SubmitMediaJobRequest {
	return &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       modelID,
		ConnectorId:   "connector-tts",
		Modal:         runtimev1.Modal_MODAL_TTS,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_SpeechSpec{
			SpeechSpec: &runtimev1.SpeechSynthesisSpec{
				Text:        "hello",
				Voice:       voice,
				AudioFormat: "mp3",
			},
		},
	}
}

func buildConnectorCloudProvider(baseURL string) *nimillm.CloudProvider {
	return nimillm.NewCloudProvider(nimillm.CloudConfig{
		Providers: map[string]nimillm.ProviderCredentials{
			"dashscope": {
				BaseURL: baseURL,
				APIKey:  "test-api-key",
			},
		},
	}, nil, nil)
}

func extractErrorMetadata(err error) map[string]string {
	st, ok := status.FromError(err)
	if !ok {
		return nil
	}
	for _, detail := range st.Details() {
		info, ok := detail.(*errdetails.ErrorInfo)
		if !ok {
			continue
		}
		return info.GetMetadata()
	}
	return nil
}

func TestExecuteBackendSyncMediaTTSGatewayModelNotFound(t *testing.T) {
	var ttsCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/v1/models":
			_, _ = io.WriteString(w, `{"data":[{"id":"deepseek-chat"}]}`)
		case r.Method == http.MethodPost && r.URL.Path == "/v1/audio/speech":
			ttsCalls.Add(1)
			w.WriteHeader(http.StatusInternalServerError)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	_, _, _, err := executeBackendSyncMedia(
		context.Background(),
		nil,
		buildConnectorTTSRequest("cloud/qwen-tts-2025-05-22", "alloy"),
		nil,
		"cloud/qwen-tts-2025-05-22",
		adapterOpenAICompat,
		&nimillm.RemoteTarget{
			ProviderType: "dashscope",
			Endpoint:     server.URL,
			APIKey:       "test-api-key",
		},
		buildConnectorCloudProvider(server.URL),
	)
	if err == nil {
		t.Fatal("expected model-not-found error")
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_MODEL_NOT_FOUND {
		t.Fatalf("expected AI_MODEL_NOT_FOUND, got %v (ok=%v)", reason, ok)
	}
	metadata := extractErrorMetadata(err)
	if metadata["action_hint"] != "switch_tts_model_or_refresh_connector_models" {
		t.Fatalf("unexpected action_hint: %q", metadata["action_hint"])
	}
	if ttsCalls.Load() != 0 {
		t.Fatalf("tts provider should not be called when model is not listed, calls=%d", ttsCalls.Load())
	}
}

func TestExecuteBackendSyncMediaTTSGatewayModalityNotSupported(t *testing.T) {
	var ttsCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/v1/models":
			_, _ = io.WriteString(w, `{"data":[{"id":"deepseek-chat"}]}`)
		case r.Method == http.MethodPost && r.URL.Path == "/v1/audio/speech":
			ttsCalls.Add(1)
			w.WriteHeader(http.StatusInternalServerError)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	_, _, _, err := executeBackendSyncMedia(
		context.Background(),
		nil,
		buildConnectorTTSRequest("cloud/deepseek-chat", "alloy"),
		nil,
		"cloud/deepseek-chat",
		adapterOpenAICompat,
		&nimillm.RemoteTarget{
			ProviderType: "dashscope",
			Endpoint:     server.URL,
			APIKey:       "test-api-key",
		},
		buildConnectorCloudProvider(server.URL),
	)
	if err == nil {
		t.Fatal("expected modality-not-supported error")
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED {
		t.Fatalf("expected AI_MODALITY_NOT_SUPPORTED, got %v (ok=%v)", reason, ok)
	}
	metadata := extractErrorMetadata(err)
	if metadata["action_hint"] != "select_model_with_audio_synthesize_capability" {
		t.Fatalf("unexpected action_hint: %q", metadata["action_hint"])
	}
	if ttsCalls.Load() != 0 {
		t.Fatalf("tts provider should not be called when modality is unsupported, calls=%d", ttsCalls.Load())
	}
}

func TestExecuteBackendSyncMediaTTSGatewayPassesValidModel(t *testing.T) {
	var ttsCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/v1/models":
			_, _ = io.WriteString(w, `{"data":[{"id":"qwen-tts-2025-05-22"}]}`)
		case r.Method == http.MethodPost && r.URL.Path == "/v1/audio/speech":
			ttsCalls.Add(1)
			w.Header().Set("Content-Type", "audio/mpeg")
			_, _ = w.Write([]byte("tts-audio"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	artifacts, _, _, err := executeBackendSyncMedia(
		context.Background(),
		nil,
		buildConnectorTTSRequest("cloud/qwen-tts-2025-05-22", "Cherry"),
		nil,
		"cloud/qwen-tts-2025-05-22",
		adapterOpenAICompat,
		&nimillm.RemoteTarget{
			ProviderType: "dashscope",
			Endpoint:     server.URL,
			APIKey:       "test-api-key",
		},
		buildConnectorCloudProvider(server.URL),
	)
	if err != nil {
		t.Fatalf("expected successful tts synthesis, got error: %v", err)
	}
	if len(artifacts) != 1 {
		t.Fatalf("expected one artifact, got %d", len(artifacts))
	}
	if got := string(artifacts[0].GetBytes()); got != "tts-audio" {
		t.Fatalf("tts audio mismatch: got=%q", got)
	}
	if ttsCalls.Load() != 1 {
		t.Fatalf("expected one tts provider call, got %d", ttsCalls.Load())
	}
}

func TestExecuteBackendSyncMediaTTSGatewayRejectsUnsupportedVoice(t *testing.T) {
	var ttsCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/v1/models":
			_, _ = io.WriteString(w, `{"data":[{"id":"qwen-tts-2025-05-22"}]}`)
		case r.Method == http.MethodPost && r.URL.Path == "/v1/audio/speech":
			ttsCalls.Add(1)
			w.Header().Set("Content-Type", "audio/mpeg")
			_, _ = w.Write([]byte("tts-audio"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	_, _, _, err := executeBackendSyncMedia(
		context.Background(),
		nil,
		buildConnectorTTSRequest("cloud/qwen-tts-2025-05-22", "alloy"),
		nil,
		"cloud/qwen-tts-2025-05-22",
		adapterOpenAICompat,
		&nimillm.RemoteTarget{
			ProviderType: "dashscope",
			Endpoint:     server.URL,
			APIKey:       "test-api-key",
		},
		buildConnectorCloudProvider(server.URL),
	)
	if err == nil {
		t.Fatal("expected unsupported voice preflight error")
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
		t.Fatalf("expected AI_MEDIA_OPTION_UNSUPPORTED, got %v (ok=%v)", reason, ok)
	}
	metadata := extractErrorMetadata(err)
	if metadata["action_hint"] != "adjust_tts_voice_or_audio_options" {
		t.Fatalf("unexpected action_hint: %q", metadata["action_hint"])
	}
	if ttsCalls.Load() != 0 {
		t.Fatalf("tts provider should not be called when voice is unsupported, calls=%d", ttsCalls.Load())
	}
}

func TestValidateConnectorTTSModelSupportNoConnectorSkipsGateway(t *testing.T) {
	err := validateConnectorTTSModelSupport(
		context.Background(),
		nil,
		&runtimev1.SubmitMediaJobRequest{
			ModelId: "cloud/qwen-tts-2025-05-22",
			Modal:   runtimev1.Modal_MODAL_TTS,
			Spec: &runtimev1.SubmitMediaJobRequest_SpeechSpec{
				SpeechSpec: &runtimev1.SpeechSynthesisSpec{Text: "hello"},
			},
		},
		"qwen-tts-2025-05-22",
		nil,
		nil,
	)
	if err != nil {
		t.Fatalf("expected gateway skip for non-connector request, got: %v", err)
	}
}

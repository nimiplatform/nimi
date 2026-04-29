package ai

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

func TestIsSpeechVoiceSupported(t *testing.T) {
	voices := []*runtimev1.VoicePresetDescriptor{
		{VoiceId: "alloy"},
		{VoiceId: "nova"},
	}
	if !isSpeechVoiceSupported("", voices) {
		t.Fatalf("empty requested voice should be treated as supported")
	}
	if !isSpeechVoiceSupported("nova", voices) {
		t.Fatalf("exact voice id should match")
	}
	if !isSpeechVoiceSupported("NoVa", voices) {
		t.Fatalf("voice match should be case-insensitive")
	}
	if isSpeechVoiceSupported("unknown", voices) {
		t.Fatalf("unknown voice should be unsupported")
	}
}

func TestValidateConnectorTTSModelSupportAllowsProviderVoiceRefOutsidePresetCatalog(t *testing.T) {
	svc, remoteTarget := newConnectorTTSValidationTestService(t, "dashscope", "qwen3-tts-vc")
	req := connectorTTSValidationRequest(
		"dashscope-connector",
		"qwen3-tts-vc",
		&runtimev1.VoiceReference{
			Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF,
			Reference: &runtimev1.VoiceReference_ProviderVoiceRef{
				ProviderVoiceRef: "custom-provider-voice-not-in-preset-catalog",
			},
		},
	)

	if err := validateConnectorTTSModelSupport(context.Background(), slog.New(slog.NewTextHandler(io.Discard, nil)), req, req.GetSpec().GetSpeechSynthesize(), "qwen3-tts-vc", remoteTarget, svc.selector.cloudProvider, svc.speechCatalog); err != nil {
		t.Fatalf("validateConnectorTTSModelSupport(provider voice ref): %v", err)
	}
}

func TestValidateConnectorTTSModelSupportAllowsVoiceAssetRefAfterRuntimeResolution(t *testing.T) {
	svc, remoteTarget := newConnectorTTSValidationTestService(t, "dashscope", "qwen3-tts-vc")
	req := connectorTTSValidationRequest(
		"dashscope-connector",
		"qwen3-tts-vc",
		&runtimev1.VoiceReference{
			Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_VOICE_ASSET,
			Reference: &runtimev1.VoiceReference_VoiceAssetId{
				VoiceAssetId: "voice-asset-001",
			},
		},
	)
	effectiveSpec := &runtimev1.SpeechSynthesizeScenarioSpec{
		Text: "hello from resolved voice asset",
		VoiceRef: &runtimev1.VoiceReference{
			Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF,
			Reference: &runtimev1.VoiceReference_ProviderVoiceRef{
				ProviderVoiceRef: "resolved-provider-voice-not-in-preset-catalog",
			},
		},
	}

	if err := validateConnectorTTSModelSupport(context.Background(), slog.New(slog.NewTextHandler(io.Discard, nil)), req, effectiveSpec, "qwen3-tts-vc", remoteTarget, svc.selector.cloudProvider, svc.speechCatalog); err != nil {
		t.Fatalf("validateConnectorTTSModelSupport(voice asset): %v", err)
	}
}

func TestValidateConnectorTTSModelSupportRejectsUnsupportedPresetVoice(t *testing.T) {
	svc, remoteTarget := newConnectorTTSValidationTestService(t, "dashscope", "qwen3-tts-vc")
	req := connectorTTSValidationRequest(
		"dashscope-connector",
		"qwen3-tts-vc",
		&runtimev1.VoiceReference{
			Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET,
			Reference: &runtimev1.VoiceReference_PresetVoiceId{
				PresetVoiceId: "not-in-preset-catalog",
			},
		},
	)

	err := validateConnectorTTSModelSupport(context.Background(), slog.New(slog.NewTextHandler(io.Discard, nil)), req, req.GetSpec().GetSpeechSynthesize(), "qwen3-tts-vc", remoteTarget, svc.selector.cloudProvider, svc.speechCatalog)
	if err == nil {
		t.Fatal("expected unsupported preset voice to fail")
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
		t.Fatalf("expected AI_MEDIA_OPTION_UNSUPPORTED, got err=%v reason=%v ok=%v", err, reason, ok)
	}
}

func TestValidateConnectorTTSModelSupportRejectsVoiceAssetKindWhenCatalogModelDoesNotSupportIt(t *testing.T) {
	svc, remoteTarget := newConnectorTTSValidationTestService(t, "openai", "tts-1")
	req := connectorTTSValidationRequest(
		"openai-connector",
		"tts-1",
		&runtimev1.VoiceReference{
			Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_VOICE_ASSET,
			Reference: &runtimev1.VoiceReference_VoiceAssetId{
				VoiceAssetId: "voice-asset-001",
			},
		},
	)
	effectiveSpec := &runtimev1.SpeechSynthesizeScenarioSpec{
		Text: "hello from resolved voice asset",
		VoiceRef: &runtimev1.VoiceReference{
			Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF,
			Reference: &runtimev1.VoiceReference_ProviderVoiceRef{
				ProviderVoiceRef: "resolved-provider-voice",
			},
		},
	}

	err := validateConnectorTTSModelSupport(context.Background(), slog.New(slog.NewTextHandler(io.Discard, nil)), req, effectiveSpec, "tts-1", remoteTarget, svc.selector.cloudProvider, svc.speechCatalog)
	if err == nil {
		t.Fatal("expected voice_asset_id on preset-only catalog model to fail")
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
		t.Fatalf("expected AI_MEDIA_OPTION_UNSUPPORTED, got err=%v reason=%v ok=%v", err, reason, ok)
	}
}

func newConnectorTTSValidationTestService(t *testing.T, providerID string, modelID string) (*Service, *nimillm.RemoteTarget) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, `{"data":[{"id":%q,"object":"model"}]}`, modelID)
	}))
	t.Cleanup(server.Close)

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			providerID: {BaseURL: server.URL, APIKey: "test-key"},
		},
		AllowLoopbackEndpoint: true,
	})
	return svc, &nimillm.RemoteTarget{
		ProviderType: providerID,
		Endpoint:     server.URL,
		APIKey:       "test-key",
	}
}

func connectorTTSValidationRequest(connectorID string, modelID string, voiceRef *runtimev1.VoiceReference) *runtimev1.SubmitScenarioJobRequest {
	return &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ConnectorId:   connectorID,
			ModelId:       modelID,
		},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
				SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{
					Text:     "hello",
					VoiceRef: voiceRef,
				},
			},
		},
	}
}

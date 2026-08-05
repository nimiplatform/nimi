package ai

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/grpc"
)

func TestExecuteScenarioSpeechSynthesizeRouteDescribeProbeWritesHeaderForManagedCloudRoute(t *testing.T) {
	fixture := newManagedCloudScenarioTestFixture(t, "openai", "gpt-audio", "https://example.com", Config{})

	transport := &routeDescribeTransportStream{}
	ctx := withCloudScenarioTestIntent(fixture.context, "audio.synthesize", fixture.targetRef)
	ctx = grpc.NewContextWithServerTransportStream(ctx, transport)
	resp, err := fixture.service.ExecuteScenario(ctx, &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			TimeoutMs:     30_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Extensions: []*runtimev1.ScenarioExtension{{
			Namespace: speechSynthesizeRouteDescribeExtensionNamespace,
			Payload: testProbePayload(t, map[string]any{
				"version":            "v1",
				"resolvedBindingRef": "binding-speech-synth-001",
			}),
		}},
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
				SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{
					Text: "route describe probe",
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("execute scenario speech synth route describe probe: %v", err)
	}
	if got := resp.GetModelResolved(); got == "" {
		t.Fatalf("model resolved must be set")
	}
	payload := decodeRouteDescribeHeader(t, transport.header)
	if got := payload["capability"]; got != "audio.synthesize" {
		t.Fatalf("capability mismatch: got=%v", got)
	}
	metadataPayload, ok := payload["metadata"].(map[string]any)
	if !ok {
		t.Fatalf("metadata payload missing: %#v", payload["metadata"])
	}
	if got := metadataPayload["defaultAudioFormat"]; got != "mp3" {
		t.Fatalf("defaultAudioFormat mismatch: got=%v", got)
	}
	if got := metadataPayload["supportsLanguage"]; got != false {
		t.Fatalf("supportsLanguage mismatch: got=%v", got)
	}
	if got, ok := metadataPayload["supportsNativeStreamTts"].(bool); !ok || got {
		t.Fatalf("supportsNativeStreamTts must be explicit false until a named native route is admitted, got=%v ok=%v", got, ok)
	}
}

func TestExecuteScenarioSpeechSynthesizeRouteDescribeProjectsCatalogNativeStreamSupport(t *testing.T) {
	fixture := newManagedCloudScenarioTestFixture(t, "openai", "gpt-audio", "https://example.com", Config{})
	nativeStreamCatalog := speechCatalogWithNativeStreamOpenAI(t)
	fixture.service.speechCatalog = nativeStreamCatalog
	fixture.connectorService.SetModelCatalogResolver(nativeStreamCatalog)
	descriptor := connectorModelDescriptorForAITest(t, fixture.connectorService, fixture.context, fixture.connectorID, "gpt-audio")
	targetRef := cloudScenarioTargetRefForDescriptor(fixture.connectorID, descriptor)

	transport := &routeDescribeTransportStream{}
	ctx := withCloudScenarioTestIntent(fixture.context, "audio.synthesize", targetRef)
	ctx = grpc.NewContextWithServerTransportStream(ctx, transport)
	_, err := fixture.service.ExecuteScenario(ctx, &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			TimeoutMs:     30_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Extensions: []*runtimev1.ScenarioExtension{{
			Namespace: speechSynthesizeRouteDescribeExtensionNamespace,
			Payload: testProbePayload(t, map[string]any{
				"version":            "v1",
				"resolvedBindingRef": "binding-speech-synth-native-001",
			}),
		}},
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
				SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{
					Text: "route describe native stream probe",
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("execute scenario speech synth route describe native stream probe: %v", err)
	}
	payload := decodeRouteDescribeHeader(t, transport.header)
	metadataPayload, ok := payload["metadata"].(map[string]any)
	if !ok {
		t.Fatalf("metadata payload missing: %#v", payload["metadata"])
	}
	if got, ok := metadataPayload["supportsNativeStreamTts"].(bool); !ok || !got {
		t.Fatalf("supportsNativeStreamTts must project catalog metadata, got=%v ok=%v", got, ok)
	}
}

func TestExecuteScenarioSpeechTranscribeRouteDescribeProbeWritesHeaderForManagedCloudRoute(t *testing.T) {
	fixture := newManagedCloudScenarioTestFixture(t, "gemini", "gemini-2.5-flash", "https://example.com", Config{})

	transport := &routeDescribeTransportStream{}
	ctx := withCloudScenarioTestIntent(fixture.context, "audio.transcribe", fixture.targetRef)
	ctx = grpc.NewContextWithServerTransportStream(ctx, transport)
	resp, err := fixture.service.ExecuteScenario(ctx, &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			TimeoutMs:     30_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Extensions: []*runtimev1.ScenarioExtension{{
			Namespace: speechTranscribeRouteDescribeExtensionNamespace,
			Payload: testProbePayload(t, map[string]any{
				"version":            "v1",
				"resolvedBindingRef": "binding-speech-transcribe-001",
			}),
		}},
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_SpeechTranscribe{
				SpeechTranscribe: &runtimev1.SpeechTranscribeScenarioSpec{
					MimeType: "audio/wav",
					AudioSource: &runtimev1.SpeechTranscriptionAudioSource{
						Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{AudioBytes: []byte{0x01}},
					},
					ResponseFormat: "json",
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("execute scenario speech transcribe route describe probe: %v", err)
	}
	if got := resp.GetModelResolved(); got == "" {
		t.Fatalf("model resolved must be set")
	}
	payload := decodeRouteDescribeHeader(t, transport.header)
	if got := payload["capability"]; got != "audio.transcribe" {
		t.Fatalf("capability mismatch: got=%v", got)
	}
	metadataPayload, ok := payload["metadata"].(map[string]any)
	if !ok {
		t.Fatalf("metadata payload missing: %#v", payload["metadata"])
	}
	if got := metadataPayload["supportsLanguage"]; got != true {
		t.Fatalf("supportsLanguage mismatch: got=%v", got)
	}
	if got := metadataPayload["supportsPrompt"]; got != false {
		t.Fatalf("supportsPrompt mismatch: got=%v", got)
	}
}

func TestWriteSpeechRouteDescribeHeaderFailsClosedWhenCatalogMetadataMissing(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"dashscope": {BaseURL: "https://example.com", APIKey: "test-key"},
		},
	})

	transport := &routeDescribeTransportStream{}
	ctx := grpc.NewContextWithServerTransportStream(context.Background(), transport)
	err := svc.writeSpeechRouteDescribeHeader(
		ctx,
		runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE,
		&speechRouteDescribeProbe{
			version:            "v1",
			resolvedBindingRef: "binding-speech-missing-001",
		},
		"dashscope/qwen3-asr-flash",
		&nimillm.RemoteTarget{ProviderType: "dashscope"},
		nil,
	)
	if err == nil {
		t.Fatalf("expected speech route describe probe to fail-close when metadata is missing")
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_MODEL_NOT_FOUND {
		t.Fatalf("expected AI_MODEL_NOT_FOUND, got reason=%v ok=%v err=%v", reason, ok, err)
	}
	if transport.header.Len() != 0 {
		t.Fatalf("route describe header must not be written on fail-close")
	}
}

func speechCatalogWithNativeStreamOpenAI(t *testing.T) *catalog.Resolver {
	t.Helper()
	dir := t.TempDir()
	overlayPath := filepath.Join(dir, "openai.yaml")
	raw := []byte(`version: 1
provider: openai
catalog_version: test-native-stream-tts
models:
  - model_id: gpt-audio
    provider: openai
    model_type: tts
    updated_at: 2026-03-05
    capabilities:
      - audio.synthesize
    pricing:
      unit: token
      input: "100.00"
      output: "200.00"
      currency: USD
      as_of: 2026-03-18
      notes: Test native stream TTS route metadata.
    source_ref:
      url: https://example.com/native-stream-tts
      retrieved_at: 2026-03-05
      note: Test catalog overlay.
    voice_set_id: openai:default-tts-v1
    voice_discovery_mode: static_catalog
    voice_request_options:
      timing_modes:
        - none
      audio_formats:
        - mp3
      supports_native_stream_tts: true
    voice_ref_kinds:
      - preset_voice_id
      - provider_voice_ref
  - model_id: tts-1
    provider: openai
    model_type: tts
    updated_at: 2026-03-05
    capabilities:
      - audio.synthesize
    pricing:
      unit: token
      input: "100.00"
      output: "200.00"
      currency: USD
      as_of: 2026-03-18
      notes: Test native stream TTS route metadata.
    source_ref:
      url: https://example.com/native-stream-tts
      retrieved_at: 2026-03-05
      note: Test catalog overlay.
    voice_set_id: openai:default-tts-v1
    voice_discovery_mode: static_catalog
    voice_request_options:
      timing_modes:
        - none
      audio_formats:
        - mp3
      supports_native_stream_tts: true
    voice_ref_kinds:
      - preset_voice_id
      - provider_voice_ref
`)
	if err := os.WriteFile(overlayPath, raw, 0o600); err != nil {
		t.Fatalf("write native stream catalog overlay: %v", err)
	}
	resolver, err := catalog.NewResolver(catalog.ResolverConfig{CustomDir: dir})
	if err != nil {
		t.Fatalf("create native stream catalog resolver: %v", err)
	}
	return resolver
}

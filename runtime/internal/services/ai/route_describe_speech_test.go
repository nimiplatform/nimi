package ai

import (
	"context"
	"io"
	"log/slog"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/grpc"
)

func TestExecuteScenarioSpeechSynthesizeRouteDescribeProbeWritesHeaderForManagedCloudRoute(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"openai": {BaseURL: "http://example.com", APIKey: "test-key"},
		},
	})

	transport := &routeDescribeTransportStream{}
	ctx := grpc.NewContextWithServerTransportStream(context.Background(), transport)
	resp, err := svc.ExecuteScenario(ctx, &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "openai/gpt-audio",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
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
}

func TestExecuteScenarioSpeechTranscribeRouteDescribeProbeWritesHeaderForManagedCloudRoute(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"gemini": {BaseURL: "http://example.com", APIKey: "test-key"},
		},
	})

	transport := &routeDescribeTransportStream{}
	ctx := grpc.NewContextWithServerTransportStream(context.Background(), transport)
	resp, err := svc.ExecuteScenario(ctx, &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "gemini/gemini-2.5-flash",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
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
			"dashscope": {BaseURL: "http://example.com", APIKey: "test-key"},
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
	if !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
		t.Fatalf("expected AI_MEDIA_OPTION_UNSUPPORTED, got reason=%v ok=%v err=%v", reason, ok, err)
	}
	if transport.header.Len() != 0 {
		t.Fatalf("route describe header must not be written on fail-close")
	}
}

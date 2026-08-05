package ai

import (
	"context"
	"io"
	"log/slog"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc"
)

func TestExecuteScenarioVoiceCloneRouteDescribeProbeWritesHeaderForManagedCloudRoute(t *testing.T) {
	fixture := newManagedCloudScenarioTestFixture(t, "dashscope", "qwen3-tts-vc", "https://example.com", Config{})

	transport := &routeDescribeTransportStream{}
	ctx := withCloudScenarioTestIntent(fixture.context, "voice_workflow.voice_clone", fixture.targetRef)
	ctx = grpc.NewContextWithServerTransportStream(ctx, transport)
	resp, err := fixture.service.ExecuteScenario(ctx, &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			TimeoutMs:     30_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Extensions: []*runtimev1.ScenarioExtension{{
			Namespace: voiceCloneRouteDescribeExtensionNamespace,
			Payload: testProbePayload(t, map[string]any{
				"version":            "v1",
				"resolvedBindingRef": "binding-voice-cloud-001",
			}),
		}},
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_VoiceClone{
				VoiceClone: &runtimev1.VoiceCloneScenarioSpec{
					TargetModelId: "qwen3-tts-vc",
					Input: &runtimev1.VoiceV2VInput{
						ReferenceAudioBytes: []byte{0x01},
						ReferenceAudioMime:  "audio/wav",
						Text:                "route describe probe",
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("execute scenario voice route describe probe: %v", err)
	}
	if resp.GetModelResolved() == "" {
		t.Fatalf("model resolved must be set")
	}
	payload := decodeRouteDescribeHeader(t, transport.header)
	if got := payload["capability"]; got != "voice_workflow.voice_clone" {
		t.Fatalf("capability mismatch: got=%v", got)
	}
	if got := payload["resolvedBindingRef"]; got != "binding-voice-cloud-001" {
		t.Fatalf("resolvedBindingRef mismatch: got=%v", got)
	}
	metadataPayload, ok := payload["metadata"].(map[string]any)
	if !ok {
		t.Fatalf("metadata payload missing: %#v", payload["metadata"])
	}
	if got := metadataPayload["workflowType"]; got != "voice_clone" {
		t.Fatalf("workflowType mismatch: got=%v", got)
	}
	if got := metadataPayload["textPromptMode"]; got != "unsupported" {
		t.Fatalf("textPromptMode mismatch: got=%v", got)
	}
	if got := metadataPayload["supportsLanguageHints"]; got != false {
		t.Fatalf("supportsLanguageHints mismatch: got=%v", got)
	}
	if got := metadataPayload["supportsPreferredName"]; got != true {
		t.Fatalf("supportsPreferredName mismatch: got=%v", got)
	}
	if got := metadataPayload["referenceAudioUriInput"]; got != true {
		t.Fatalf("referenceAudioUriInput mismatch: got=%v", got)
	}
	if got := metadataPayload["referenceAudioBytesInput"]; got != true {
		t.Fatalf("referenceAudioBytesInput mismatch: got=%v", got)
	}
	if got := len(metadataPayload["allowedReferenceAudioMimeTypes"].([]any)); got == 0 {
		t.Fatalf("allowedReferenceAudioMimeTypes must not be empty")
	}
	if got := metadataPayload["requiresTargetSynthesisBinding"]; got != true {
		t.Fatalf("requiresTargetSynthesisBinding mismatch: got=%v", got)
	}
}

func TestExecuteScenarioVoiceCloneRouteDescribeProbeFailsClosedForLocalNonAdmittedFamily(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))

	transport := &routeDescribeTransportStream{}
	ctx := grpc.NewContextWithServerTransportStream(context.Background(), transport)
	err := svc.writeVoiceWorkflowRouteDescribeHeader(
		ctx,
		runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE,
		&voiceWorkflowRouteDescribeProbe{
			version:            "v1",
			resolvedBindingRef: "binding-voice-local-kokoro-001",
		},
		"kokoro-local",
		nil,
		nil,
	)
	if err == nil {
		t.Fatalf("expected local non-admitted family route describe probe to fail-close")
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED {
		t.Fatalf("expected AI_VOICE_WORKFLOW_UNSUPPORTED, got reason=%v ok=%v err=%v", reason, ok, err)
	}
	if transport.header.Len() != 0 {
		t.Fatalf("route describe header must not be written on fail-close")
	}
}

func TestExecuteScenarioVoiceDesignRouteDescribeProbeFailsClosedForLocalNonAdmittedFamily(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))

	transport := &routeDescribeTransportStream{}
	ctx := grpc.NewContextWithServerTransportStream(context.Background(), transport)
	err := svc.writeVoiceWorkflowRouteDescribeHeader(
		ctx,
		runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN,
		&voiceWorkflowRouteDescribeProbe{
			version:            "v1",
			resolvedBindingRef: "binding-voice-local-kokoro-design-001",
		},
		"kokoro-local",
		nil,
		nil,
	)
	if err == nil {
		t.Fatalf("expected local non-admitted family voice design route describe probe to fail-close")
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED {
		t.Fatalf("expected AI_VOICE_WORKFLOW_UNSUPPORTED, got reason=%v ok=%v err=%v", reason, ok, err)
	}
	if transport.header.Len() != 0 {
		t.Fatalf("route describe header must not be written on fail-close")
	}
}

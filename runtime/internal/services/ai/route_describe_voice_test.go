package ai

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/grpc"
)

func TestExecuteScenarioVoiceCloneRouteDescribeProbeWritesHeaderForManagedCloudRoute(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"dashscope": {BaseURL: "http://example.com", APIKey: "test-key"},
		},
	})

	transport := &routeDescribeTransportStream{}
	ctx := grpc.NewContextWithServerTransportStream(context.Background(), transport)
	resp, err := svc.ExecuteScenario(ctx, &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "dashscope/qwen3-tts-vc",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
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
					TargetModelId: "dashscope/qwen3-tts-vc",
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
	if got := payload["capability"]; got != "voice_workflow.tts_v2v" {
		t.Fatalf("capability mismatch: got=%v", got)
	}
	if got := payload["resolvedBindingRef"]; got != "binding-voice-cloud-001" {
		t.Fatalf("resolvedBindingRef mismatch: got=%v", got)
	}
	metadataPayload, ok := payload["metadata"].(map[string]any)
	if !ok {
		t.Fatalf("metadata payload missing: %#v", payload["metadata"])
	}
	if got := metadataPayload["workflowType"]; got != "tts_v2v" {
		t.Fatalf("workflowType mismatch: got=%v", got)
	}
	if got := metadataPayload["supportsReferenceAudioInput"]; got != true {
		t.Fatalf("supportsReferenceAudioInput mismatch: got=%v", got)
	}
	if got := metadataPayload["supportsTextPromptInput"]; got != false {
		t.Fatalf("supportsTextPromptInput mismatch: got=%v", got)
	}
	if got := metadataPayload["requiresTargetSynthesisBinding"]; got != true {
		t.Fatalf("requiresTargetSynthesisBinding mismatch: got=%v", got)
	}
}

func TestExecuteScenarioVoiceCloneRouteDescribeProbeWritesHeaderForLocalVoxCPMRoute(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()
	svc.SetLocalProviderEndpoint("speech", server.URL+"/v1", "")
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalAssetsResponse{{
		Assets: []*runtimev1.LocalAssetRecord{{
			LocalAssetId: "local-voxcpm2-001",
			AssetId:      "speech/voxcpm2",
			Engine:       "speech",
			Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
			Endpoint:     server.URL + "/v1",
		}},
	}}}

	transport := &routeDescribeTransportStream{}
	ctx := grpc.NewContextWithServerTransportStream(context.Background(), transport)
	resp, err := svc.ExecuteScenario(ctx, &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "speech/voxcpm2",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     30_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Extensions: []*runtimev1.ScenarioExtension{{
			Namespace: voiceCloneRouteDescribeExtensionNamespace,
			Payload: testProbePayload(t, map[string]any{
				"version":            "v1",
				"resolvedBindingRef": "binding-voice-local-voxcpm-001",
			}),
		}},
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_VoiceClone{
				VoiceClone: &runtimev1.VoiceCloneScenarioSpec{
					TargetModelId: "speech/voxcpm2",
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
		t.Fatalf("execute scenario local voxcpm voice route describe probe: %v", err)
	}
	if got := resp.GetModelResolved(); got != "speech/voxcpm2" {
		t.Fatalf("model resolved mismatch: got=%q", got)
	}
	payload := decodeRouteDescribeHeader(t, transport.header)
	if got := payload["capability"]; got != "voice_workflow.tts_v2v" {
		t.Fatalf("capability mismatch: got=%v", got)
	}
	if got := payload["resolvedBindingRef"]; got != "binding-voice-local-voxcpm-001" {
		t.Fatalf("resolvedBindingRef mismatch: got=%v", got)
	}
	metadataPayload, ok := payload["metadata"].(map[string]any)
	if !ok {
		t.Fatalf("metadata payload missing: %#v", payload["metadata"])
	}
	if got := metadataPayload["workflowType"]; got != "tts_v2v" {
		t.Fatalf("workflowType mismatch: got=%v", got)
	}
	if got := metadataPayload["supportsReferenceAudioInput"]; got != true {
		t.Fatalf("supportsReferenceAudioInput mismatch: got=%v", got)
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
			resolvedBindingRef: "binding-voice-local-qwen3-001",
		},
		"local/qwen3-tts-local",
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
			resolvedBindingRef: "binding-voice-local-qwen3-design-001",
		},
		"qwen3-tts-local",
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

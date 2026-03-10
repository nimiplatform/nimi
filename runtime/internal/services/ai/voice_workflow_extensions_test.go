package ai

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestVoiceWorkflowExtensionNamespaceAndAllowedKeys(t *testing.T) {
	if got := voiceWorkflowExtensionNamespace(runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE); got != "nimi.scenario.voice_clone.request" {
		t.Fatalf("unexpected clone namespace: %q", got)
	}
	if got := voiceWorkflowExtensionNamespace(runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN); got != "nimi.scenario.voice_design.request" {
		t.Fatalf("unexpected design namespace: %q", got)
	}
	if got := voiceWorkflowExtensionNamespace(runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE); got != "" {
		t.Fatalf("unexpected namespace for non-voice scenario: %q", got)
	}

	designKeys := allowedVoiceWorkflowExtensionKeys("elevenlabs", runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN)
	if _, ok := designKeys["preview_paths"]; !ok {
		t.Fatalf("elevenlabs voice design should allow preview_paths")
	}
	if _, ok := designKeys["create_paths"]; !ok {
		t.Fatalf("elevenlabs voice design should allow create_paths")
	}

	cloneKeys := allowedVoiceWorkflowExtensionKeys("stepfun", runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE)
	if _, ok := cloneKeys["workflow_paths"]; !ok {
		t.Fatalf("voice clone should allow workflow_paths")
	}
	if _, ok := cloneKeys["create_paths"]; ok {
		t.Fatalf("voice clone should not allow create_paths")
	}
	if _, ok := cloneKeys["user_id"]; ok {
		t.Fatalf("voice clone should not allow removed provider-specific user_id")
	}

	if !isVoiceWorkflowStringListKey("workflow_paths") || !isVoiceWorkflowStringListKey("clone_paths") {
		t.Fatalf("expected workflow_paths and clone_paths to be treated as string-list keys")
	}
	if isVoiceWorkflowStringListKey("base_url") {
		t.Fatalf("base_url must not be treated as string-list key")
	}
}

func TestResolveVoiceWorkflowExtensionPayloadNormalizesCanonicalFields(t *testing.T) {
	payload, err := structpb.NewStruct(map[string]any{
		"base_url":      "https://voice.example.com",
		"headers":       map[string]any{"X-Test": "ok"},
		"preview_paths": []any{"/v1/previews"},
		"create_paths":  []any{"/v1/create"},
	})
	if err != nil {
		t.Fatalf("NewStruct: %v", err)
	}

	req := &runtimev1.SubmitScenarioJobRequest{
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN,
		Extensions: []*runtimev1.ScenarioExtension{
			{
				Namespace: "nimi.scenario.voice_design.request",
				Payload:   payload,
			},
		},
	}

	normalized, err := resolveVoiceWorkflowExtensionPayload(req, "elevenlabs")
	if err != nil {
		t.Fatalf("resolveVoiceWorkflowExtensionPayload: %v", err)
	}
	if got := normalized["base_url"]; got != "https://voice.example.com" {
		t.Fatalf("unexpected base_url: %#v", got)
	}
	headers, ok := normalized["headers"].(map[string]any)
	if !ok || headers["X-Test"] != "ok" {
		t.Fatalf("unexpected normalized headers: %#v", normalized["headers"])
	}
	previewPaths, ok := normalized["preview_paths"].([]any)
	if !ok || len(previewPaths) != 1 || previewPaths[0] != "/v1/previews" {
		t.Fatalf("unexpected preview_paths: %#v", normalized["preview_paths"])
	}
	createPaths, ok := normalized["create_paths"].([]any)
	if !ok || len(createPaths) != 1 || createPaths[0] != "/v1/create" {
		t.Fatalf("unexpected create_paths: %#v", normalized["create_paths"])
	}
}

func TestValidateVoiceWorkflowExtensionPayloadRejectsInvalidStructures(t *testing.T) {
	if _, err := validateVoiceWorkflowExtensionPayload("stepfun", runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE, map[string]any{
		"workflow_paths": []any{""},
	}); err == nil {
		t.Fatalf("expected invalid string slice rejection")
	}

	if _, err := validateVoiceWorkflowExtensionPayload("stepfun", runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE, map[string]any{
		"headers": map[string]any{"X-Test": ""},
	}); err == nil {
		t.Fatalf("expected invalid header rejection")
	}

	_, err := validateVoiceWorkflowExtensionPayload("stepfun", runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE, map[string]any{
		"endpoint": "https://legacy.example.com",
	})
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED {
		t.Fatalf("expected AI_VOICE_WORKFLOW_UNSUPPORTED for legacy key, got reason=%v ok=%v err=%v", reason, ok, err)
	}

	_, err = validateVoiceWorkflowExtensionPayload("stepfun", runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE, map[string]any{
		"user_id": "removed-provider-field",
	})
	reason, ok = grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED {
		t.Fatalf("expected AI_VOICE_WORKFLOW_UNSUPPORTED for removed user_id key, got reason=%v ok=%v err=%v", reason, ok, err)
	}
}

func TestResolveVoiceWorkflowExtensionPayloadIgnoresForeignNamespace(t *testing.T) {
	payload, err := structpb.NewStruct(map[string]any{"base_url": "https://voice.example.com"})
	if err != nil {
		t.Fatalf("NewStruct: %v", err)
	}
	req := &runtimev1.SubmitScenarioJobRequest{
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE,
		Extensions: []*runtimev1.ScenarioExtension{
			{
				Namespace: "nimi.scenario.image.request",
				Payload:   payload,
			},
		},
	}
	normalized, err := resolveVoiceWorkflowExtensionPayload(req, "stepfun")
	if err != nil {
		t.Fatalf("unexpected error for foreign namespace: %v", err)
	}
	if normalized != nil {
		t.Fatalf("expected nil payload for foreign namespace, got %#v", normalized)
	}
}

func TestValidateVoiceWorkflowExtensionPayloadAcceptsEmptyAndHeaderMapString(t *testing.T) {
	normalized, err := validateVoiceWorkflowExtensionPayload("stepfun", runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE, nil)
	if err != nil {
		t.Fatalf("empty payload should be accepted, got %v", err)
	}
	if normalized != nil {
		t.Fatalf("expected nil normalized payload for empty input, got %#v", normalized)
	}

	normalized, err = validateVoiceWorkflowExtensionPayload("stepfun", runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE, map[string]any{
		"headers":        map[string]string{"X-Test": "ok"},
		"workflow_paths": []any{"/v1/clone"},
	})
	if err != nil {
		t.Fatalf("expected valid map[string]string headers: %v", err)
	}
	headers, ok := normalized["headers"].(map[string]any)
	if !ok || headers["X-Test"] != "ok" {
		t.Fatalf("unexpected normalized header map: %#v", normalized["headers"])
	}
}

package ai

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestVoiceWorkflowExtensionNamespace(t *testing.T) {
	if got := voiceWorkflowExtensionNamespace(runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE); got != "nimi.scenario.voice_clone.request" {
		t.Fatalf("unexpected clone namespace: %q", got)
	}
	if got := voiceWorkflowExtensionNamespace(runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN); got != "nimi.scenario.voice_design.request" {
		t.Fatalf("unexpected design namespace: %q", got)
	}
	if got := voiceWorkflowExtensionNamespace(runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE); got != "" {
		t.Fatalf("unexpected namespace for non-voice scenario: %q", got)
	}
}

func TestValidateVoiceWorkflowExtensionPayloadRejectsExecutionSelectors(t *testing.T) {
	for _, key := range []string{
		"api_key_header",
		"base_url",
		"headers",
		"workflow_paths",
		"clone_paths",
		"design_paths",
		"preview_paths",
		"create_paths",
		"endpoint",
		"model",
	} {
		t.Run(key, func(t *testing.T) {
			_, err := validateVoiceWorkflowExtensionPayload(
				"elevenlabs",
				runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN,
				map[string]any{key: "forbidden"},
			)
			reason, ok := grpcerr.ExtractReasonCode(err)
			if !ok || reason != runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED {
				t.Fatalf("selector %q reason=%v ok=%v err=%v", key, reason, ok, err)
			}
		})
	}
}

func TestResolveVoiceWorkflowExtensionPayloadRejectsOwnedSelectorNamespace(t *testing.T) {
	payload, err := structpb.NewStruct(map[string]any{"base_url": "https://voice.example.com"})
	if err != nil {
		t.Fatalf("NewStruct: %v", err)
	}
	req := &runtimev1.SubmitScenarioJobRequest{
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE,
		Extensions: []*runtimev1.ScenarioExtension{{
			Namespace: "nimi.scenario.voice_clone.request",
			Payload:   payload,
		}},
	}
	_, err = resolveVoiceWorkflowExtensionPayload(req, "stepfun")
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED {
		t.Fatalf("owned selector namespace reason=%v ok=%v err=%v", reason, ok, err)
	}
}

func TestResolveVoiceWorkflowExtensionPayloadIgnoresForeignNamespace(t *testing.T) {
	payload, err := structpb.NewStruct(map[string]any{"base_url": "https://voice.example.com"})
	if err != nil {
		t.Fatalf("NewStruct: %v", err)
	}
	req := &runtimev1.SubmitScenarioJobRequest{
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE,
		Extensions: []*runtimev1.ScenarioExtension{{
			Namespace: "nimi.scenario.image.request",
			Payload:   payload,
		}},
	}
	normalized, err := resolveVoiceWorkflowExtensionPayload(req, "stepfun")
	if err != nil || normalized != nil {
		t.Fatalf("foreign extension result=%#v err=%v", normalized, err)
	}
}

func TestValidateVoiceWorkflowExtensionPayloadAcceptsEmpty(t *testing.T) {
	normalized, err := validateVoiceWorkflowExtensionPayload(
		"stepfun",
		runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE,
		nil,
	)
	if err != nil || normalized != nil {
		t.Fatalf("empty extension result=%#v err=%v", normalized, err)
	}
}

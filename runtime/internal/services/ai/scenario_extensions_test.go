package ai

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestClassifyScenarioExtensionsBestEffort(t *testing.T) {
	ignored, err := classifyScenarioExtensions(
		runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		[]*runtimev1.ScenarioExtension{
			{Namespace: "nimi.scenario.image.request"},
		},
	)
	if err != nil {
		t.Fatalf("classify scenario extensions: %v", err)
	}
	if len(ignored) != 0 {
		t.Fatalf("best-effort extension should be accepted without synthetic ignored entry, got=%d", len(ignored))
	}
}

func TestClassifyScenarioExtensionsStrictAllowed(t *testing.T) {
	ignored, err := classifyScenarioExtensions(
		runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE,
		[]*runtimev1.ScenarioExtension{
			{Namespace: "nimi.scenario.voice_clone.request"},
		},
	)
	if err != nil {
		t.Fatalf("classify scenario extensions: %v", err)
	}
	if len(ignored) != 0 {
		t.Fatalf("strict extension should not be ignored, got=%d", len(ignored))
	}
}

func TestClassifyScenarioExtensionsAllowsTextGenerateRouteDescribeProbe(t *testing.T) {
	ignored, err := classifyScenarioExtensions(
		runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		[]*runtimev1.ScenarioExtension{
			{Namespace: textGenerateRouteDescribeExtensionNamespace},
		},
	)
	if err != nil {
		t.Fatalf("classify scenario extensions: %v", err)
	}
	if len(ignored) != 0 {
		t.Fatalf("strict extension should not be ignored, got=%d", len(ignored))
	}
}

func TestClassifyScenarioExtensionsAllowsVoiceWorkflowRouteDescribeProbe(t *testing.T) {
	ignored, err := classifyScenarioExtensions(
		runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE,
		[]*runtimev1.ScenarioExtension{
			{Namespace: voiceCloneRouteDescribeExtensionNamespace},
		},
	)
	if err != nil {
		t.Fatalf("classify scenario extensions: %v", err)
	}
	if len(ignored) != 0 {
		t.Fatalf("strict extension should not be ignored, got=%d", len(ignored))
	}
}

func TestClassifyScenarioExtensionsRejectsUnknownMediaNamespace(t *testing.T) {
	_, err := classifyScenarioExtensions(
		runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		[]*runtimev1.ScenarioExtension{
			{Namespace: "nimi.runtime.unknown"},
		},
	)
	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected grpc status error, got=%v", err)
	}
	if st.Code() != codes.InvalidArgument {
		t.Fatalf("status code mismatch: got=%v want=%v", st.Code(), codes.InvalidArgument)
	}
	if st.Message() != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED.String() {
		t.Fatalf("reason code mismatch: got=%q want=%q", st.Message(), runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED.String())
	}
}

func TestClassifyScenarioExtensionsRejectsUnknownVoiceNamespace(t *testing.T) {
	_, err := classifyScenarioExtensions(
		runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN,
		[]*runtimev1.ScenarioExtension{
			{Namespace: "nimi.scenario.speech_synthesize.request"},
		},
	)
	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected grpc status error, got=%v", err)
	}
	if st.Code() != codes.InvalidArgument {
		t.Fatalf("status code mismatch: got=%v want=%v", st.Code(), codes.InvalidArgument)
	}
	if st.Message() != runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED.String() {
		t.Fatalf("reason code mismatch: got=%q want=%q", st.Message(), runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED.String())
	}
}

func TestClassifyScenarioExtensionsRejectsEmptyNamespace(t *testing.T) {
	_, err := classifyScenarioExtensions(
		runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		[]*runtimev1.ScenarioExtension{
			{Namespace: ""},
		},
	)
	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected grpc status error, got=%v", err)
	}
	if st.Code() != codes.InvalidArgument {
		t.Fatalf("status code mismatch: got=%v want=%v", st.Code(), codes.InvalidArgument)
	}
	if st.Message() != runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID.String() {
		t.Fatalf("reason code mismatch: got=%q want=%q", st.Message(), runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID.String())
	}
}

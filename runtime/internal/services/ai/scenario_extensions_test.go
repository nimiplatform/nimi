package ai

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
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

func TestClassifyScenarioExtensionsAllowsWorldGenerateNamespace(t *testing.T) {
	ignored, err := classifyScenarioExtensions(
		runtimev1.ScenarioType_SCENARIO_TYPE_WORLD_GENERATE,
		[]*runtimev1.ScenarioExtension{
			{Namespace: "nimi.scenario.world_generate.request"},
		},
	)
	if err != nil {
		t.Fatalf("classify scenario extensions: %v", err)
	}
	if len(ignored) != 0 {
		t.Fatalf("world generate extension should not be ignored, got=%d", len(ignored))
	}
}

func TestClassifyScenarioExtensionsRejectsRetiredRouteDescribeNamespaces(t *testing.T) {
	tests := []struct {
		name         string
		scenarioType runtimev1.ScenarioType
		namespace    string
		wantReason   runtimev1.ReasonCode
	}{
		{"text generate", runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE, "nimi.scenario.text_generate.route_describe", runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED},
		{"text embed", runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED, "nimi.scenario.text_embed.route_describe", runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED},
		{"image generate", runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE, "nimi.scenario.image_generate.route_describe", runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED},
		{"speech synthesize", runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE, "nimi.scenario.speech_synthesize.route_describe", runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED},
		{"speech transcribe", runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE, "nimi.scenario.speech_transcribe.route_describe", runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED},
		{"voice clone", runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE, "nimi.scenario.voice_clone.route_describe", runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED},
		{"voice design", runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN, "nimi.scenario.voice_design.route_describe", runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := classifyScenarioExtensions(
				tc.scenarioType,
				[]*runtimev1.ScenarioExtension{{Namespace: tc.namespace}},
			)
			if status.Code(err) != codes.InvalidArgument {
				t.Fatalf("status code = %v, want %v", status.Code(err), codes.InvalidArgument)
			}
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != tc.wantReason {
				t.Fatalf("reason = %v (present=%v), want %v", reason, ok, tc.wantReason)
			}
		})
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
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
		t.Fatalf("reason code mismatch: got=%v ok=%v want=%v", reason, ok, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
}

func TestClassifyScenarioExtensionsRejectsFirstRunInternalKeys(t *testing.T) {
	payload, err := structpb.NewStruct(map[string]any{
		"nimi_first_run_baseline_probe": true,
		"nimi_allow_empty_transcript":   true,
	})
	if err != nil {
		t.Fatalf("build payload: %v", err)
	}
	_, err = classifyScenarioExtensions(
		runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE,
		[]*runtimev1.ScenarioExtension{
			{Namespace: "nimi.scenario.speech_transcribe.request", Payload: payload},
		},
	)
	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected grpc status error, got=%v", err)
	}
	if st.Code() != codes.InvalidArgument {
		t.Fatalf("status code mismatch: got=%v want=%v", st.Code(), codes.InvalidArgument)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
		t.Fatalf("reason code mismatch: got=%v ok=%v want=%v", reason, ok, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
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
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED {
		t.Fatalf("reason code mismatch: got=%v ok=%v want=%v", reason, ok, runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED)
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
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID {
		t.Fatalf("reason code mismatch: got=%v ok=%v want=%v", reason, ok, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
}

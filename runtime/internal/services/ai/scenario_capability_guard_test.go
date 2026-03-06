package ai

import (
	"io"
	"log/slog"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func TestValidateScenarioCapabilitySupportedModelPasses(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))

	err := svc.validateScenarioCapability(
		runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		"anthropic/claude-sonnet-4-6",
		nil,
		nil,
	)
	if err != nil {
		t.Fatalf("expected supported scenario capability, got error: %v", err)
	}
}

func TestValidateScenarioCapabilityFailCloseReasonCodes(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))

	testCases := []struct {
		name       string
		scenario   runtimev1.ScenarioType
		model      string
		expectedRC runtimev1.ReasonCode
	}{
		{
			name:       "text embed unsupported",
			scenario:   runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED,
			model:      "anthropic/claude-sonnet-4-6",
			expectedRC: runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED,
		},
		{
			name:       "image generate unsupported",
			scenario:   runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
			model:      "anthropic/claude-sonnet-4-6",
			expectedRC: runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED,
		},
		{
			name:       "voice clone unsupported",
			scenario:   runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE,
			model:      "openai/tts-1",
			expectedRC: runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			err := svc.validateScenarioCapability(tc.scenario, tc.model, nil, nil)
			if err == nil {
				t.Fatalf("expected capability guard error")
			}
			reasonCode, ok := grpcerr.ExtractReasonCode(err)
			if !ok {
				t.Fatalf("expected grpc reason code, got error: %v", err)
			}
			if reasonCode != tc.expectedRC {
				t.Fatalf("reason code mismatch: got=%s want=%s", reasonCode.String(), tc.expectedRC.String())
			}
		})
	}
}

package capabilitydriver

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
)

func TestExactCloudTextSerializersRejectUnadmittedRawChunks(t *testing.T) {
	for _, tc := range []struct {
		name      string
		serialize func(*runtimev1.TextGenerateScenarioSpec, bool) (textbehavior.SerializedRequest, error)
		spec      func(*testing.T) *runtimev1.TextGenerateScenarioSpec
	}{
		{"gemini-schema", Gemini38FlashRequestSerializer, geminiSchemaTestSpec},
		{"gemini-tool", Gemini38FlashRequestSerializer, geminiToolTestSpec},
		{"qwen-schema", DashscopeQwen38RequestSerializer, geminiSchemaTestSpec},
		{"qwen-tool", DashscopeQwen38RequestSerializer, geminiToolTestSpec},
	} {
		t.Run(tc.name, func(t *testing.T) {
			spec := tc.spec(t)
			if _, err := tc.serialize(spec, false); err != nil {
				t.Fatalf("control request rejected: %v", err)
			}
			spec.IncludeRawChunks = true
			if _, err := tc.serialize(spec, false); textBehaviorReasonForTest(err) != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED {
				t.Fatalf("unadmitted raw chunks silently ignored: %v", err)
			}
		})
	}
}

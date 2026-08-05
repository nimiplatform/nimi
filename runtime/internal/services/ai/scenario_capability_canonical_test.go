package ai

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aicapabilities"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

func TestScenarioRequiredCapabilitiesUseCanonicalTokens(t *testing.T) {
	cases := []struct {
		scenario runtimev1.ScenarioType
		want     []string
	}{
		{runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE, []string{aicapabilities.TextGenerate}},
		{runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED, []string{aicapabilities.TextEmbed}},
		{runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE, []string{aicapabilities.ImageGenerate}},
		{runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE, []string{aicapabilities.VideoGenerate}},
		{runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE, []string{aicapabilities.AudioSynthesize}},
		{runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE, []string{aicapabilities.AudioTranscribe}},
		{runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE, []string{aicapabilities.VoiceWorkflowVoiceClone}},
		{runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN, []string{aicapabilities.VoiceWorkflowVoiceDesign}},
		{runtimev1.ScenarioType_SCENARIO_TYPE_WORLD_GENERATE, []string{aicapabilities.WorldGenerate}},
	}

	for _, tc := range cases {
		got := scenarioRequiredCapabilities(tc.scenario)
		if len(got) != len(tc.want) || got[0] != tc.want[0] {
			t.Fatalf("scenarioRequiredCapabilities(%v)=%v, want=%v", tc.scenario, got, tc.want)
		}
	}
	if got := scenarioRequiredCapabilities(runtimev1.ScenarioType_SCENARIO_TYPE_UNSPECIFIED); got != nil {
		t.Fatalf("unspecified scenario should have nil required capabilities, got %v", got)
	}
}

func TestCloudMediaDriverOwnsProviderCapabilityAndDialectResolution(t *testing.T) {
	if got := capabilitydriver.ResolveCloudMediaAdapter("worldlabs", "world.generate"); got != capabilitydriver.CloudMediaAdapterWorldLabsNative {
		t.Fatalf("worldlabs world Driver adapter=%q", got)
	}
	if got := capabilitydriver.ResolveCloudMediaAdapter("dashscope", "audio.synthesize"); got != capabilitydriver.CloudMediaAdapterAlibabaNative {
		t.Fatalf("dashscope TTS Driver adapter=%q", got)
	}
	if got := capabilitydriver.ResolveCloudMediaAdapter("anthropic", "image.generate"); got != "" {
		t.Fatalf("unsupported media capability gained adapter=%q", got)
	}
}

package ai

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aicapabilities"
	"github.com/nimiplatform/nimi/runtime/internal/providerregistry"
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
		{runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE, []string{aicapabilities.VoiceWorkflowTTSV2V}},
		{runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN, []string{aicapabilities.VoiceWorkflowTTST2V}},
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

func TestMediaScenarioSupportedByProviderRecordForWorld(t *testing.T) {
	record := providerregistry.ProviderRecord{ID: "worldlabs"}
	if !mediaScenarioSupportedByProviderRecord(record, runtimev1.Modal_MODAL_WORLD) {
		t.Fatalf("expected worldlabs record to support world modal")
	}
}

func TestMediaScenarioSupportedByProviderRecord(t *testing.T) {
	record := providerregistry.ProviderRecord{
		SupportsImage: true,
		SupportsVideo: true,
		SupportsTTS:   true,
		SupportsSTT:   false,
	}

	if !mediaScenarioSupportedByProviderRecord(record, runtimev1.Modal_MODAL_IMAGE) {
		t.Fatalf("expected image support")
	}
	if !mediaScenarioSupportedByProviderRecord(record, runtimev1.Modal_MODAL_VIDEO) {
		t.Fatalf("expected video support")
	}
	if !mediaScenarioSupportedByProviderRecord(record, runtimev1.Modal_MODAL_TTS) {
		t.Fatalf("expected tts support")
	}
	if mediaScenarioSupportedByProviderRecord(record, runtimev1.Modal_MODAL_STT) {
		t.Fatalf("expected stt to be unsupported")
	}
}

func TestInferVoiceAssetProvider(t *testing.T) {
	cases := []struct {
		modelID string
		want    string
	}{
		{modelID: "local/qwen3-tts-local", want: "local"},
		{modelID: "dashscope/qwen3-tts-vc", want: "dashscope"},
		{modelID: "qwen3-tts-local", want: "local"},
		{modelID: "cosyvoice2-local", want: "local"},
		{modelID: "openbmb/VoxCPM2", want: "local"},
		{modelID: "k2-fsa/OmniVoice", want: "local"},
		{modelID: "voxcpm2-local", want: "local"},
		{modelID: "omnivoice-local", want: "local"},
		{modelID: "", want: ""},
	}
	for _, tc := range cases {
		if got := inferVoiceAssetProvider(tc.modelID); got != tc.want {
			t.Fatalf("inferVoiceAssetProvider(%q)=%q, want=%q", tc.modelID, got, tc.want)
		}
	}
}

package capabilitydriver

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestQwen3TTSListsPresetVoicesFromExactSelectedModel(t *testing.T) {
	root := t.TempDir()
	entry := filepath.Join(root, "model.safetensors")
	if err := os.WriteFile(entry, []byte("model"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "config.json"), []byte(`{
  "talker_config": {
    "spk_id": {"serena": 3066, "uncle_fu": 3010},
    "codec_language_id": {"chinese": 2055, "beijing_dialect": 2074}
  }
}`), 0o600); err != nil {
		t.Fatal(err)
	}
	digest := strings.Repeat("a", 64)
	voices, err := (Qwen3TTSDriver{}).ListPresetVoices([]InvocationExactBinding{{
		RequirementID: Qwen3TTSModelRequirementID, AssetID: "local.tts.qwen3", LocalAssetID: "asset-1",
		AbsolutePath: entry, VerifiedContentID: "sha256:" + digest, EntrySHA256: digest,
	}})
	if err != nil {
		t.Fatalf("ListPresetVoices: %v", err)
	}
	if len(voices) != 2 || voices[0].VoiceID != "serena" || voices[0].Name != "Serena" || voices[1].Name != "Uncle Fu" {
		t.Fatalf("voices=%+v", voices)
	}
	if got := strings.Join(voices[0].SupportedLangs, ","); got != "beijing-dialect,chinese" {
		t.Fatalf("supported languages=%q", got)
	}
}

func TestQwen3SpeechProductionRegistryProjectsExactAssetKinds(t *testing.T) {
	tests := []struct {
		name         string
		contract     string
		identity     Identity
		requirement  string
		resourceKind string
		assetKind    runtimev1.LocalAssetKind
		artifactRole string
		features     []string
	}{
		{name: "tts", contract: AudioSynthesizeContract, identity: Identity{ImplementationID: Qwen3TTSImplementationID, DriverID: Qwen3TTSDriverID, DriverDialect: Qwen3TTSDriverDialect}, requirement: Qwen3TTSModelRequirementID, resourceKind: "tts", assetKind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_TTS, artifactRole: "tts_model"},
		{name: "voice-reference", contract: VoiceCreateContract, identity: Identity{ImplementationID: Qwen3VoiceCreateImplementationID, DriverID: Qwen3TTSDriverID, DriverDialect: Qwen3VoiceCreateDriverDialect}, requirement: Qwen3VoiceCreateModelRequirementID, resourceKind: "tts", assetKind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_TTS, artifactRole: Qwen3VoiceCloneArtifactRole, features: []string{"input.audio"}},
		{name: "voice-description", contract: VoiceCreateContract, identity: Identity{ImplementationID: Qwen3VoiceCreateImplementationID, DriverID: Qwen3TTSDriverID, DriverDialect: Qwen3VoiceCreateDriverDialect}, requirement: Qwen3VoiceCreateModelRequirementID, resourceKind: "tts", assetKind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_TTS, artifactRole: Qwen3VoiceDesignArtifactRole, features: []string{"input.text"}},
		{name: "asr", contract: AudioTranscribeContract, identity: Identity{ImplementationID: Qwen3ASRImplementationID, DriverID: Qwen3ASRDriverID, DriverDialect: Qwen3ASRDriverDialect}, requirement: Qwen3ASRModelRequirementID, resourceKind: "stt", assetKind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_STT, artifactRole: "stt_model"},
		{name: "asr-transformers", contract: AudioTranscribeContract, identity: Identity{ImplementationID: Qwen3ASRTransformersImplementationID, DriverID: Qwen3ASRTransformersDriverID, DriverDialect: Qwen3ASRTransformersDriverDialect}, requirement: Qwen3ASRModelRequirementID, resourceKind: "stt", assetKind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_STT, artifactRole: "stt_transformers_model"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			driver, reason := NewProductionRegistry().Resolve(test.contract, test.identity)
			if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || driver == nil {
				t.Fatalf("Resolve reason=%v driver=%T", reason, driver)
			}
			requirements, reason := driver.Interpret(InterpretInput{SupportedFeatures: test.features})
			if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || len(requirements) != 1 || requirements[0].GetRequirementId() != test.requirement || requirements[0].GetResourceKind() != test.resourceKind {
				t.Fatalf("Interpret reason=%v requirements=%+v", reason, requirements)
			}
			binding := &runtimev1.LocalAssetExactBinding{RequirementId: test.requirement, LocalAssetId: "asset", VerifiedContentId: "sha256:" + strings.Repeat("a", 64), EntrySha256: strings.Repeat("a", 64)}
			asset := AssetDescriptor{LocalAssetID: "asset", VerifiedContentID: binding.GetVerifiedContentId(), EntrySHA256: binding.GetEntrySha256(), Kind: test.assetKind, Engine: "speech", ArtifactRoles: []string{test.artifactRole}}
			if reason := driver.ValidateBinding(requirements[0], binding, asset); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
				t.Fatalf("ValidateBinding reason=%v", reason)
			}
		})
	}
}

func TestQwen3VoiceCreatePlansTypedSourceWithoutChangingSelection(t *testing.T) {
	digest := strings.Repeat("e", 64)
	binding := InvocationExactBinding{
		RequirementID:     Qwen3VoiceCreateModelRequirementID,
		AssetID:           "catalog/qwen3-voice",
		LocalAssetID:      "local-qwen3-voice",
		AbsolutePath:      filepath.Join(t.TempDir(), "model.safetensors"),
		VerifiedContentID: "sha256:" + digest,
		EntrySHA256:       digest,
	}
	tests := []struct {
		name            string
		feature         string
		request         *runtimev1.VoiceCreateScenarioSpec
		workflowModelID string
	}{
		{name: "reference-audio", feature: "input.audio", workflowModelID: "qwen3-local-voice-clone", request: &runtimev1.VoiceCreateScenarioSpec{Source: &runtimev1.VoiceCreateScenarioSpec_ReferenceAudio{ReferenceAudio: &runtimev1.VoiceV2VInput{ReferenceAudioBytes: []byte("audio"), ReferenceAudioMime: "audio/wav", Text: "hello"}}}},
		{name: "text-description", feature: "input.text", workflowModelID: "qwen3-local-voice-design", request: &runtimev1.VoiceCreateScenarioSpec{Source: &runtimev1.VoiceCreateScenarioSpec_TextDescription{TextDescription: &runtimev1.VoiceT2VInput{InstructionText: "warm narrator", PreviewText: "hello"}}}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			plan, err := (Qwen3VoiceCreateDriver{}).PlanVoiceCreateInvocation(VoiceCreateInvocationInput{ExactBindings: []InvocationExactBinding{binding}, SupportedFeatures: []string{test.feature}, Request: test.request})
			if err != nil || plan == nil || plan.ModelAssetID() != binding.AssetID || plan.DriverID() != Qwen3TTSDriverID || plan.SourceFeature() != test.feature || plan.WorkflowModelID() != test.workflowModelID {
				t.Fatalf("plan=%+v error=%v", plan, err)
			}
		})
	}
	_, err := (Qwen3VoiceCreateDriver{}).PlanVoiceCreateInvocation(VoiceCreateInvocationInput{ExactBindings: []InvocationExactBinding{binding}, SupportedFeatures: []string{"input.text"}, Request: tests[0].request})
	if invocation, ok := err.(*InvocationError); !ok || invocation.Kind != InvocationFailureUnsupported {
		t.Fatalf("mismatched selected feature error=%T %v", err, err)
	}
}

func TestQwen3SpeechPlansCaptureExactModelAndAudio(t *testing.T) {
	digest := strings.Repeat("b", 64)
	root := t.TempDir()
	ttsBinding := InvocationExactBinding{RequirementID: Qwen3TTSModelRequirementID, AssetID: "catalog/tts-model", LocalAssetID: "tts-asset", AbsolutePath: filepath.Join(root, "tts", "model.safetensors"), VerifiedContentID: "sha256:" + digest, EntrySHA256: digest}
	ttsPlan, err := (Qwen3TTSDriver{}).PlanSpeechSynthesizeInvocation(SpeechSynthesizeInvocationInput{
		ExactBindings: []InvocationExactBinding{ttsBinding},
		Request: &runtimev1.SpeechSynthesizeScenarioSpec{
			Text: "hello", AudioFormat: "wav", TimingMode: runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_NONE,
		},
	})
	if err != nil || ttsPlan.ModelAssetID() != "catalog/tts-model" || ttsPlan.Request().GetText() != "hello" ||
		ttsPlan.Request().GetTimingMode() != runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_NONE {
		t.Fatalf("TTS plan=%+v error=%v", ttsPlan, err)
	}
	if mode := (Qwen3TTSDriver{}).SpeechStreamMode(); mode != SpeechStreamSimulated {
		t.Fatalf("Qwen3-TTS stream mode=%q", mode)
	}

	audio := []byte("captured-audio")
	asrBinding := InvocationExactBinding{RequirementID: Qwen3ASRModelRequirementID, AssetID: "catalog/asr-model", LocalAssetID: "asr-asset", AbsolutePath: filepath.Join(root, "asr", "model.safetensors"), VerifiedContentID: "sha256:" + digest, EntrySHA256: digest}
	asrPlan, err := (Qwen3ASRDriver{}).PlanSpeechTranscribeInvocation(SpeechTranscribeInvocationInput{
		ExactBindings: []InvocationExactBinding{asrBinding},
		Request:       &runtimev1.SpeechTranscribeScenarioSpec{MimeType: "audio/wav"},
		AudioBytes:    audio,
		MIMEType:      "audio/wav",
	})
	audio[0] = 'X'
	if err != nil || asrPlan.DriverID() != Qwen3ASRDriverID || asrPlan.ModelAssetID() != "catalog/asr-model" || !reflect.DeepEqual(asrPlan.AudioBytes(), []byte("captured-audio")) || asrPlan.MIMEType() != "audio/wav" {
		t.Fatalf("ASR plan=%+v error=%v", asrPlan, err)
	}
	transformersPlan, err := (Qwen3ASRTransformersDriver{}).PlanSpeechTranscribeInvocation(SpeechTranscribeInvocationInput{
		ExactBindings: []InvocationExactBinding{asrBinding},
		Request:       &runtimev1.SpeechTranscribeScenarioSpec{MimeType: "audio/wav"},
		AudioBytes:    []byte("captured-audio"),
		MIMEType:      "audio/wav",
	})
	if err != nil || transformersPlan.DriverID() != Qwen3ASRTransformersDriverID {
		t.Fatalf("Transformers ASR plan=%+v error=%v", transformersPlan, err)
	}
}

func TestQwen3SpeechDriversFailClosedOnUnimplementedOptions(t *testing.T) {
	digest := strings.Repeat("c", 64)
	root := t.TempDir()
	ttsBinding := InvocationExactBinding{RequirementID: Qwen3TTSModelRequirementID, AssetID: "catalog/tts", LocalAssetID: "tts", AbsolutePath: filepath.Join(root, "tts.safetensors"), VerifiedContentID: "sha256:" + digest, EntrySHA256: digest}
	_, err := (Qwen3TTSDriver{}).PlanSpeechSynthesizeInvocation(SpeechSynthesizeInvocationInput{
		ExactBindings: []InvocationExactBinding{ttsBinding},
		Request:       &runtimev1.SpeechSynthesizeScenarioSpec{Text: "hello", Speed: testFloat32(1)},
	})
	if invocation, ok := err.(*InvocationError); !ok || invocation.Kind != InvocationFailureUnsupported {
		t.Fatalf("TTS option error=%T %v", err, err)
	}
	_, err = (Qwen3TTSDriver{}).PlanSpeechSynthesizeInvocation(SpeechSynthesizeInvocationInput{
		ExactBindings: []InvocationExactBinding{ttsBinding},
		Request: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "hello", VoiceRef: &runtimev1.VoiceReference{
			Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_VOICE_ASSET,
			Reference: &runtimev1.VoiceReference_VoiceAssetId{
				VoiceAssetId: "voice-asset-1",
			},
		}},
	})
	if invocation, ok := err.(*InvocationError); !ok || invocation.Kind != InvocationFailureUnsupported {
		t.Fatalf("TTS voice asset error=%T %v", err, err)
	}
	_, err = (Qwen3ASRDriver{}).PlanSpeechTranscribeInvocation(SpeechTranscribeInvocationInput{
		ExactBindings: []InvocationExactBinding{{RequirementID: Qwen3ASRModelRequirementID, AssetID: "catalog/asr", LocalAssetID: "asr", AbsolutePath: filepath.Join(root, "asr.safetensors"), VerifiedContentID: "sha256:" + digest, EntrySHA256: digest}},
		Request:       &runtimev1.SpeechTranscribeScenarioSpec{Diarization: testBool(true)},
		AudioBytes:    []byte("audio"),
	})
	if invocation, ok := err.(*InvocationError); !ok || invocation.Kind != InvocationFailureUnsupported {
		t.Fatalf("ASR option error=%T %v", err, err)
	}
}

func TestQwen3ASRDriversRejectJSONResponseFormat(t *testing.T) {
	digest := strings.Repeat("d", 64)
	binding := InvocationExactBinding{
		RequirementID:     Qwen3ASRModelRequirementID,
		AssetID:           "catalog/asr",
		LocalAssetID:      "asr",
		AbsolutePath:      filepath.Join(t.TempDir(), "asr.safetensors"),
		VerifiedContentID: "sha256:" + digest,
		EntrySHA256:       digest,
	}
	for _, test := range []struct {
		name string
		plan func(SpeechTranscribeInvocationInput) (*SpeechTranscribeInvocationPlan, error)
	}{
		{name: "package-native", plan: (Qwen3ASRDriver{}).PlanSpeechTranscribeInvocation},
		{name: "transformers-native", plan: (Qwen3ASRTransformersDriver{}).PlanSpeechTranscribeInvocation},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := test.plan(SpeechTranscribeInvocationInput{
				ExactBindings: []InvocationExactBinding{binding},
				Request:       &runtimev1.SpeechTranscribeScenarioSpec{ResponseFormat: "json"},
				AudioBytes:    []byte("audio"),
			})
			if invocation, ok := err.(*InvocationError); !ok || invocation.Kind != InvocationFailureUnsupported {
				t.Fatalf("JSON response format error=%T %v", err, err)
			}
		})
	}
}

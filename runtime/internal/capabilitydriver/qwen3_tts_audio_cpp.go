package capabilitydriver

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"path/filepath"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	Qwen3TTSAudioCppImplementationID   = "local.audio.synthesize.qwen3-tts.audio-cpp"
	Qwen3TTSAudioCppDriverID           = "nimi.runtime.driver.audio-cpp.qwen3-tts"
	Qwen3TTSAudioCppDriverDialect      = "audio.cpp/qwen3-tts-customvoice/audio-synthesize/v1"
	Qwen3TTSAudioCppRecipeID           = "qwen3-tts-customvoice.audio-cpp.v1"
	Qwen3TTSAudioCppModelRequirementID = "tts.model"
	Qwen3TTSAudioCppModelRelativePath  = "Qwen3-TTS-12Hz-1.7B-CustomVoice-GGUF/qwen3-tts-12hz-1.7b-customvoice-q8_0.gguf"
	Qwen3TTSAudioCppModelSizeBytes     = int64(2817044064)
	Qwen3TTSAudioCppVerifiedContentID  = "sha256:3cfaac8e9f13554f6daea3c5e0c53fede71ef5500cbaae7445e5fc3a5bb12e72"
	Qwen3TTSAudioCppPresetVoiceVivian  = "Vivian"
	AudioCppWindowsCUDA13PackageID     = "audio-cpp-0.6.1-windows-amd64-cuda13-balance"
	AudioCppCUDA13RuntimeDependencyID  = "nvidia-cuda13-user-space-runtime"
	qwen3TTSAudioCppExpectedSampleRate = 24000
	qwen3TTSAudioCppExpectedChannels   = 1
	qwen3TTSAudioCppExpectedBits       = 16
)

var qwen3TTSAudioCppLanguages = []string{"de", "en", "es", "fr", "it", "ja", "ko", "pt", "ru", "zh"}

type Qwen3TTSAudioCppInvocationInput struct {
	LoadoutID      string
	RecipeID       string
	PortableConfig *structpb.Struct
	ExactBindings  []InvocationExactBinding
	Package        AudioCppRuntimePackageInput
	Request        *runtimev1.SpeechSynthesizeScenarioSpec
	StagingWAVPath string
}

// Qwen3TTSAudioCppInvocationPlan is the closed immutable CustomVoice CLI plan.
// It is intentionally distinct from MusicInvocationPlan and the Python speech
// plan; no generic audio option map or Engine selector is present.
type Qwen3TTSAudioCppInvocationPlan struct {
	processKey                     string
	loadoutID                      string
	modelBinding                   InvocationExactBinding
	modelPath                      string
	audioCppPackageID              string
	audioCppSelectedSourceRecordID string
	audioCppRoot                   string
	audioCppExecutablePath         string
	cuda13DependencyID             string
	cuda13SelectedSourceRecordID   string
	cuda13Root                     string
	text                           string
	speaker                        string
	language                       string
	doSample                       bool
	temperature                    float64
	topK                           int
	topP                           float64
	repetitionPenalty              float64
	maxTokens                      int
	textChunkSize                  int
	seed                           uint64
	memorySaver                    bool
	stagingWAVPath                 string
}

func (p *Qwen3TTSAudioCppInvocationPlan) DriverID() string {
	if p == nil {
		return ""
	}
	return Qwen3TTSAudioCppDriverID
}
func (p *Qwen3TTSAudioCppInvocationPlan) ProcessKey() string {
	if p == nil {
		return ""
	}
	return p.processKey
}
func (p *Qwen3TTSAudioCppInvocationPlan) LoadoutID() string {
	if p == nil {
		return ""
	}
	return p.loadoutID
}
func (p *Qwen3TTSAudioCppInvocationPlan) ModelAssetID() string {
	if p == nil {
		return ""
	}
	return p.modelBinding.ModelAssetID
}
func (p *Qwen3TTSAudioCppInvocationPlan) ModelFiles() []InvocationExactBinding {
	if p == nil {
		return nil
	}
	return cloneInvocationExactBindings([]InvocationExactBinding{p.modelBinding})
}
func (p *Qwen3TTSAudioCppInvocationPlan) ModelPath() string {
	if p == nil {
		return ""
	}
	return p.modelPath
}
func (p *Qwen3TTSAudioCppInvocationPlan) AudioCppPackageID() string {
	if p == nil {
		return ""
	}
	return p.audioCppPackageID
}
func (p *Qwen3TTSAudioCppInvocationPlan) AudioCppSelectedSourceRecordID() string {
	if p == nil {
		return ""
	}
	return p.audioCppSelectedSourceRecordID
}
func (p *Qwen3TTSAudioCppInvocationPlan) AudioCppRoot() string {
	if p == nil {
		return ""
	}
	return p.audioCppRoot
}
func (p *Qwen3TTSAudioCppInvocationPlan) AudioCppExecutablePath() string {
	if p == nil {
		return ""
	}
	return p.audioCppExecutablePath
}
func (p *Qwen3TTSAudioCppInvocationPlan) CUDA13DependencyID() string {
	if p == nil {
		return ""
	}
	return p.cuda13DependencyID
}
func (p *Qwen3TTSAudioCppInvocationPlan) CUDA13SelectedSourceRecordID() string {
	if p == nil {
		return ""
	}
	return p.cuda13SelectedSourceRecordID
}
func (p *Qwen3TTSAudioCppInvocationPlan) CUDA13Root() string {
	if p == nil {
		return ""
	}
	return p.cuda13Root
}
func (p *Qwen3TTSAudioCppInvocationPlan) Text() string {
	if p == nil {
		return ""
	}
	return p.text
}
func (p *Qwen3TTSAudioCppInvocationPlan) Speaker() string {
	if p == nil {
		return ""
	}
	return p.speaker
}
func (p *Qwen3TTSAudioCppInvocationPlan) Language() string {
	if p == nil {
		return ""
	}
	return p.language
}
func (p *Qwen3TTSAudioCppInvocationPlan) Sampling() (bool, float64, int, float64, float64) {
	if p == nil {
		return false, 0, 0, 0, 0
	}
	return p.doSample, p.temperature, p.topK, p.topP, p.repetitionPenalty
}
func (p *Qwen3TTSAudioCppInvocationPlan) MaxTokens() int {
	if p == nil {
		return 0
	}
	return p.maxTokens
}
func (p *Qwen3TTSAudioCppInvocationPlan) TextChunkSize() int {
	if p == nil {
		return 0
	}
	return p.textChunkSize
}
func (p *Qwen3TTSAudioCppInvocationPlan) Seed() uint64 {
	if p == nil {
		return 0
	}
	return p.seed
}
func (p *Qwen3TTSAudioCppInvocationPlan) MemorySaver() bool { return p != nil && p.memorySaver }
func (p *Qwen3TTSAudioCppInvocationPlan) StagingWAVPath() string {
	if p == nil {
		return ""
	}
	return p.stagingWAVPath
}
func (p *Qwen3TTSAudioCppInvocationPlan) ExpectedWAVFormat() (int, int, int) {
	return qwen3TTSAudioCppExpectedSampleRate, qwen3TTSAudioCppExpectedChannels, qwen3TTSAudioCppExpectedBits
}
func (p *Qwen3TTSAudioCppInvocationPlan) Request() *runtimev1.SpeechSynthesizeScenarioSpec {
	if p == nil {
		return nil
	}
	return &runtimev1.SpeechSynthesizeScenarioSpec{Text: p.text, VoiceRef: &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET, Reference: &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: p.speaker}}, Language: p.language, AudioFormat: "wav"}
}

type Qwen3TTSAudioCppInvocationDriver interface {
	SpeechPresetVoiceDriver
	PlanQwen3TTSAudioCppInvocation(Qwen3TTSAudioCppInvocationInput) (*Qwen3TTSAudioCppInvocationPlan, error)
	SpeechStreamMode() SpeechStreamMode
}

type Qwen3TTSAudioCppDriver struct{}

func (Qwen3TTSAudioCppDriver) EffectiveRequestDefaults(string, *structpb.Struct) map[string]string {
	return nil
}
func (Qwen3TTSAudioCppDriver) SpeechStreamMode() SpeechStreamMode { return SpeechStreamUnsupported }
func (Qwen3TTSAudioCppDriver) ListPresetVoices(bindings []InvocationExactBinding) ([]SpeechPresetVoice, error) {
	if len(bindings) != 1 || bindings[0].RequirementID != Qwen3TTSAudioCppModelRequirementID || bindings[0].VerifiedContentID != Qwen3TTSAudioCppVerifiedContentID || len(bindings[0].DeclaredFiles) != 1 || bindings[0].DeclaredFiles[0] != Qwen3TTSAudioCppModelRelativePath {
		return nil, invocationError(InvocationFailureInvalidBinding, fmt.Errorf("Qwen3-TTS audio.cpp preset catalog requires the exact GGUF binding"))
	}
	return []SpeechPresetVoice{{VoiceID: Qwen3TTSAudioCppPresetVoiceVivian, Name: Qwen3TTSAudioCppPresetVoiceVivian, SupportedLangs: append([]string(nil), qwen3TTSAudioCppLanguages...)}}, nil
}
func (Qwen3TTSAudioCppDriver) Interpret(input InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if input.RecipeID != Qwen3TTSAudioCppRecipeID || !emptySpeechPortableConfig(input.PortableConfig) {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	if len(input.SupportedFeatures) != 0 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED
	}
	constraints, _ := structpb.NewStruct(map[string]any{"engine": "audio-cpp", "model_family": "qwen3-tts-customvoice", "artifact_role": "tts_model", "format": "gguf"})
	return []*runtimev1.LocalCapabilityRequirement{{RequirementId: Qwen3TTSAudioCppModelRequirementID, Role: runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN, ResourceKind: "tts", Policy: runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_STRICT, CompatibilityConstraints: constraints, DisplayLabel: "Qwen3-TTS CustomVoice 1.7B Q8_0 GGUF"}}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}
func (d Qwen3TTSAudioCppDriver) ProjectRecipe(recipeID string, options *structpb.Struct, features []string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	return d.Interpret(InterpretInput{RecipeID: recipeID, PortableConfig: options, SupportedFeatures: features})
}
func (d Qwen3TTSAudioCppDriver) ProjectModelAssetBinding(input ModelAssetBindingInput) (ModelAssetBindingProjection, runtimev1.LocalCapabilityReason) {
	if input.Requirement == nil || input.Binding == nil || input.Requirement.GetRequirementId() != Qwen3TTSAudioCppModelRequirementID || input.Binding.GetRequirementId() != Qwen3TTSAudioCppModelRequirementID || input.Binding.GetVerifiedContentId() != Qwen3TTSAudioCppVerifiedContentID || len(input.Files) != 1 {
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_MISMATCH
	}
	file := input.Files[0]
	if file.RelativePath != Qwen3TTSAudioCppModelRelativePath || file.SizeBytes != Qwen3TTSAudioCppModelSizeBytes || !qwen3TTSAudioCppGGUFProbe(file.FormatProbe) {
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	descriptor := ModelAssetDescriptor{Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_TTS, Family: "qwen3-tts-customvoice", Engine: "audio-cpp", ArtifactRoles: []string{"tts_model"}, FormatProbe: append([]byte(nil), file.FormatProbe...)}
	return validatedModelAssetBindingProjection(input, descriptor, 5000, d.ValidateBinding)
}
func (Qwen3TTSAudioCppDriver) ValidateBinding(requirement *runtimev1.LocalCapabilityRequirement, binding *runtimev1.ModelAssetExactBinding, asset ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if requirement == nil || binding == nil || requirement.GetRequirementId() != Qwen3TTSAudioCppModelRequirementID || binding.GetRequirementId() != Qwen3TTSAudioCppModelRequirementID || binding.GetVerifiedContentId() != Qwen3TTSAudioCppVerifiedContentID || asset.Kind != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_TTS || asset.Family != "qwen3-tts-customvoice" || asset.Engine != "audio-cpp" || !contains(asset.ArtifactRoles, "tts_model") || !qwen3TTSAudioCppGGUFProbe(asset.FormatProbe) {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}
func (d Qwen3TTSAudioCppDriver) ValidateCombination(requirements []*runtimev1.LocalCapabilityRequirement, bindings []*runtimev1.ModelAssetExactBinding, assets []ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if len(requirements) != 1 || len(bindings) != 1 || len(assets) != 1 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	return d.ValidateBinding(requirements[0], bindings[0], assets[0])
}
func (Qwen3TTSAudioCppDriver) PlanQwen3TTSAudioCppInvocation(input Qwen3TTSAudioCppInvocationInput) (*Qwen3TTSAudioCppInvocationPlan, error) {
	if input.RecipeID != Qwen3TTSAudioCppRecipeID || !emptySpeechPortableConfig(input.PortableConfig) {
		return nil, invocationError(InvocationFailureInvalidConfig, fmt.Errorf("Qwen3-TTS audio.cpp recipe or portable config is invalid"))
	}
	if len(input.ExactBindings) != 1 {
		return nil, invocationError(InvocationFailureInvalidBinding, fmt.Errorf("Qwen3-TTS audio.cpp requires one exact GGUF"))
	}
	binding := cloneInvocationExactBindings(input.ExactBindings)[0]
	if binding.RequirementID != Qwen3TTSAudioCppModelRequirementID || binding.VerifiedContentID != Qwen3TTSAudioCppVerifiedContentID || len(binding.DeclaredFiles) != 1 || binding.DeclaredFiles[0] != Qwen3TTSAudioCppModelRelativePath || !filepath.IsAbs(binding.AbsolutePath) || !strings.EqualFold(filepath.Base(binding.AbsolutePath), filepath.Base(Qwen3TTSAudioCppModelRelativePath)) {
		return nil, invocationError(InvocationFailureInvalidBinding, fmt.Errorf("Qwen3-TTS audio.cpp GGUF binding is invalid"))
	}
	request, err := validateQwen3TTSAudioCppRequest(input.Request)
	if err != nil {
		return nil, err
	}
	if err := validateQwen3TTSAudioCppPackage(input.Package); err != nil {
		return nil, invocationError(InvocationFailureInvalidConfig, err)
	}
	staging := strings.TrimSpace(input.StagingWAVPath)
	if !filepath.IsAbs(staging) || !strings.EqualFold(filepath.Ext(staging), ".wav") {
		return nil, invocationError(InvocationFailureInvalidConfig, fmt.Errorf("Qwen3-TTS audio.cpp staging WAV path is invalid"))
	}
	hasher := sha256.New()
	for _, value := range append(invocationExactBindingIdentity(binding), input.Package.AudioCppPackageID, input.Package.AudioCppSelectedSourceRecordID, input.Package.CUDA13DependencyID, input.Package.CUDA13SelectedSourceRecordID, Qwen3TTSAudioCppDriverDialect) {
		_, _ = hasher.Write([]byte(value))
		_, _ = hasher.Write([]byte{0})
	}
	return &Qwen3TTSAudioCppInvocationPlan{processKey: hex.EncodeToString(hasher.Sum(nil)), loadoutID: strings.TrimSpace(input.LoadoutID), modelBinding: binding, modelPath: filepath.Clean(binding.AbsolutePath), audioCppPackageID: input.Package.AudioCppPackageID, audioCppSelectedSourceRecordID: input.Package.AudioCppSelectedSourceRecordID, audioCppRoot: filepath.Clean(input.Package.AudioCppRoot), audioCppExecutablePath: filepath.Clean(input.Package.AudioCppExecutablePath), cuda13DependencyID: input.Package.CUDA13DependencyID, cuda13SelectedSourceRecordID: input.Package.CUDA13SelectedSourceRecordID, cuda13Root: filepath.Clean(input.Package.CUDA13Root), text: request.GetText(), speaker: request.GetVoiceRef().GetPresetVoiceId(), language: request.GetLanguage(), doSample: true, temperature: 0.9, topK: 50, topP: 1.0, repetitionPenalty: 1.05, maxTokens: 8192, textChunkSize: 8192, seed: 0, memorySaver: true, stagingWAVPath: filepath.Clean(staging)}, nil
}

func validateQwen3TTSAudioCppRequest(value *runtimev1.SpeechSynthesizeScenarioSpec) (*runtimev1.SpeechSynthesizeScenarioSpec, error) {
	request, _ := proto.Clone(value).(*runtimev1.SpeechSynthesizeScenarioSpec)
	if request == nil || strings.TrimSpace(request.GetText()) == "" {
		return nil, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("Qwen3-TTS audio.cpp text is required"))
	}
	if format := strings.ToLower(strings.TrimSpace(request.GetAudioFormat())); format != "" && format != "wav" && format != "wave" {
		return nil, invocationError(InvocationFailureUnsupported, fmt.Errorf("Qwen3-TTS audio.cpp supports only WAV"))
	}
	ref := request.GetVoiceRef()
	if ref == nil || ref.GetKind() != runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET || ref.GetPresetVoiceId() != Qwen3TTSAudioCppPresetVoiceVivian {
		return nil, invocationError(InvocationFailureUnsupported, fmt.Errorf("Qwen3-TTS audio.cpp requires the exact Vivian preset"))
	}
	if request.SampleRateHz != nil || request.Speed != nil || request.Pitch != nil || request.Volume != nil || (request.GetTimingMode() != runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_UNSPECIFIED && request.GetTimingMode() != runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_NONE) || request.GetVoiceRenderHints() != nil {
		return nil, invocationError(InvocationFailureUnsupported, fmt.Errorf("Qwen3-TTS audio.cpp request contains unsupported synthesis options"))
	}
	if language := strings.TrimSpace(request.GetLanguage()); language != "" && !contains(qwen3TTSAudioCppLanguages, language) {
		return nil, invocationError(InvocationFailureUnsupported, fmt.Errorf("Qwen3-TTS audio.cpp language is unsupported"))
	}
	return request, nil
}

func validateQwen3TTSAudioCppPackage(input AudioCppRuntimePackageInput) error {
	if input.AudioCppPackageID != AudioCppWindowsCUDA13PackageID || input.CUDA13DependencyID != AudioCppCUDA13RuntimeDependencyID || strings.TrimSpace(input.AudioCppSelectedSourceRecordID) == "" || strings.TrimSpace(input.CUDA13SelectedSourceRecordID) == "" || !filepath.IsAbs(input.AudioCppRoot) || !filepath.IsAbs(input.AudioCppExecutablePath) || !filepath.IsAbs(input.CUDA13Root) || !musicPathWithin(input.AudioCppRoot, input.AudioCppExecutablePath) || !strings.EqualFold(filepath.Base(input.AudioCppExecutablePath), "audiocpp_cli.exe") {
		return fmt.Errorf("Qwen3-TTS audio.cpp package selected-source composition is incomplete")
	}
	return nil
}

func qwen3TTSAudioCppGGUFProbe(value []byte) bool {
	return len(value) >= 4 && bytes.Equal(value[:4], []byte("GGUF"))
}

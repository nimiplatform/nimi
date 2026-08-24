// @nimi-authority: rule.nimi.runtime.local-compute.r073
// @nimi-authority: rule.nimi.runtime.model-catalog.r030

package capabilitydriver

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"path/filepath"
	"strings"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/ggufmeta"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	AudioCppTTSModelRequirementID        = "tts.model"
	AudioCppTTSCodecRequirementID        = "codec.model"
	AudioCppASRModelRequirementID        = "stt.model"
	AudioCppESpeakDependencyID           = "espeak-ng-windows-amd64"
	AudioCppReferenceVoicePrefix         = "audiocpp-reference-v1:"
	AudioCppQwen3TTSBaseImplementationID = "local.audio.synthesize.qwen3-tts-base.audio-cpp"
	audioCppEmbeddedFamilyKey            = "audiocpp.model_spec.family"
	audioCppSpeechExpectedBits           = 16
	audioCppMaxReferenceTextBytes        = 8 << 10
	audioCppMaxRequestTextRunes          = 8192
	audioCppMaxReferenceTextRunes        = 4096
	audioCppMaxTranscriptionWAVSize      = 512 << 20
	audioCppPresetNoArgument             = "@none"
)

type audioCppReferencePolicy uint8

const (
	audioCppReferenceForbidden audioCppReferencePolicy = iota
	audioCppReferenceOptional
	audioCppReferenceRequired
)

type audioCppLanguagePolicy uint8

const (
	audioCppLanguageAny audioCppLanguagePolicy = iota
	audioCppLanguageAutoOnly
	audioCppLanguageFixed
)

type audioCppTTSSpec struct {
	family                      string
	implementationID            string
	displayName                 string
	cliTask                     string
	referencePolicy             audioCppReferencePolicy
	referenceTextRequired       bool
	referenceArgument           string
	presetArgument              string
	defaultPreset               string
	presetVoices                []SpeechPresetVoice
	supportsEmotion             bool
	emotionValues               []string
	speakingRateOption          string
	speakingRateMin             float32
	speakingRateMax             float32
	requiresCodec               bool
	requiresESpeak              bool
	textPrefix                  string
	modelUsesStandaloneDITEntry bool
	requiredFileSizes           map[string]int64
	languages                   []string
}

type audioCppASRSpec struct {
	family          string
	displayName     string
	languagePolicy  audioCppLanguagePolicy
	fixedLanguage   string
	forcedLanguages []string
	supportsPrompt  bool
	fixedChunkMode  string
}

var audioCppTTSSpecs = []audioCppTTSSpec{
	{family: "chatterbox", displayName: "Chatterbox", cliTask: "clon", referencePolicy: audioCppReferenceRequired, referenceArgument: "--voice-ref", languages: []string{"ar", "da", "de", "el", "en", "es", "fi", "fr", "hi", "it", "ko", "ms", "nl", "no", "pl", "pt", "sv", "sw", "tr"}},
	{family: "confucius4_tts", displayName: "Confucius4-TTS", cliTask: "clon", referencePolicy: audioCppReferenceRequired, referenceArgument: "--voice-ref", languages: []string{"zh", "en", "ja", "ko", "de", "fr", "es", "id", "it", "th", "pt", "ru", "ms", "vi"}},
	{family: "dots_tts", displayName: "DotTTS", cliTask: "tts", referencePolicy: audioCppReferenceRequired, referenceArgument: "--voice-ref"},
	{family: "dramabox", displayName: "DramaBox", cliTask: "tts", referencePolicy: audioCppReferenceOptional, referenceArgument: "--voice-ref", languages: []string{"en"}},
	{family: "fish_audio", displayName: "Fish Audio S2 Pro", cliTask: "tts", referencePolicy: audioCppReferenceOptional, referenceArgument: "--voice-ref"},
	{family: "glm_tts", displayName: "GLM-TTS", cliTask: "tts", referencePolicy: audioCppReferenceRequired, referenceTextRequired: true, referenceArgument: "--voice-ref", languages: []string{"zh", "en"}},
	{family: "higgs_audio_tts", displayName: "Higgs Audio v3 TTS", cliTask: "tts", referencePolicy: audioCppReferenceRequired, referenceArgument: "--voice-ref"},
	{family: "index_tts2", displayName: "IndexTTS2", cliTask: "tts", referencePolicy: audioCppReferenceRequired, referenceArgument: "--voice-ref", supportsEmotion: true, languages: []string{"zh", "en", "ja", "es", "ar"}},
	{family: "inflect_v2", displayName: "Inflect Micro v2", cliTask: "tts", referencePolicy: audioCppReferenceForbidden, presetArgument: audioCppPresetNoArgument, defaultPreset: "default", presetVoices: audioCppPresetVoices([]string{"default"}, []string{"en"}), speakingRateOption: "speaking_rate", speakingRateMin: 0.5, speakingRateMax: 2.0, requiresESpeak: true, languages: []string{"en"}},
	{family: "irodori_tts", displayName: "Irodori-TTS", cliTask: "tts", referencePolicy: audioCppReferenceOptional, referenceArgument: "--voice-ref", languages: []string{"ja"}},
	{family: "miotts", displayName: "MioTTS", cliTask: "tts", referencePolicy: audioCppReferenceRequired, referenceArgument: "--voice-ref", requiresCodec: true, languages: []string{"en", "ja"}},
	{family: "moss_tts_local", displayName: "MOSS-TTS-Local", cliTask: "tts", referencePolicy: audioCppReferenceOptional, referenceArgument: "--voice-ref", languages: []string{"ar", "cs", "da", "de", "el", "en", "es", "fa", "fi", "fr", "he", "hi", "hu", "it", "ja", "ko", "mk", "ms", "nl", "pl", "pt", "ro", "ru", "sv", "sw", "th", "tl", "tr", "vi", "yue", "zh"}},
	{family: "moss_tts_nano", displayName: "MOSS-TTS-Nano", cliTask: "tts", referencePolicy: audioCppReferenceOptional, referenceArgument: "--voice-ref", languages: []string{"ar", "cs", "da", "de", "el", "en", "es", "fa", "fr", "hu", "it", "ja", "ko", "pl", "pt", "ru", "sv", "tr", "zh"}},
	{family: "minimax_h3", displayName: "MiniMax-H3 Dialogue", cliTask: "gen", referencePolicy: audioCppReferenceForbidden, presetArgument: audioCppPresetNoArgument, defaultPreset: "default", presetVoices: audioCppPresetVoices([]string{"default"}, nil), modelUsesStandaloneDITEntry: true, requiredFileSizes: map[string]int64{"configuration.json": 34, "FL2VA/processor/chat_template.json": 5499, "FL2VA/processor/merges.txt": 1671839, "FL2VA/processor/preprocessor_config.json": 390, "FL2VA/processor/tokenizer.json": 7032403, "FL2VA/processor/video_preprocessor_config.json": 385, "FL2VA/processor/vocab.json": 2776833, "text_encoder_q4_k.gguf": 15270376000, "dit.gguf": 15502530720, "audio_vae_folded_f16.gguf": 284562816, "video_vae.gguf": 1374245472}, languages: []string{"auto"}},
	{family: "neutts", displayName: "NeuTTS 2E", cliTask: "tts", referencePolicy: audioCppReferenceForbidden, presetArgument: "--voice-id", defaultPreset: "emily", presetVoices: audioCppPresetVoices([]string{"dave", "emily", "greta", "jo", "juliette", "mateo", "paul", "sophie", "steven"}, []string{"en"}), supportsEmotion: true, emotionValues: []string{"angry", "disgusted", "sad", "happy", "fearful", "neutral", "surprised"}, languages: []string{"en"}},
	{family: "omnivoice", displayName: "OmniVoice", cliTask: "tts", referencePolicy: audioCppReferenceRequired, referenceTextRequired: true, referenceArgument: "--voice-ref", speakingRateOption: "speed"},
	{family: "outetts", displayName: "Llama-OuteTTS 1.0", cliTask: "tts", referencePolicy: audioCppReferenceOptional, referenceTextRequired: true, referenceArgument: "--voice-ref", languages: []string{"ar", "be", "bn", "de", "en", "es", "fa", "fr", "hu", "it", "ja", "ka", "ko", "lt", "lv", "nl", "pl", "pt", "ru", "sw", "ta", "uk", "zh"}},
	{family: "pocket_tts", displayName: "PocketTTS English", cliTask: "tts", referencePolicy: audioCppReferenceOptional, referenceArgument: "--voice-ref", presetArgument: "--voice-id", defaultPreset: "alba", presetVoices: audioCppPresetVoices([]string{"alba"}, []string{"en"}), requiredFileSizes: map[string]int64{"embeddings/alba.safetensors": 6194424}, languages: []string{"en"}},
	{family: "qwen3_tts", implementationID: AudioCppQwen3TTSBaseImplementationID, displayName: "Qwen3-TTS Base", cliTask: "tts", referencePolicy: audioCppReferenceRequired, referenceArgument: "--voice-ref", languages: []string{"zh", "en", "ja", "ko", "de", "fr", "ru", "pt", "es", "it"}},
	{family: "supertonic", displayName: "Supertonic 3", cliTask: "tts", referencePolicy: audioCppReferenceForbidden, presetArgument: "--voice-id", defaultPreset: "M1", presetVoices: audioCppPresetVoices([]string{"M1", "M2", "M3", "M4", "M5", "F1", "F2", "F3", "F4", "F5"}, nil), speakingRateOption: "speaking_rate", languages: []string{"en", "ko", "ja", "ar", "bg", "cs", "da", "de", "el", "es", "et", "fi", "fr", "hi", "hr", "hu", "id", "it", "lt", "lv", "nl", "pl", "pt", "ro", "ru", "sk", "sl", "sv", "tr", "uk", "vi"}},
	{family: "vevo2", displayName: "Vevo2", cliTask: "tts", referencePolicy: audioCppReferenceRequired, referenceArgument: "--target-voice", languages: []string{"en", "zh"}},
	{family: "vibevoice", displayName: "VibeVoice 1.5B", cliTask: "tts", referencePolicy: audioCppReferenceRequired, referenceArgument: "voice_samples", textPrefix: "Speaker 1: ", languages: []string{"en", "zh"}},
	{family: "vietneu_tts", displayName: "VieNeu-TTS v3 Turbo", cliTask: "tts", referencePolicy: audioCppReferenceOptional, referenceArgument: "--voice-ref", languages: []string{"vi", "en"}},
	{family: "voxcpm2", displayName: "VoxCPM2 GGUF", cliTask: "tts", referencePolicy: audioCppReferenceOptional, referenceArgument: "--voice-ref", languages: []string{"ar", "my", "zh", "da", "nl", "en", "fi", "fr", "de", "el", "he", "hi", "id", "it", "ja", "km", "ko", "lo", "ms", "no", "pl", "pt", "ru", "es", "sw", "sv", "tl", "th", "tr", "vi"}},
}

var audioCppASRSpecList = []audioCppASRSpec{
	{family: "citrinet_asr", displayName: "Citrinet ASR", languagePolicy: audioCppLanguageFixed, fixedLanguage: "en"},
	{family: "fun_asr_nano", displayName: "Fun-ASR-Nano", forcedLanguages: []string{"auto", "zh", "en", "ja"}, supportsPrompt: true},
	{family: "higgs_audio_stt", displayName: "Higgs Audio v3 STT", languagePolicy: audioCppLanguageFixed, fixedLanguage: "en", supportsPrompt: true},
	{family: "hviske_asr", displayName: "Hviske v5.3", languagePolicy: audioCppLanguageFixed, fixedLanguage: "da"},
	{family: "kroko_asr", displayName: "Kroko ASR English", languagePolicy: audioCppLanguageFixed, fixedLanguage: "en"},
	{family: "nemotron_asr", displayName: "Nemotron 3.5 ASR", languagePolicy: audioCppLanguageAny, forcedLanguages: []string{"auto", "ar-AR", "bg-BG", "cs-CZ", "da-DK", "de-DE", "el-GR", "en-GB", "en-US", "es-ES", "es-US", "et-EE", "fi-FI", "fr-CA", "fr-FR", "he-IL", "hi-IN", "hr-HR", "hu-HU", "it-IT", "ja-JP", "ko-KR", "lt-LT", "lv-LV", "mt-MT", "nb-NO", "nl-NL", "nn-NO", "pl-PL", "pt-BR", "pt-PT", "ro-RO", "ru-RU", "sk-SK", "sl-SI", "sv-SE", "th-TH", "tr-TR", "uk-UA", "vi-VN", "zh-CN"}},
	{family: "parakeet_tdt", displayName: "Parakeet-TDT 0.6B v3", languagePolicy: audioCppLanguageAutoOnly},
	{family: "qwen3_asr", displayName: "Qwen3-ASR 1.7B", languagePolicy: audioCppLanguageAny, forcedLanguages: []string{"auto", "zh", "en", "yue", "ar", "de", "fr", "es", "pt", "id", "it", "ko", "ru", "th", "vi", "ja", "tr", "hi", "ms", "nl", "sv", "da", "fi", "pl", "cs", "fil", "fa", "el", "hu", "mk", "ro"}, supportsPrompt: true},
	{family: "sense_asr", displayName: "SenseVoice Small", forcedLanguages: []string{"auto", "zh", "en", "yue", "ja", "ko", "nospeech"}, fixedChunkMode: "none"},
	{family: "vibevoice_asr", displayName: "VibeVoice ASR", languagePolicy: audioCppLanguageAutoOnly, supportsPrompt: true},
	{family: "voxtral_realtime", displayName: "Voxtral Mini 4B Realtime", languagePolicy: audioCppLanguageAutoOnly},
}

func audioCppPresetVoices(ids []string, languages []string) []SpeechPresetVoice {
	voices := make([]SpeechPresetVoice, 0, len(ids))
	for _, id := range ids {
		voices = append(voices, SpeechPresetVoice{VoiceID: id, Name: id, SupportedLangs: append([]string(nil), languages...)})
	}
	return voices
}

// AudioCppSpeechRegistration is one exact public implementation line backed
// by the shared physical audio.cpp package. Family selection never comes from
// request or portable configuration.
type AudioCppSpeechRegistration struct {
	CapabilityContract string
	RecipeID           string
	ConsumerID         string
	Family             string
	DisplayName        string
	Identity           Identity
}

func AudioCppSpeechRegistrations() []AudioCppSpeechRegistration {
	registrations := make([]AudioCppSpeechRegistration, 0, len(audioCppTTSSpecs)+len(audioCppASRSpecList))
	for _, spec := range audioCppTTSSpecs {
		registrations = append(registrations, audioCppTTSRegistration(spec))
	}
	for _, spec := range audioCppASRSpecList {
		registrations = append(registrations, audioCppASRRegistration(spec))
	}
	return registrations
}

func AudioCppSpeechConsumerID(capabilityContract string, identity Identity) (string, bool) {
	registrations := append(AudioCppSpeechRegistrations(), AudioCppReferenceVoiceRegistrations()...)
	for _, registration := range registrations {
		if registration.CapabilityContract == capabilityContract && registration.Identity == identity {
			return registration.ConsumerID, true
		}
	}
	return "", false
}

func AudioCppReferenceVoiceRegistrations() []AudioCppSpeechRegistration {
	registrations := make([]AudioCppSpeechRegistration, 0, len(audioCppTTSSpecs))
	for _, spec := range audioCppTTSSpecs {
		if spec.referencePolicy == audioCppReferenceForbidden {
			continue
		}
		name := strings.ReplaceAll(spec.family, "_", "-")
		registrations = append(registrations, AudioCppSpeechRegistration{
			CapabilityContract: VoiceCreateContract,
			RecipeID:           name + ".audio-cpp.reference-voice.v1",
			ConsumerID:         "audio.cpp." + name + ".voice.cuda",
			Family:             spec.family,
			DisplayName:        spec.displayName + " reference voice",
			Identity: Identity{
				ImplementationID: "local.voice.create." + name + ".audio-cpp-reference",
				DriverID:         "nimi.runtime.driver.audio-cpp." + name + ".voice-reference",
				DriverDialect:    "audio.cpp/" + spec.family + "/voice-reference-create/v1",
			},
		})
	}
	return registrations
}

func audioCppTTSRegistration(spec audioCppTTSSpec) AudioCppSpeechRegistration {
	name := strings.ReplaceAll(spec.family, "_", "-")
	implementationID := strings.TrimSpace(spec.implementationID)
	if implementationID == "" {
		implementationID = "local.audio.synthesize." + name + ".audio-cpp"
	}
	return AudioCppSpeechRegistration{
		CapabilityContract: AudioSynthesizeContract,
		RecipeID:           name + ".audio-cpp.synthesize.v1",
		ConsumerID:         "audio.cpp." + name + ".tts.cuda",
		Family:             spec.family,
		DisplayName:        spec.displayName,
		Identity: Identity{
			ImplementationID: implementationID,
			DriverID:         "nimi.runtime.driver.audio-cpp." + name + ".tts",
			DriverDialect:    "audio.cpp/" + spec.family + "/audio-synthesize/v1",
		},
	}
}

func audioCppASRRegistration(spec audioCppASRSpec) AudioCppSpeechRegistration {
	name := strings.ReplaceAll(spec.family, "_", "-")
	return AudioCppSpeechRegistration{
		CapabilityContract: AudioTranscribeContract,
		RecipeID:           name + ".audio-cpp.transcribe.v1",
		ConsumerID:         "audio.cpp." + name + ".asr.cuda",
		Family:             spec.family,
		DisplayName:        spec.displayName,
		Identity: Identity{
			ImplementationID: "local.audio.transcribe." + name + ".audio-cpp",
			DriverID:         "nimi.runtime.driver.audio-cpp." + name + ".asr",
			DriverDialect:    "audio.cpp/" + spec.family + "/audio-transcribe/v1",
		},
	}
}

func audioCppSpeechProductionDrivers() map[RegistrationKey]Driver {
	drivers := make(map[RegistrationKey]Driver, len(audioCppTTSSpecs)*2+len(audioCppASRSpecList))
	for _, spec := range audioCppTTSSpecs {
		registration := audioCppTTSRegistration(spec)
		drivers[RegistrationKey{CapabilityContract: registration.CapabilityContract, Identity: registration.Identity}] = AudioCppTTSDriver{spec: spec}
	}
	for _, spec := range audioCppASRSpecList {
		registration := audioCppASRRegistration(spec)
		drivers[RegistrationKey{CapabilityContract: registration.CapabilityContract, Identity: registration.Identity}] = AudioCppASRDriver{spec: spec}
	}
	for _, spec := range audioCppTTSSpecs {
		if spec.referencePolicy == audioCppReferenceForbidden {
			continue
		}
		driver := AudioCppReferenceVoiceDriver{spec: spec}
		registration := driver.AudioCppSpeechRegistration()
		drivers[RegistrationKey{CapabilityContract: registration.CapabilityContract, Identity: registration.Identity}] = driver
	}
	return drivers
}

type AudioCppReferenceVoiceInput struct {
	ProviderVoiceRef string
	WAVPath          string
	WAVBytes         []byte
	MIMEType         string
	ReferenceText    string
}

type AudioCppSpeechRuntimeInput struct {
	Package                      AudioCppRuntimePackageInput
	ESpeakSelectedSourceRecordID string
	ESpeakLibraryPath            string
	ESpeakDataPath               string
}

type AudioCppTTSSynthesizeInvocationInput struct {
	LoadoutID      string
	RecipeID       string
	PortableConfig *structpb.Struct
	ExactBindings  []InvocationExactBinding
	Runtime        AudioCppSpeechRuntimeInput
	ReferenceVoice *AudioCppReferenceVoiceInput
	Request        *runtimev1.SpeechSynthesizeScenarioSpec
	StagingWAVPath string
}

type AudioCppASRTranscribeInvocationInput struct {
	LoadoutID          string
	RecipeID           string
	PortableConfig     *structpb.Struct
	ExactBindings      []InvocationExactBinding
	Runtime            AudioCppSpeechRuntimeInput
	Request            *runtimev1.SpeechTranscribeScenarioSpec
	AudioBytes         []byte
	MIMEType           string
	StagingAudioPath   string
	StagingTextOutPath string
}

type AudioCppTTSSynthesizeInvocationDriver interface {
	SpeechPresetVoiceDriver
	PlanAudioCppTTSSynthesis(AudioCppTTSSynthesizeInvocationInput) (*AudioCppTTSSynthesizePlan, error)
	SpeechStreamMode() SpeechStreamMode
}

type AudioCppASRTranscribeInvocationDriver interface {
	Driver
	PlanAudioCppASRTranscription(AudioCppASRTranscribeInvocationInput) (*AudioCppASRTranscribePlan, error)
}

type AudioCppSpeechRegisteredDriver interface {
	Driver
	AudioCppSpeechRegistration() AudioCppSpeechRegistration
}

type AudioCppTTSSynthesizePlan struct {
	processKey                     string
	loadoutID                      string
	driverID                       string
	family                         string
	modelAssetID                   string
	modelFiles                     []InvocationExactBinding
	request                        *runtimev1.SpeechSynthesizeScenarioSpec
	cliArgs                        []string
	audioCppPackageID              string
	audioCppSelectedSourceRecordID string
	audioCppRoot                   string
	audioCppExecutablePath         string
	cuda13DependencyID             string
	cuda13SelectedSourceRecordID   string
	cuda13Root                     string
	stagingWAVPath                 string
	referenceWAVPath               string
	referenceWAVBytes              []byte
	referenceText                  string
}

func (p *AudioCppTTSSynthesizePlan) DriverID() string {
	if p == nil {
		return ""
	}
	return p.driverID
}
func (p *AudioCppTTSSynthesizePlan) ProcessKey() string {
	if p == nil {
		return ""
	}
	return p.processKey
}
func (p *AudioCppTTSSynthesizePlan) LoadoutID() string {
	if p == nil {
		return ""
	}
	return p.loadoutID
}
func (p *AudioCppTTSSynthesizePlan) Family() string {
	if p == nil {
		return ""
	}
	return p.family
}
func (p *AudioCppTTSSynthesizePlan) ModelAssetID() string {
	if p == nil {
		return ""
	}
	return p.modelAssetID
}
func (p *AudioCppTTSSynthesizePlan) ModelFiles() []InvocationExactBinding {
	if p == nil {
		return nil
	}
	return cloneInvocationExactBindings(p.modelFiles)
}
func (p *AudioCppTTSSynthesizePlan) Request() *runtimev1.SpeechSynthesizeScenarioSpec {
	if p == nil {
		return nil
	}
	value, _ := proto.Clone(p.request).(*runtimev1.SpeechSynthesizeScenarioSpec)
	return value
}
func (p *AudioCppTTSSynthesizePlan) CLIArgs() []string {
	if p == nil {
		return nil
	}
	return append([]string(nil), p.cliArgs...)
}
func (p *AudioCppTTSSynthesizePlan) AudioCppPackageID() string {
	if p == nil {
		return ""
	}
	return p.audioCppPackageID
}
func (p *AudioCppTTSSynthesizePlan) AudioCppSelectedSourceRecordID() string {
	if p == nil {
		return ""
	}
	return p.audioCppSelectedSourceRecordID
}
func (p *AudioCppTTSSynthesizePlan) AudioCppRoot() string {
	if p == nil {
		return ""
	}
	return p.audioCppRoot
}
func (p *AudioCppTTSSynthesizePlan) AudioCppExecutablePath() string {
	if p == nil {
		return ""
	}
	return p.audioCppExecutablePath
}
func (p *AudioCppTTSSynthesizePlan) CUDA13DependencyID() string {
	if p == nil {
		return ""
	}
	return p.cuda13DependencyID
}
func (p *AudioCppTTSSynthesizePlan) CUDA13SelectedSourceRecordID() string {
	if p == nil {
		return ""
	}
	return p.cuda13SelectedSourceRecordID
}
func (p *AudioCppTTSSynthesizePlan) CUDA13Root() string {
	if p == nil {
		return ""
	}
	return p.cuda13Root
}
func (p *AudioCppTTSSynthesizePlan) StagingWAVPath() string {
	if p == nil {
		return ""
	}
	return p.stagingWAVPath
}
func (p *AudioCppTTSSynthesizePlan) ReferenceWAVPath() string {
	if p == nil {
		return ""
	}
	return p.referenceWAVPath
}
func (p *AudioCppTTSSynthesizePlan) ReferenceWAVBytes() []byte {
	if p == nil {
		return nil
	}
	return append([]byte(nil), p.referenceWAVBytes...)
}
func (p *AudioCppTTSSynthesizePlan) ReferenceWAVSizeBytes() int {
	if p == nil {
		return 0
	}
	return len(p.referenceWAVBytes)
}
func (p *AudioCppTTSSynthesizePlan) WriteReferenceWAVTo(writer io.Writer) (int, error) {
	if p == nil || writer == nil {
		return 0, fmt.Errorf("audio.cpp TTS reference writer is unavailable")
	}
	return writer.Write(p.referenceWAVBytes)
}
func (p *AudioCppTTSSynthesizePlan) ReferenceText() string {
	if p == nil {
		return ""
	}
	return p.referenceText
}
func (*AudioCppTTSSynthesizePlan) ExpectedWAVFormat() (int, int, int) {
	return 0, 0, audioCppSpeechExpectedBits
}

type AudioCppASRTranscribePlan struct {
	processKey                     string
	loadoutID                      string
	driverID                       string
	family                         string
	modelAssetID                   string
	modelFiles                     []InvocationExactBinding
	request                        *runtimev1.SpeechTranscribeScenarioSpec
	audioBytes                     []byte
	mimeType                       string
	cliArgs                        []string
	audioCppPackageID              string
	audioCppSelectedSourceRecordID string
	audioCppRoot                   string
	audioCppExecutablePath         string
	cuda13DependencyID             string
	cuda13SelectedSourceRecordID   string
	cuda13Root                     string
	stagingAudioPath               string
	stagingTextOutPath             string
}

func (p *AudioCppASRTranscribePlan) DriverID() string {
	if p == nil {
		return ""
	}
	return p.driverID
}
func (p *AudioCppASRTranscribePlan) ProcessKey() string {
	if p == nil {
		return ""
	}
	return p.processKey
}
func (p *AudioCppASRTranscribePlan) LoadoutID() string {
	if p == nil {
		return ""
	}
	return p.loadoutID
}
func (p *AudioCppASRTranscribePlan) Family() string {
	if p == nil {
		return ""
	}
	return p.family
}
func (p *AudioCppASRTranscribePlan) ModelAssetID() string {
	if p == nil {
		return ""
	}
	return p.modelAssetID
}
func (p *AudioCppASRTranscribePlan) ModelFiles() []InvocationExactBinding {
	if p == nil {
		return nil
	}
	return cloneInvocationExactBindings(p.modelFiles)
}
func (p *AudioCppASRTranscribePlan) Request() *runtimev1.SpeechTranscribeScenarioSpec {
	if p == nil {
		return nil
	}
	value, _ := proto.Clone(p.request).(*runtimev1.SpeechTranscribeScenarioSpec)
	return value
}
func (p *AudioCppASRTranscribePlan) AudioBytes() []byte {
	if p == nil {
		return nil
	}
	return append([]byte(nil), p.audioBytes...)
}
func (p *AudioCppASRTranscribePlan) AudioSizeBytes() int {
	if p == nil {
		return 0
	}
	return len(p.audioBytes)
}
func (p *AudioCppASRTranscribePlan) WriteAudioTo(writer io.Writer) (int, error) {
	if p == nil || writer == nil {
		return 0, fmt.Errorf("audio.cpp ASR audio writer is unavailable")
	}
	return writer.Write(p.audioBytes)
}
func (p *AudioCppASRTranscribePlan) MIMEType() string {
	if p == nil {
		return ""
	}
	return p.mimeType
}
func (p *AudioCppASRTranscribePlan) CLIArgs() []string {
	if p == nil {
		return nil
	}
	return append([]string(nil), p.cliArgs...)
}
func (p *AudioCppASRTranscribePlan) AudioCppPackageID() string {
	if p == nil {
		return ""
	}
	return p.audioCppPackageID
}
func (p *AudioCppASRTranscribePlan) AudioCppSelectedSourceRecordID() string {
	if p == nil {
		return ""
	}
	return p.audioCppSelectedSourceRecordID
}
func (p *AudioCppASRTranscribePlan) AudioCppRoot() string {
	if p == nil {
		return ""
	}
	return p.audioCppRoot
}
func (p *AudioCppASRTranscribePlan) AudioCppExecutablePath() string {
	if p == nil {
		return ""
	}
	return p.audioCppExecutablePath
}
func (p *AudioCppASRTranscribePlan) CUDA13DependencyID() string {
	if p == nil {
		return ""
	}
	return p.cuda13DependencyID
}
func (p *AudioCppASRTranscribePlan) CUDA13SelectedSourceRecordID() string {
	if p == nil {
		return ""
	}
	return p.cuda13SelectedSourceRecordID
}
func (p *AudioCppASRTranscribePlan) CUDA13Root() string {
	if p == nil {
		return ""
	}
	return p.cuda13Root
}
func (p *AudioCppASRTranscribePlan) StagingAudioPath() string {
	if p == nil {
		return ""
	}
	return p.stagingAudioPath
}
func (p *AudioCppASRTranscribePlan) StagingTextOutPath() string {
	if p == nil {
		return ""
	}
	return p.stagingTextOutPath
}

type AudioCppTTSDriver struct{ spec audioCppTTSSpec }
type AudioCppASRDriver struct{ spec audioCppASRSpec }
type AudioCppReferenceVoiceDriver struct{ spec audioCppTTSSpec }

func (AudioCppTTSDriver) EffectiveRequestDefaults(string, *structpb.Struct) map[string]string {
	return nil
}
func (AudioCppASRDriver) EffectiveRequestDefaults(string, *structpb.Struct) map[string]string {
	return nil
}
func (AudioCppReferenceVoiceDriver) EffectiveRequestDefaults(string, *structpb.Struct) map[string]string {
	return nil
}
func (AudioCppTTSDriver) SpeechStreamMode() SpeechStreamMode { return SpeechStreamUnsupported }

func (d AudioCppTTSDriver) registration() AudioCppSpeechRegistration {
	return audioCppTTSRegistration(d.spec)
}
func (d AudioCppASRDriver) registration() AudioCppSpeechRegistration {
	return audioCppASRRegistration(d.spec)
}
func (d AudioCppTTSDriver) AudioCppSpeechRegistration() AudioCppSpeechRegistration {
	return d.registration()
}
func (d AudioCppASRDriver) AudioCppSpeechRegistration() AudioCppSpeechRegistration {
	return d.registration()
}
func (d AudioCppReferenceVoiceDriver) AudioCppSpeechRegistration() AudioCppSpeechRegistration {
	for _, registration := range AudioCppReferenceVoiceRegistrations() {
		if registration.Family == d.spec.family {
			return registration
		}
	}
	return AudioCppSpeechRegistration{}
}

func (d AudioCppTTSDriver) Interpret(input InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	return d.ProjectRecipe(input.RecipeID, input.PortableConfig, input.SupportedFeatures)
}

func (d AudioCppASRDriver) Interpret(input InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	return d.ProjectRecipe(input.RecipeID, input.PortableConfig, input.SupportedFeatures)
}

func (d AudioCppTTSDriver) ProjectRecipe(recipeID string, options *structpb.Struct, features []string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if recipeID != d.registration().RecipeID || !emptySpeechPortableConfig(options) {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	if len(features) != 0 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED
	}
	requirements := []*runtimev1.LocalCapabilityRequirement{audioCppSpeechRequirement(AudioCppTTSModelRequirementID, runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN, "tts", d.spec.family, "tts_model", d.spec.displayName+" GGUF")}
	if d.spec.requiresCodec {
		requirements = append(requirements, audioCppSpeechRequirement(AudioCppTTSCodecRequirementID, runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_COMPANION, "codec", "miocodec", "audio_codec", "MioCodec v2 GGUF"))
	}
	return requirements, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (d AudioCppASRDriver) ProjectRecipe(recipeID string, options *structpb.Struct, features []string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if recipeID != d.registration().RecipeID || !emptySpeechPortableConfig(options) {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	if len(features) != 0 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED
	}
	return []*runtimev1.LocalCapabilityRequirement{audioCppSpeechRequirement(AudioCppASRModelRequirementID, runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN, "stt", d.spec.family, "stt_model", d.spec.displayName+" GGUF")}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (d AudioCppReferenceVoiceDriver) Interpret(input InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	return d.ProjectRecipe(input.RecipeID, input.PortableConfig, input.SupportedFeatures)
}

func (d AudioCppReferenceVoiceDriver) ProjectRecipe(recipeID string, options *structpb.Struct, features []string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	registration := d.AudioCppSpeechRegistration()
	if recipeID != registration.RecipeID || !emptySpeechPortableConfig(options) {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	if len(features) != 1 || features[0] != "input.audio" {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED
	}
	return []*runtimev1.LocalCapabilityRequirement{audioCppSpeechRequirement(AudioCppTTSModelRequirementID, runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN, "tts", d.spec.family, "tts_model", d.spec.displayName+" GGUF")}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (d AudioCppReferenceVoiceDriver) ProjectModelAssetBinding(input ModelAssetBindingInput) (ModelAssetBindingProjection, runtimev1.LocalCapabilityReason) {
	if input.Requirement == nil || input.Requirement.GetRequirementId() != AudioCppTTSModelRequirementID {
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	return projectAudioCppSpeechModelAsset(input, d.spec.family, runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_TTS, "tts_model", d.ValidateBinding)
}

func (d AudioCppReferenceVoiceDriver) ValidateBinding(requirement *runtimev1.LocalCapabilityRequirement, binding *runtimev1.ModelAssetExactBinding, asset ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if requirement == nil || binding == nil || requirement.GetRequirementId() != AudioCppTTSModelRequirementID || binding.GetRequirementId() != AudioCppTTSModelRequirementID || strings.TrimSpace(binding.GetVerifiedContentId()) == "" || asset.Kind != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_TTS || asset.Family != d.spec.family || asset.Engine != "audio-cpp" || !contains(asset.ArtifactRoles, "tts_model") {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	detected, ok := audioCppEmbeddedFamily(asset.FormatProbe)
	if !ok || detected != d.spec.family {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (d AudioCppReferenceVoiceDriver) ValidateCombination(requirements []*runtimev1.LocalCapabilityRequirement, bindings []*runtimev1.ModelAssetExactBinding, assets []ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if len(requirements) != 1 || len(bindings) != 1 || len(assets) != 1 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	return d.ValidateBinding(requirements[0], bindings[0], assets[0])
}

func (d AudioCppReferenceVoiceDriver) PlanVoiceCreateInvocation(input VoiceCreateInvocationInput) (*VoiceCreateInvocationPlan, error) {
	registration := d.AudioCppSpeechRegistration()
	if !emptySpeechPortableConfig(input.PortableConfig) || len(input.SupportedFeatures) != 1 || input.SupportedFeatures[0] != "input.audio" {
		return nil, invocationError(InvocationFailureInvalidConfig, fmt.Errorf("%s reference voice configuration is invalid", d.spec.displayName))
	}
	bindings, err := audioCppInvocationBindings(input.ExactBindings, d.spec.family, AudioCppTTSModelRequirementID, false)
	if err != nil {
		return nil, err
	}
	request, _ := proto.Clone(input.Request).(*runtimev1.VoiceCreateScenarioSpec)
	if request == nil || strings.TrimSpace(request.GetTargetModelId()) != "" || request.GetReferenceAudio() == nil || request.GetTextDescription() != nil {
		return nil, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("%s requires reference-audio voice creation", d.spec.displayName))
	}
	reference := request.GetReferenceAudio()
	mimeType := strings.ToLower(strings.TrimSpace(reference.GetReferenceAudioMime()))
	if strings.TrimSpace(reference.GetReferenceAudioUri()) != "" || len(reference.GetReferenceAudioBytes()) == 0 || len(reference.GetReferenceAudioBytes()) > audioCppMaxTranscriptionWAVSize || (mimeType != "audio/wav" && mimeType != "audio/wave" && mimeType != "audio/x-wav") || !audioCppASRWAVSupported(reference.GetReferenceAudioBytes()) {
		return nil, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("%s reference audio must be a supported WAV", d.spec.displayName))
	}
	referenceText := strings.TrimSpace(reference.GetText())
	if len(referenceText) > audioCppMaxReferenceTextBytes || utf8.RuneCountInString(referenceText) > audioCppMaxReferenceTextRunes || d.spec.referenceTextRequired && referenceText == "" {
		return nil, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("%s reference text is required", d.spec.displayName))
	}
	root := strings.TrimSpace(input.AudioCppReferenceRoot)
	providerRef := strings.TrimSpace(input.AudioCppProviderVoiceRef)
	if !filepath.IsAbs(root) || !validAudioCppReferenceVoiceRef(providerRef) {
		return nil, invocationError(InvocationFailureInvalidConfig, fmt.Errorf("audio.cpp reference voice storage plan is invalid"))
	}
	metadata, err := json.Marshal(map[string]string{"mime_type": mimeType, "reference_text": referenceText})
	if err != nil {
		return nil, invocationError(InvocationFailureInvalidConfig, err)
	}
	main := bindings[AudioCppTTSModelRequirementID]
	return &VoiceCreateInvocationPlan{driverID: registration.Identity.DriverID, modelAssetID: main.ModelAssetID, modelFiles: []InvocationExactBinding{main}, request: request, sourceFeature: "input.audio", workflowModelID: registration.RecipeID, audioCppFamily: d.spec.family, audioCppReferenceRoot: filepath.Clean(root), audioCppProviderVoiceRef: providerRef, audioCppReferenceMetadata: metadata}, nil
}

func validAudioCppReferenceVoiceRef(value string) bool {
	if !strings.HasPrefix(value, AudioCppReferenceVoicePrefix) {
		return false
	}
	id := strings.TrimPrefix(value, AudioCppReferenceVoicePrefix)
	if len(id) < 10 || len(id) > 64 {
		return false
	}
	for _, char := range id {
		if (char < 'a' || char > 'z') && (char < 'A' || char > 'Z') && (char < '0' || char > '9') && char != '-' && char != '_' {
			return false
		}
	}
	return true
}

func audioCppSpeechRequirement(id string, role runtimev1.LocalCapabilityRequirementRole, resourceKind, family, artifactRole, display string) *runtimev1.LocalCapabilityRequirement {
	constraints, _ := structpb.NewStruct(map[string]any{"engine": "audio-cpp", "model_family": family, "artifact_role": artifactRole, "format": "gguf", "gguf_family": family})
	return &runtimev1.LocalCapabilityRequirement{RequirementId: id, Role: role, ResourceKind: resourceKind, Policy: runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_STRICT, CompatibilityConstraints: constraints, DisplayLabel: display}
}

func (d AudioCppTTSDriver) ProjectModelAssetBinding(input ModelAssetBindingInput) (ModelAssetBindingProjection, runtimev1.LocalCapabilityReason) {
	expectedFamily, kind, role, ok := d.bindingContract(input.Requirement.GetRequirementId())
	if !ok {
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	if input.Requirement.GetRequirementId() == AudioCppTTSModelRequirementID && !audioCppRequiredFilesPresent(input.Files, d.spec.requiredFileSizes) {
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	if input.Requirement.GetRequirementId() == AudioCppTTSModelRequirementID && d.spec.modelUsesStandaloneDITEntry {
		if !audioCppStandaloneBundleEntry(input.Entry.FormatProbe, "dit") {
			return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
		}
		descriptor := ModelAssetDescriptor{Kind: kind, Family: d.spec.family, Engine: "audio-cpp", ArtifactRoles: []string{role}, FormatProbe: append([]byte(nil), input.Entry.FormatProbe...)}
		return validatedModelAssetBindingProjection(input, descriptor, 0, d.ValidateBinding)
	}
	return projectAudioCppSpeechModelAsset(input, expectedFamily, kind, role, d.ValidateBinding)
}

func audioCppRequiredFilesPresent(files []ModelAssetFileFact, required map[string]int64) bool {
	for suffix, size := range required {
		found := false
		for _, file := range files {
			relative := strings.TrimPrefix(filepath.ToSlash(file.RelativePath), "/")
			expected := strings.TrimPrefix(filepath.ToSlash(suffix), "/")
			if (relative == expected || strings.HasSuffix(relative, "/"+expected)) && file.SizeBytes == size {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}

func audioCppStandaloneBundleEntry(probe []byte, expectedName string) bool {
	if len(probe) < 4 || len(probe) > MaxAssetFormatProbeBytes || !bytes.Equal(probe[:4], []byte("GGUF")) {
		return false
	}
	summary, err := ggufmeta.InspectMetadataUntilStrings(bytes.NewReader(probe), "general.architecture", "general.name")
	if err != nil {
		return false
	}
	architecture, architectureOK := summary.StringValue("general.architecture")
	name, nameOK := summary.StringValue("general.name")
	return architectureOK && strings.TrimSpace(architecture) == "audiocpp" && nameOK && strings.TrimSpace(name) == expectedName
}

func (d AudioCppASRDriver) ProjectModelAssetBinding(input ModelAssetBindingInput) (ModelAssetBindingProjection, runtimev1.LocalCapabilityReason) {
	if input.Requirement == nil || input.Requirement.GetRequirementId() != AudioCppASRModelRequirementID {
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	return projectAudioCppSpeechModelAsset(input, d.spec.family, runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_STT, "stt_model", d.ValidateBinding)
}

func projectAudioCppSpeechModelAsset(input ModelAssetBindingInput, expectedFamily string, kind runtimev1.LocalAssetKind, role string, validate func(*runtimev1.LocalCapabilityRequirement, *runtimev1.ModelAssetExactBinding, ModelAssetDescriptor) runtimev1.LocalCapabilityReason) (ModelAssetBindingProjection, runtimev1.LocalCapabilityReason) {
	if input.Requirement == nil || input.Binding == nil || input.Requirement.GetRequirementId() != input.Binding.GetRequirementId() || input.Entry.SizeBytes <= 0 || !strings.EqualFold(filepath.Ext(input.Entry.RelativePath), ".gguf") {
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	family, ok := audioCppEmbeddedFamily(input.Entry.FormatProbe)
	if !ok || family != expectedFamily {
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	descriptor := ModelAssetDescriptor{Kind: kind, Family: family, Engine: "audio-cpp", ArtifactRoles: []string{role}, FormatProbe: append([]byte(nil), input.Entry.FormatProbe...)}
	return validatedModelAssetBindingProjection(input, descriptor, 0, validate)
}

func audioCppEmbeddedFamily(probe []byte) (string, bool) {
	if len(probe) < 4 || len(probe) > MaxAssetFormatProbeBytes || !bytes.Equal(probe[:4], []byte("GGUF")) {
		return "", false
	}
	summary, err := ggufmeta.InspectMetadataUntilString(bytes.NewReader(probe), audioCppEmbeddedFamilyKey)
	if err != nil {
		return "", false
	}
	family, ok := summary.StringValue(audioCppEmbeddedFamilyKey)
	family = strings.TrimSpace(family)
	return family, ok && family != ""
}

func (d AudioCppTTSDriver) bindingContract(requirementID string) (string, runtimev1.LocalAssetKind, string, bool) {
	switch requirementID {
	case AudioCppTTSModelRequirementID:
		return d.spec.family, runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_TTS, "tts_model", true
	case AudioCppTTSCodecRequirementID:
		return "miocodec", runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY, "audio_codec", d.spec.requiresCodec
	default:
		return "", runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED, "", false
	}
}

func (d AudioCppTTSDriver) ValidateBinding(requirement *runtimev1.LocalCapabilityRequirement, binding *runtimev1.ModelAssetExactBinding, asset ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if requirement == nil || binding == nil || requirement.GetRequirementId() != binding.GetRequirementId() || strings.TrimSpace(binding.GetVerifiedContentId()) == "" {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	family, kind, role, ok := d.bindingContract(requirement.GetRequirementId())
	if !ok || asset.Kind != kind || asset.Family != family || asset.Engine != "audio-cpp" || !contains(asset.ArtifactRoles, role) {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	if requirement.GetRequirementId() == AudioCppTTSModelRequirementID && d.spec.modelUsesStandaloneDITEntry {
		if !audioCppStandaloneBundleEntry(asset.FormatProbe, "dit") {
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
		}
	} else {
		detected, ok := audioCppEmbeddedFamily(asset.FormatProbe)
		if !ok || detected != family {
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
		}
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (d AudioCppASRDriver) ValidateBinding(requirement *runtimev1.LocalCapabilityRequirement, binding *runtimev1.ModelAssetExactBinding, asset ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if requirement == nil || binding == nil || requirement.GetRequirementId() != AudioCppASRModelRequirementID || binding.GetRequirementId() != AudioCppASRModelRequirementID || strings.TrimSpace(binding.GetVerifiedContentId()) == "" || asset.Kind != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_STT || asset.Family != d.spec.family || asset.Engine != "audio-cpp" || !contains(asset.ArtifactRoles, "stt_model") {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	detected, ok := audioCppEmbeddedFamily(asset.FormatProbe)
	if !ok || detected != d.spec.family {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (d AudioCppTTSDriver) ValidateCombination(requirements []*runtimev1.LocalCapabilityRequirement, bindings []*runtimev1.ModelAssetExactBinding, assets []ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	expected := 1
	if d.spec.requiresCodec {
		expected = 2
	}
	if len(requirements) != expected || len(bindings) != expected || len(assets) != expected {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	for index := range requirements {
		if reason := d.ValidateBinding(requirements[index], bindings[index], assets[index]); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
			return reason
		}
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (d AudioCppASRDriver) ValidateCombination(requirements []*runtimev1.LocalCapabilityRequirement, bindings []*runtimev1.ModelAssetExactBinding, assets []ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if len(requirements) != 1 || len(bindings) != 1 || len(assets) != 1 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	return d.ValidateBinding(requirements[0], bindings[0], assets[0])
}

func (d AudioCppTTSDriver) ListPresetVoices(bindings []InvocationExactBinding) ([]SpeechPresetVoice, error) {
	if _, err := audioCppInvocationBindings(bindings, d.spec.family, AudioCppTTSModelRequirementID, d.spec.requiresCodec); err != nil {
		return nil, err
	}
	voices := make([]SpeechPresetVoice, len(d.spec.presetVoices))
	for index, voice := range d.spec.presetVoices {
		voices[index] = SpeechPresetVoice{VoiceID: voice.VoiceID, Name: voice.Name, SupportedLangs: append([]string(nil), voice.SupportedLangs...)}
	}
	return voices, nil
}

func (d AudioCppTTSDriver) PlanAudioCppTTSSynthesis(input AudioCppTTSSynthesizeInvocationInput) (*AudioCppTTSSynthesizePlan, error) {
	registration := d.registration()
	if input.RecipeID != registration.RecipeID || !emptySpeechPortableConfig(input.PortableConfig) {
		return nil, invocationError(InvocationFailureInvalidConfig, fmt.Errorf("%s audio.cpp recipe is invalid", d.spec.displayName))
	}
	bindings, err := audioCppInvocationBindings(input.ExactBindings, d.spec.family, AudioCppTTSModelRequirementID, d.spec.requiresCodec)
	if err != nil {
		return nil, err
	}
	if err := validateAudioCppSpeechRuntime(input.Runtime, d.spec.requiresESpeak); err != nil {
		return nil, invocationError(InvocationFailureInvalidConfig, err)
	}
	request, args, err := d.ttsRequestArgs(input.Request, input.ReferenceVoice)
	if err != nil {
		return nil, err
	}
	staging := strings.TrimSpace(input.StagingWAVPath)
	if !filepath.IsAbs(staging) || !strings.EqualFold(filepath.Ext(staging), ".wav") {
		return nil, invocationError(InvocationFailureInvalidConfig, fmt.Errorf("audio.cpp TTS staging WAV path is invalid"))
	}
	main := bindings[AudioCppTTSModelRequirementID]
	args = append([]string{"--task", d.spec.cliTask, "--family", d.spec.family, "--model", main.AbsolutePath, "--backend", "cuda"}, args...)
	if d.spec.requiresCodec {
		args = append(args, "--session-option", "miotts.codec_model_path="+bindings[AudioCppTTSCodecRequirementID].AbsolutePath)
	}
	if d.spec.requiresESpeak {
		args = append(args, "--session-option", "inflect_v2.espeak_library_path="+input.Runtime.ESpeakLibraryPath, "--session-option", "inflect_v2.espeak_data_path="+input.Runtime.ESpeakDataPath)
	}
	args = append(args, "--out", staging, "--metrics")
	processKey := audioCppSpeechProcessKey(input.ExactBindings, input.Runtime, registration.Identity.DriverDialect)
	var referencePath, referenceText string
	var referenceBytes []byte
	if input.ReferenceVoice != nil {
		referencePath = filepath.Clean(input.ReferenceVoice.WAVPath)
		referenceBytes = append([]byte(nil), input.ReferenceVoice.WAVBytes...)
		referenceText = strings.TrimSpace(input.ReferenceVoice.ReferenceText)
	}
	return &AudioCppTTSSynthesizePlan{processKey: processKey, loadoutID: strings.TrimSpace(input.LoadoutID), driverID: registration.Identity.DriverID, family: d.spec.family, modelAssetID: main.ModelAssetID, modelFiles: cloneInvocationExactBindings(input.ExactBindings), request: request, cliArgs: args, audioCppPackageID: input.Runtime.Package.AudioCppPackageID, audioCppSelectedSourceRecordID: input.Runtime.Package.AudioCppSelectedSourceRecordID, audioCppRoot: filepath.Clean(input.Runtime.Package.AudioCppRoot), audioCppExecutablePath: filepath.Clean(input.Runtime.Package.AudioCppExecutablePath), cuda13DependencyID: input.Runtime.Package.CUDA13DependencyID, cuda13SelectedSourceRecordID: input.Runtime.Package.CUDA13SelectedSourceRecordID, cuda13Root: filepath.Clean(input.Runtime.Package.CUDA13Root), stagingWAVPath: filepath.Clean(staging), referenceWAVPath: referencePath, referenceWAVBytes: referenceBytes, referenceText: referenceText}, nil
}

func (d AudioCppTTSDriver) ttsRequestArgs(value *runtimev1.SpeechSynthesizeScenarioSpec, reference *AudioCppReferenceVoiceInput) (*runtimev1.SpeechSynthesizeScenarioSpec, []string, error) {
	request, _ := proto.Clone(value).(*runtimev1.SpeechSynthesizeScenarioSpec)
	if request == nil || strings.TrimSpace(request.GetText()) == "" {
		return nil, nil, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("%s text is required", d.spec.displayName))
	}
	if utf8.RuneCountInString(request.GetText()) > audioCppMaxRequestTextRunes {
		return nil, nil, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("%s text exceeds the Windows CLI input bound", d.spec.displayName))
	}
	if format := strings.ToLower(strings.TrimSpace(request.GetAudioFormat())); format != "" && format != "wav" && format != "wave" {
		return nil, nil, invocationError(InvocationFailureUnsupported, fmt.Errorf("audio.cpp TTS supports only WAV"))
	}
	if request.SampleRateHz != nil || request.Pitch != nil || request.Volume != nil || (request.GetTimingMode() != runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_UNSPECIFIED && request.GetTimingMode() != runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_NONE) || request.GetVoiceRenderHints() != nil {
		return nil, nil, invocationError(InvocationFailureUnsupported, fmt.Errorf("%s request contains unsupported synthesis options", d.spec.displayName))
	}
	if request.Speed != nil && d.spec.speakingRateOption == "" {
		return nil, nil, invocationError(InvocationFailureUnsupported, fmt.Errorf("%s does not support speaking rate", d.spec.displayName))
	}
	if request.Speed != nil && (request.GetSpeed() <= 0 || math.IsNaN(float64(request.GetSpeed())) || math.IsInf(float64(request.GetSpeed()), 0)) {
		return nil, nil, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("%s speaking rate is invalid", d.spec.displayName))
	}
	if request.Speed != nil && ((d.spec.speakingRateMin > 0 && request.GetSpeed() < d.spec.speakingRateMin) || (d.spec.speakingRateMax > 0 && request.GetSpeed() > d.spec.speakingRateMax)) {
		return nil, nil, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("%s speaking rate is outside the supported range", d.spec.displayName))
	}
	if strings.TrimSpace(request.GetEmotion()) != "" && !d.spec.supportsEmotion {
		return nil, nil, invocationError(InvocationFailureUnsupported, fmt.Errorf("%s does not support emotion", d.spec.displayName))
	}
	if len(strings.TrimSpace(request.GetEmotion())) > 64 {
		return nil, nil, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("%s emotion is invalid", d.spec.displayName))
	}
	if emotion := strings.TrimSpace(request.GetEmotion()); emotion != "" && len(d.spec.emotionValues) > 0 && !contains(d.spec.emotionValues, emotion) {
		return nil, nil, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("%s emotion is invalid", d.spec.displayName))
	}
	text := strings.TrimSpace(request.GetText())
	if d.spec.textPrefix != "" && !strings.HasPrefix(text, d.spec.textPrefix) {
		text = d.spec.textPrefix + text
	}
	args := []string{"--text", text}
	if language := strings.TrimSpace(request.GetLanguage()); language != "" {
		if len(language) > 64 {
			return nil, nil, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("audio.cpp TTS language is invalid"))
		}
		if len(d.spec.languages) > 0 && !contains(d.spec.languages, language) {
			return nil, nil, invocationError(InvocationFailureUnsupported, fmt.Errorf("%s language is unsupported", d.spec.displayName))
		}
		args = append(args, "--language", language)
	}
	if request.Speed != nil {
		args = append(args, "--request-option", d.spec.speakingRateOption+"="+fmt.Sprintf("%g", request.GetSpeed()))
	}
	if emotion := strings.TrimSpace(request.GetEmotion()); emotion != "" {
		args = append(args, "--emotion", emotion)
	}
	ref := request.GetVoiceRef()
	if ref == nil || ref.GetKind() == runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_UNSPECIFIED {
		if d.spec.referencePolicy == audioCppReferenceRequired {
			return nil, nil, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("%s requires a reference voice", d.spec.displayName))
		}
		if d.spec.defaultPreset != "" {
			if d.spec.presetArgument != audioCppPresetNoArgument {
				args = append(args, d.spec.presetArgument, d.spec.defaultPreset)
			}
		}
		return request, args, nil
	}
	switch ref.GetKind() {
	case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET:
		voiceID := strings.TrimSpace(ref.GetPresetVoiceId())
		if d.spec.presetArgument == "" || !audioCppPresetAllowed(d.spec.presetVoices, voiceID) {
			return nil, nil, invocationError(InvocationFailureUnsupported, fmt.Errorf("%s preset voice is unsupported", d.spec.displayName))
		}
		if d.spec.presetArgument != audioCppPresetNoArgument {
			args = append(args, d.spec.presetArgument, voiceID)
		}
	case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF:
		if reference == nil {
			return nil, nil, invocationError(InvocationFailureUnsupported, fmt.Errorf("%s reference voice is unavailable", d.spec.displayName))
		}
		mimeType := strings.ToLower(strings.TrimSpace(reference.MIMEType))
		if d.spec.referencePolicy == audioCppReferenceForbidden || strings.TrimSpace(reference.ProviderVoiceRef) == "" || strings.TrimSpace(reference.ProviderVoiceRef) != strings.TrimSpace(ref.GetProviderVoiceRef()) || !filepath.IsAbs(reference.WAVPath) || !strings.EqualFold(filepath.Ext(reference.WAVPath), ".wav") || (mimeType != "audio/wav" && mimeType != "audio/wave" && mimeType != "audio/x-wav") || len(reference.WAVBytes) == 0 || len(reference.WAVBytes) > audioCppMaxTranscriptionWAVSize || !audioCppASRWAVSupported(reference.WAVBytes) {
			return nil, nil, invocationError(InvocationFailureUnsupported, fmt.Errorf("%s reference voice is unavailable", d.spec.displayName))
		}
		if len(reference.ReferenceText) > audioCppMaxReferenceTextBytes || utf8.RuneCountInString(reference.ReferenceText) > audioCppMaxReferenceTextRunes || (d.spec.referenceTextRequired && strings.TrimSpace(reference.ReferenceText) == "") {
			return nil, nil, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("%s reference text is required", d.spec.displayName))
		}
		if d.spec.referenceArgument == "voice_samples" {
			args = append(args, "--request-option", "voice_samples="+filepath.Clean(reference.WAVPath))
		} else {
			args = append(args, d.spec.referenceArgument, filepath.Clean(reference.WAVPath))
		}
		if strings.TrimSpace(reference.ReferenceText) != "" {
			args = append(args, "--reference-text", strings.TrimSpace(reference.ReferenceText))
		}
	default:
		return nil, nil, invocationError(InvocationFailureUnsupported, fmt.Errorf("%s voice reference kind is unsupported", d.spec.displayName))
	}
	return request, args, nil
}

func audioCppPresetAllowed(voices []SpeechPresetVoice, id string) bool {
	for _, voice := range voices {
		if voice.VoiceID == id {
			return true
		}
	}
	return false
}

func (d AudioCppASRDriver) PlanAudioCppASRTranscription(input AudioCppASRTranscribeInvocationInput) (*AudioCppASRTranscribePlan, error) {
	registration := d.registration()
	if input.RecipeID != registration.RecipeID || !emptySpeechPortableConfig(input.PortableConfig) {
		return nil, invocationError(InvocationFailureInvalidConfig, fmt.Errorf("%s audio.cpp recipe is invalid", d.spec.displayName))
	}
	bindings, err := audioCppInvocationBindings(input.ExactBindings, d.spec.family, AudioCppASRModelRequirementID, false)
	if err != nil {
		return nil, err
	}
	if err := validateAudioCppSpeechRuntime(input.Runtime, false); err != nil {
		return nil, invocationError(InvocationFailureInvalidConfig, err)
	}
	request, args, err := d.asrRequestArgs(input.Request)
	if err != nil {
		return nil, err
	}
	mimeType := strings.ToLower(strings.TrimSpace(input.MIMEType))
	if mimeType != "audio/wav" && mimeType != "audio/wave" && mimeType != "audio/x-wav" {
		return nil, invocationError(InvocationFailureUnsupported, fmt.Errorf("audio.cpp ASR accepts only WAV input"))
	}
	if len(input.AudioBytes) == 0 || len(input.AudioBytes) > audioCppMaxTranscriptionWAVSize || !audioCppASRWAVSupported(input.AudioBytes) {
		return nil, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("audio.cpp ASR WAV input is invalid or unsupported"))
	}
	audioPath := strings.TrimSpace(input.StagingAudioPath)
	textPath := strings.TrimSpace(input.StagingTextOutPath)
	if !filepath.IsAbs(audioPath) || !strings.EqualFold(filepath.Ext(audioPath), ".wav") || !filepath.IsAbs(textPath) || !strings.EqualFold(filepath.Ext(textPath), ".txt") || strings.EqualFold(audioPath, textPath) {
		return nil, invocationError(InvocationFailureInvalidConfig, fmt.Errorf("audio.cpp ASR staging paths are invalid"))
	}
	main := bindings[AudioCppASRModelRequirementID]
	args = append([]string{"--task", "asr", "--family", d.spec.family, "--model", main.AbsolutePath, "--backend", "cuda", "--audio", audioPath, "--text-out", textPath}, args...)
	args = append(args, "--metrics")
	processKey := audioCppSpeechProcessKey(input.ExactBindings, input.Runtime, registration.Identity.DriverDialect)
	return &AudioCppASRTranscribePlan{processKey: processKey, loadoutID: strings.TrimSpace(input.LoadoutID), driverID: registration.Identity.DriverID, family: d.spec.family, modelAssetID: main.ModelAssetID, modelFiles: cloneInvocationExactBindings(input.ExactBindings), request: request, audioBytes: append([]byte(nil), input.AudioBytes...), mimeType: mimeType, cliArgs: args, audioCppPackageID: input.Runtime.Package.AudioCppPackageID, audioCppSelectedSourceRecordID: input.Runtime.Package.AudioCppSelectedSourceRecordID, audioCppRoot: filepath.Clean(input.Runtime.Package.AudioCppRoot), audioCppExecutablePath: filepath.Clean(input.Runtime.Package.AudioCppExecutablePath), cuda13DependencyID: input.Runtime.Package.CUDA13DependencyID, cuda13SelectedSourceRecordID: input.Runtime.Package.CUDA13SelectedSourceRecordID, cuda13Root: filepath.Clean(input.Runtime.Package.CUDA13Root), stagingAudioPath: filepath.Clean(audioPath), stagingTextOutPath: filepath.Clean(textPath)}, nil
}

func (d AudioCppASRDriver) asrRequestArgs(value *runtimev1.SpeechTranscribeScenarioSpec) (*runtimev1.SpeechTranscribeScenarioSpec, []string, error) {
	request, _ := proto.Clone(value).(*runtimev1.SpeechTranscribeScenarioSpec)
	if request == nil {
		return nil, nil, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("audio.cpp ASR request is required"))
	}
	if requestMIME := strings.ToLower(strings.TrimSpace(request.GetMimeType())); requestMIME != "" && requestMIME != "audio/wav" && requestMIME != "audio/wave" && requestMIME != "audio/x-wav" {
		return nil, nil, invocationError(InvocationFailureUnsupported, fmt.Errorf("audio.cpp ASR accepts only WAV input"))
	}
	if request.GetTimestamps() || request.GetDiarization() || request.GetSpeakerCount() != 0 {
		return nil, nil, invocationError(InvocationFailureUnsupported, fmt.Errorf("audio.cpp ASR timestamps and diarization are not admitted by this dialect"))
	}
	if format := strings.ToLower(strings.TrimSpace(request.GetResponseFormat())); format != "" && format != "text" && format != "txt" {
		return nil, nil, invocationError(InvocationFailureUnsupported, fmt.Errorf("audio.cpp ASR supports only text responses"))
	}
	args := []string{}
	language := strings.TrimSpace(request.GetLanguage())
	switch d.spec.languagePolicy {
	case audioCppLanguageAutoOnly:
		if language != "" && !strings.EqualFold(language, "auto") {
			return nil, nil, invocationError(InvocationFailureUnsupported, fmt.Errorf("%s does not accept a forced language", d.spec.displayName))
		}
	case audioCppLanguageFixed:
		if language != "" && !strings.EqualFold(language, d.spec.fixedLanguage) {
			return nil, nil, invocationError(InvocationFailureUnsupported, fmt.Errorf("%s requires language %s", d.spec.displayName, d.spec.fixedLanguage))
		}
	default:
		if len(d.spec.forcedLanguages) > 0 && language != "" && !contains(d.spec.forcedLanguages, language) {
			return nil, nil, invocationError(InvocationFailureUnsupported, fmt.Errorf("%s language is unsupported", d.spec.displayName))
		}
		if language != "" {
			args = append(args, "--language", language)
		}
	}
	prompt := strings.TrimSpace(request.GetPrompt())
	if prompt != "" {
		if utf8.RuneCountInString(prompt) > audioCppMaxRequestTextRunes {
			return nil, nil, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("%s transcription prompt exceeds the Windows CLI input bound", d.spec.displayName))
		}
		if !d.spec.supportsPrompt {
			return nil, nil, invocationError(InvocationFailureUnsupported, fmt.Errorf("%s does not support a transcription prompt", d.spec.displayName))
		}
		args = append(args, "--text", prompt)
	}
	if d.spec.fixedChunkMode != "" {
		args = append(args, "--audio-chunk-mode", d.spec.fixedChunkMode)
	}
	return request, args, nil
}

func audioCppASRWAVSupported(value []byte) bool {
	if len(value) < 44 || string(value[:4]) != "RIFF" || string(value[8:12]) != "WAVE" {
		return false
	}
	if int(binary.LittleEndian.Uint32(value[4:8]))+8 != len(value) {
		return false
	}
	formatSupported := false
	hasAudioData := false
	for offset := 12; offset+8 <= len(value); {
		size := int(binary.LittleEndian.Uint32(value[offset+4 : offset+8]))
		start := offset + 8
		if size < 0 || start+size > len(value) {
			return false
		}
		if string(value[offset:offset+4]) == "fmt " {
			if size < 16 {
				return false
			}
			format := binary.LittleEndian.Uint16(value[start : start+2])
			channels := binary.LittleEndian.Uint16(value[start+2 : start+4])
			rate := binary.LittleEndian.Uint32(value[start+4 : start+8])
			bits := binary.LittleEndian.Uint16(value[start+14 : start+16])
			formatSupported = channels > 0 && rate > 0 && ((format == 1 && (bits == 16 || bits == 24)) || (format == 3 && bits == 32))
		} else if string(value[offset:offset+4]) == "data" && size > 0 {
			hasAudioData = true
		}
		offset = start + size + size%2
	}
	return formatSupported && hasAudioData
}

func audioCppInvocationBindings(values []InvocationExactBinding, mainFamily string, mainRequirementID string, requiresCodec bool) (map[string]InvocationExactBinding, error) {
	expected := 1
	if requiresCodec {
		expected = 2
	}
	if len(values) != expected {
		return nil, invocationError(InvocationFailureInvalidBinding, fmt.Errorf("audio.cpp %s requires %d exact model binding(s)", mainFamily, expected))
	}
	bindings := make(map[string]InvocationExactBinding, expected)
	for _, binding := range cloneInvocationExactBindings(values) {
		if binding.RequirementID == "" || binding.ModelAssetID == "" || binding.VerifiedContentID == "" || binding.EntrySHA256 == "" || !filepath.IsAbs(binding.AbsolutePath) || !strings.EqualFold(filepath.Ext(binding.AbsolutePath), ".gguf") || len(binding.DeclaredFiles) == 0 {
			return nil, invocationError(InvocationFailureInvalidBinding, fmt.Errorf("audio.cpp %s model binding is incomplete", mainFamily))
		}
		if _, duplicate := bindings[binding.RequirementID]; duplicate {
			return nil, invocationError(InvocationFailureInvalidBinding, fmt.Errorf("audio.cpp %s model binding is duplicated", mainFamily))
		}
		bindings[binding.RequirementID] = binding
	}
	if _, ok := bindings[mainRequirementID]; !ok {
		return nil, invocationError(InvocationFailureInvalidBinding, fmt.Errorf("audio.cpp %s main model binding is missing", mainFamily))
	}
	if requiresCodec {
		if _, ok := bindings[AudioCppTTSCodecRequirementID]; !ok {
			return nil, invocationError(InvocationFailureInvalidBinding, fmt.Errorf("audio.cpp MioCodec binding is missing"))
		}
	}
	return bindings, nil
}

func validateAudioCppSpeechRuntime(input AudioCppSpeechRuntimeInput, requiresESpeak bool) error {
	pkg := input.Package
	if pkg.AudioCppPackageID != AudioCppWindowsCUDA13PackageID || pkg.CUDA13DependencyID != AudioCppCUDA13RuntimeDependencyID || strings.TrimSpace(pkg.AudioCppSelectedSourceRecordID) == "" || strings.TrimSpace(pkg.CUDA13SelectedSourceRecordID) == "" || !filepath.IsAbs(pkg.AudioCppRoot) || !filepath.IsAbs(pkg.AudioCppExecutablePath) || !filepath.IsAbs(pkg.CUDA13Root) || !musicPathWithin(pkg.AudioCppRoot, pkg.AudioCppExecutablePath) || !strings.EqualFold(filepath.Base(pkg.AudioCppExecutablePath), "audiocpp_cli.exe") {
		return fmt.Errorf("audio.cpp speech package selected-source composition is incomplete")
	}
	if requiresESpeak && (strings.TrimSpace(input.ESpeakSelectedSourceRecordID) == "" || !filepath.IsAbs(input.ESpeakLibraryPath) || !filepath.IsAbs(input.ESpeakDataPath)) {
		return fmt.Errorf("Inflect eSpeak-ng selected-source composition is incomplete")
	}
	return nil
}

func audioCppSpeechProcessKey(bindings []InvocationExactBinding, runtime AudioCppSpeechRuntimeInput, dialect string) string {
	hasher := sha256.New()
	for _, binding := range bindings {
		for _, value := range invocationExactBindingIdentity(binding) {
			_, _ = hasher.Write([]byte(value))
			_, _ = hasher.Write([]byte{0})
		}
	}
	for _, value := range []string{runtime.Package.AudioCppPackageID, runtime.Package.AudioCppSelectedSourceRecordID, runtime.Package.CUDA13DependencyID, runtime.Package.CUDA13SelectedSourceRecordID, runtime.ESpeakSelectedSourceRecordID, dialect} {
		_, _ = hasher.Write([]byte(value))
		_, _ = hasher.Write([]byte{0})
	}
	return hex.EncodeToString(hasher.Sum(nil))
}

package capabilitydriver

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"math"
	"strings"
	"unicode/utf8"
)

const CloudMediaAdapterMiniMaxSpeech = "minimax_speech_v2_adapter"
const CloudMediaAdapterMiniMaxMusic = "minimax_music_generation_adapter"

func MiniMaxSpeechModels() []string {
	return []string{"speech-2.8-hd", "speech-2.8-turbo", "speech-2.6-hd", "speech-2.6-turbo"}
}
func MiniMaxSpeechVoices() []string {
	return []string{"male-qn-qingse", "female-shaonv", "English_Graceful_Lady", "English_Insightful_Speaker", "Japanese_Whisper_Belle", "Cantonese_GentleLady"}
}
func IsMiniMaxMusicModel(model string) bool { return model == "music-3.0" || model == "music-2.6" }
func miniMaxAudioUnsupported() error {
	return nativeCloudSpeechUnsupported("The selected MiniMax model does not support this exact finite audio request")
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r051
func validateMiniMaxSpeechRequest(req *runtimev1.SubmitScenarioJobRequest, model string, mode CloudMediaStreamMode) error {
	s := req.GetSpec().GetSpeechSynthesize()
	if !contains(MiniMaxSpeechModels(), model) || s == nil || mode != CloudMediaStreamNone || len(req.GetExtensions()) > 0 || strings.TrimSpace(s.GetText()) == "" || utf8.RuneCountInString(s.GetText()) >= 10000 || s.GetVoiceRef().GetKind() != runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET || !contains(MiniMaxSpeechVoices(), s.GetVoiceRef().GetPresetVoiceId()) || s.GetVoiceRenderHints() != nil || s.GetIdentityAudio() != nil || s.GetPerformanceAudio() != nil || s.GetTimingMode() != runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_UNSPECIFIED && s.GetTimingMode() != runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_NONE {
		return miniMaxAudioUnsupported()
	}
	if s.Speed != nil && !(s.GetSpeed() >= .5 && s.GetSpeed() <= 2) || s.Volume != nil && !(s.GetVolume() > 0 && s.GetVolume() <= 4) || s.Pitch != nil && (!(s.GetPitch() >= -12 && s.GetPitch() <= 12) || math.Trunc(float64(s.GetPitch())) != float64(s.GetPitch())) {
		return miniMaxAudioUnsupported()
	}
	emotions := []string{"happy", "sad", "angry", "fearful", "disgusted", "surprised", "calm"}
	if strings.HasPrefix(model, "speech-2.6-") {
		emotions = append(emotions, "fluent", "whisper")
	}
	if s.GetEmotion() != "" && !contains(emotions, s.GetEmotion()) {
		return miniMaxAudioUnsupported()
	}
	if s.GetLanguage() != "" && !contains([]string{"zh", "en", "ja", "yue"}, s.GetLanguage()) {
		return miniMaxAudioUnsupported()
	}
	if s.GetVoiceRef().GetPresetVoiceId() == "Cantonese_GentleLady" {
		if s.GetLanguage() != "" && s.GetLanguage() != "yue" {
			return miniMaxAudioUnsupported()
		}
		s.Language = "yue"
	}
	if s.AudioFormat == "" {
		s.AudioFormat = "mp3"
	}
	if s.SampleRateHz == nil {
		rate := int32(32000)
		if s.AudioFormat == "mulaw" || s.AudioFormat == "wav_mulaw" {
			rate = 8000
		}
		s.SampleRateHz = proto.Int32(rate)
	}
	switch s.GetAudioFormat() {
	case "mp3", "pcm", "wav":
		switch s.GetSampleRateHz() {
		case 8000, 16000, 22050, 24000, 32000, 44100:
		default:
			return miniMaxAudioUnsupported()
		}
	case "mulaw", "wav_mulaw":
		if s.GetSampleRateHz() != 8000 {
			return miniMaxAudioUnsupported()
		}
	default:
		return miniMaxAudioUnsupported()
	}
	return nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.music-generation
func validateMiniMaxMusicRequest(req *runtimev1.SubmitScenarioJobRequest, model string) error {
	s := req.GetSpec().GetMusicGenerate()
	if !IsMiniMaxMusicModel(model) || s == nil || len(req.GetExtensions()) > 0 || strings.TrimSpace(s.GetPrompt()) == "" || utf8.RuneCountInString(s.GetPrompt()) > 2000 || utf8.RuneCountInString(s.GetLyrics()) > 3500 || !s.GetInstrumental() && strings.TrimSpace(s.GetLyrics()) == "" || s.GetInstrumental() && s.GetLyrics() != "" || s.GetNegativePrompt() != "" || s.GetStyle() != "" || s.GetTitle() != "" || s.Seed != nil || s.GetScore() != nil || s.GetAudioReference() != nil || s.GetVideoReference() != nil || s.GetReturnGeneratedScore() || s.GetScoreConditioning() != runtimev1.MusicScoreConditioning_MUSIC_SCORE_CONDITIONING_UNSPECIFIED || s.GetDurationSeconds() != 0 && s.GetDurationSeconds() != 600 {
		return nativeCloudSpeechUnsupported("MiniMax Music requires a prompt up to 2000 characters and either lyrics up to 3500 characters or instrumental mode. Omit duration or use the fixed 600-second output ceiling; other music controls are unsupported")
	}
	s.DurationSeconds = 600
	return nil
}
func miniMaxMusicInputCapabilities() *runtimev1.MusicInputCapabilities {
	return &runtimev1.MusicInputCapabilities{Generation: []*runtimev1.MusicGenerationInputProfile{{LyricsMode: "optional", ScoreMode: "unsupported", VideoReferenceMode: "unsupported", SupportsInstrumental: true, MaxDurationSeconds: 600, DefaultDurationSeconds: 600, MaxPromptBytes: 8000, MaxLyricsBytes: 14000}}}
}

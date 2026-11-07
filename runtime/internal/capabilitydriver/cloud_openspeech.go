package capabilitydriver

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"math"
	"strings"
)

const OpenSpeechFlashASR = "volc.bigasr.auc_turbo"

func OpenSpeechVoices(model string) []string {
	switch model {
	case "seed-tts-2.0":
		return []string{"zh_female_vv_uranus_bigtts", "zh_female_xiaohe_uranus_bigtts", "zh_male_m191_uranus_bigtts", "en_male_tim_uranus_bigtts", "en_female_dacey_uranus_bigtts"}
	case "seed-tts-1.0":
		return []string{"zh_female_shuangkuaisisi_moon_bigtts", "zh_male_jingqiangkanye_moon_bigtts"}
	default:
		return nil
	}
}
func openSpeechUnsupported() error {
	return nativeCloudSpeechUnsupported("The selected OpenSpeech resource does not support this exact request. Use its reviewed preset voice/finite speech path and dedicated new-console API Key")
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r051
func validateOpenSpeechMedia(req *runtimev1.SubmitScenarioJobRequest, model string, mode CloudMediaStreamMode) error {
	if len(req.GetExtensions()) > 0 || mode != CloudMediaStreamNone {
		return openSpeechUnsupported()
	}
	if s := req.GetSpec().GetSpeechSynthesize(); s != nil {
		if len(OpenSpeechVoices(model)) == 0 || s.GetVoiceRef().GetKind() != runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET || !contains(OpenSpeechVoices(model), s.GetVoiceRef().GetPresetVoiceId()) || strings.TrimSpace(s.GetText()) == "" || len(s.GetText()) > 32768 {
			return openSpeechUnsupported()
		}
		if s.Pitch != nil || s.Volume != nil || s.GetEmotion() != "" || s.GetVoiceRenderHints() != nil || s.GetIdentityAudio() != nil || s.GetPerformanceAudio() != nil || s.GetTimingMode() != runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_UNSPECIFIED && s.GetTimingMode() != runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_NONE {
			return openSpeechUnsupported()
		}
		if s.GetLanguage() != "" && s.GetLanguage() != "zh" && s.GetLanguage() != "en" || strings.HasPrefix(s.GetVoiceRef().GetPresetVoiceId(), "en_") && s.GetLanguage() == "zh" {
			return openSpeechUnsupported()
		}
		if s.Speed != nil && (math.IsNaN(float64(s.GetSpeed())) || math.IsInf(float64(s.GetSpeed()), 0) || s.GetSpeed() < .5 || s.GetSpeed() > 2) {
			return openSpeechUnsupported()
		}
		if s.AudioFormat == "" {
			s.AudioFormat = "mp3"
		}
		if s.SampleRateHz == nil {
			s.SampleRateHz = proto.Int32(24000)
		}
		switch s.GetAudioFormat() {
		case "mp3", "pcm":
			switch s.GetSampleRateHz() {
			case 8000, 16000, 22050, 24000, 32000, 44100, 48000:
			default:
				return openSpeechUnsupported()
			}
		case "ogg_opus":
			if s.GetSampleRateHz() != 48000 {
				return openSpeechUnsupported()
			}
		default:
			return openSpeechUnsupported()
		}
		return nil
	}
	if s := req.GetSpec().GetSpeechTranscribe(); s != nil {
		if model != OpenSpeechFlashASR || s.GetPrompt() != "" || s.GetDiarization() || s.GetSpeakerCount() != 0 || s.GetResponseFormat() != "" && s.GetResponseFormat() != "text" || s.GetMimeType() != "audio/wav" && s.GetMimeType() != "audio/mpeg" || len(s.GetAudioSource().GetAudioBytes()) == 0 || len(s.GetAudioSource().GetAudioBytes()) > 32<<20 {
			return openSpeechUnsupported()
		}
		if s.GetLanguage() != "" && !contains(strings.Fields("zh-CN en-US ja-JP id-ID es-MX pt-BR de-DE fr-FR ko-KR fil-PH ms-MY th-TH ar-SA it-IT bn-BD el-GR nl-NL ru-RU tr-TR vi-VN pl-PL ro-RO ne-NP uk-UA yue-CN"), s.GetLanguage()) {
			return openSpeechUnsupported()
		}
		return nil
	}
	return openSpeechUnsupported()
}

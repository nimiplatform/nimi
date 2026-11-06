package capabilitydriver

import (
	"math"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

const CloudMediaAdapterSiliconFlowImage = "siliconflow_images_v1_adapter"
const CloudMediaAdapterSiliconFlowSpeech = "siliconflow_speech_v1_adapter"
const CloudMediaAdapterSiliconFlowTranscribe = "siliconflow_transcribe_v1_adapter"
const SiliconFlowImageEditModel = "Qwen/Qwen-Image-Edit-2509"

func IsSiliconFlowImageModel(m string) bool {
	return m == "OpenMOSS-Team/MOSS-Image" || m == "Qwen/Qwen-Image" || m == SiliconFlowImageEditModel
}
func IsSiliconFlowSpeechModel(m string) bool {
	return m == "FunAudioLLM/CosyVoice2-0.5B" || m == "fnlp/MOSS-TTSD-v0.5"
}
func IsSiliconFlowTranscribeModel(m string) bool {
	return m == "FunAudioLLM/SenseVoiceSmall" || m == "TeleAI/TeleSpeechASR"
}
func SiliconFlowSpeechVoices(model string) []string {
	if !IsSiliconFlowSpeechModel(model) {
		return nil
	}
	out := []string{}
	for _, v := range strings.Fields("alex benjamin charles david anna bella claire diana") {
		out = append(out, model+":"+v)
	}
	return out
}
func siliconFlowMediaUnsupported() error {
	return nativeCloudSpeechUnsupported("The selected SiliconFlow model does not support this exact media request")
}
func SiliconFlowImageDimensions(size string) (int, int, bool) {
	a, b, ok := strings.Cut(size, "x")
	if !ok {
		return 0, 0, false
	}
	w, e := strconv.Atoi(a)
	h, f := strconv.Atoi(b)
	return w, h, e == nil && f == nil && w > 0 && h > 0 && w <= 4096 && h <= 4096 && w*h <= 16<<20
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r051
func validateSiliconFlowMedia(req *runtimev1.SubmitScenarioJobRequest, model string, mode CloudMediaStreamMode) error {
	if len(req.GetExtensions()) > 0 || mode != CloudMediaStreamNone {
		return siliconFlowMediaUnsupported()
	}
	if s := req.GetSpec().GetImageGenerate(); s != nil {
		if !IsSiliconFlowImageModel(model) || s.GetMask() != "" || s.GetMaskArtifactId() != "" || s.GetMarkup() != "" || s.GetMarkupArtifactId() != "" || s.GetAspectRatio() != "" || s.GetQuality() != "" || s.GetStyle() != "" || s.GetOutputFormat() != "" || s.GetComplexity() != "" || s.Strength != nil || s.FrameCount != nil || s.FrameDurationMs != nil {
			return siliconFlowMediaUnsupported()
		}
		if s.N == nil {
			s.N = proto.Int32(1)
		}
		if s.GetN() != 1 {
			return siliconFlowMediaUnsupported()
		}
		if s.GetResponseFormat() != "" && s.GetResponseFormat() != "url" {
			return siliconFlowMediaUnsupported()
		}
		if s.Seed != nil && (s.GetSeed() < 0 || s.GetSeed() > 9999999999) {
			return siliconFlowMediaUnsupported()
		}
		if model == SiliconFlowImageEditModel {
			if s.GetSize() != "" || len(s.GetReferenceImages()) > 3 || s.GetReferenceImageArtifactId() == "" && len(s.GetReferenceImages()) == 0 || s.GetReferenceImageArtifactId() != "" && len(s.GetReferenceImages()) != 0 {
				return siliconFlowMediaUnsupported()
			}
		} else {
			if s.GetReferenceImageArtifactId() != "" || len(s.GetReferenceImages()) != 0 {
				return siliconFlowMediaUnsupported()
			}
			if s.GetSize() == "" {
				s.Size = "1024x1024"
				if model == "Qwen/Qwen-Image" {
					s.Size = "1328x1328"
				}
			}
			if _, _, ok := SiliconFlowImageDimensions(s.GetSize()); !ok {
				return siliconFlowMediaUnsupported()
			}
		}
		for _, raw := range s.GetReferenceImages() {
			u, err := url.Parse(raw)
			if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Fragment != "" {
				return siliconFlowMediaUnsupported()
			}
		}
		return nil
	}
	if s := req.GetSpec().GetSpeechSynthesize(); s != nil {
		if !IsSiliconFlowSpeechModel(model) || s.GetVoiceRef().GetKind() != runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET || !contains(SiliconFlowSpeechVoices(model), s.GetVoiceRef().GetPresetVoiceId()) || strings.TrimSpace(s.GetText()) == "" || utf8.RuneCountInString(s.GetText()) > 128000 {
			return siliconFlowMediaUnsupported()
		}
		if s.GetLanguage() != "" || s.Pitch != nil || s.Volume != nil || s.GetEmotion() != "" || s.GetVoiceRenderHints() != nil || s.GetIdentityAudio() != nil || s.GetPerformanceAudio() != nil || s.GetTimingMode() != runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_UNSPECIFIED && s.GetTimingMode() != runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_NONE {
			return siliconFlowMediaUnsupported()
		}
		if s.Speed != nil && (math.IsNaN(float64(s.GetSpeed())) || math.IsInf(float64(s.GetSpeed()), 0) || s.GetSpeed() < .25 || s.GetSpeed() > 4) {
			return siliconFlowMediaUnsupported()
		}
		if s.GetAudioFormat() == "" {
			s.AudioFormat = "mp3"
		}
		if s.GetAudioFormat() != "mp3" && s.GetAudioFormat() != "wav" {
			return siliconFlowMediaUnsupported()
		}
		if s.SampleRateHz == nil {
			s.SampleRateHz = proto.Int32(44100)
		}
		if s.GetAudioFormat() == "mp3" {
			if s.GetSampleRateHz() != 32000 && s.GetSampleRateHz() != 44100 {
				return siliconFlowMediaUnsupported()
			}
		} else {
			switch s.GetSampleRateHz() {
			case 8000, 16000, 24000, 32000, 44100:
			default:
				return siliconFlowMediaUnsupported()
			}
		}
		return nil
	}
	if s := req.GetSpec().GetSpeechTranscribe(); s != nil {
		if !IsSiliconFlowTranscribeModel(model) || s.GetLanguage() != "" || s.GetPrompt() != "" || s.GetTimestamps() || s.GetDiarization() || s.GetSpeakerCount() != 0 || s.GetResponseFormat() != "" && s.GetResponseFormat() != "text" {
			return siliconFlowMediaUnsupported()
		}
		if len(s.GetAudioSource().GetAudioBytes()) == 0 || len(s.GetAudioSource().GetAudioBytes()) > 50_000_000 || s.GetMimeType() != "audio/wav" && s.GetMimeType() != "audio/mpeg" {
			return siliconFlowMediaUnsupported()
		}
		return nil
	}
	return siliconFlowMediaUnsupported()
}

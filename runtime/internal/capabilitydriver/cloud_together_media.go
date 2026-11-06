package capabilitydriver

import (
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

const CloudMediaAdapterTogetherImage = "together_images_v1_adapter"
const CloudMediaAdapterTogetherVideo = "together_video_v2_adapter"
const CloudMediaAdapterTogetherSpeech = "together_speech_v1_adapter"
const CloudMediaAdapterTogetherTranscribe = "together_transcribe_v1_adapter"
const TogetherSpeechModel = "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"

func IsTogetherImageModel(m string) bool {
	return m == "black-forest-labs/FLUX.2-dev" || m == "black-forest-labs/FLUX.2-pro"
}
func IsTogetherVideoModel(m string) bool { return m == "Wan-AI/wan2.7-t2v" || m == "Wan-AI/wan2.7-i2v" }
func IsTogetherTranscribeModel(m string) bool {
	return m == "openai/whisper-large-v3" || m == "nvidia/parakeet-tdt-0.6b-v3" || m == "nvidia/nemotron-3.5-asr-streaming-0.6b"
}
func TogetherSpeechVoices() []string {
	return strings.Fields("vivian serena uncle_fu dylan eric ryan aiden ono_anna sohee")
}
func togetherMediaUnsupported() error {
	return nativeCloudSpeechUnsupported("The selected Together model does not support this exact media request")
}
func TogetherImageDimensions(size string) (int, int, bool) {
	a, b, ok := strings.Cut(size, "x")
	if !ok {
		return 0, 0, false
	}
	w, e := strconv.Atoi(a)
	h, f := strconv.Atoi(b)
	return w, h, e == nil && f == nil && w >= 256 && h >= 256 && w <= 1920 && h <= 1920 && w%8 == 0 && h%8 == 0
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r051
func validateTogetherMedia(req *runtimev1.SubmitScenarioJobRequest, model string, mode CloudMediaStreamMode) error {
	if len(req.GetExtensions()) > 0 || mode != CloudMediaStreamNone {
		return togetherMediaUnsupported()
	}
	if s := req.GetSpec().GetImageGenerate(); s != nil {
		if !IsTogetherImageModel(model) || s.GetNegativePrompt() != "" || s.GetStyle() != "" || s.GetQuality() != "" || s.GetComplexity() != "" || s.GetMask() != "" || s.GetMaskArtifactId() != "" || s.GetMarkup() != "" || s.GetMarkupArtifactId() != "" || s.GetReferenceImageArtifactId() != "" || s.Strength != nil || s.FrameCount != nil || s.FrameDurationMs != nil {
			return togetherMediaUnsupported()
		}
		if s.N == nil {
			s.N = proto.Int32(1)
		}
		if s.GetN() < 1 || s.GetN() > 4 {
			return togetherMediaUnsupported()
		}
		if s.GetSize() == "" {
			s.Size = "1024x768"
			if s.GetAspectRatio() != "" {
				s.Size = map[string]string{"1:1": "1024x1024", "4:3": "1024x768", "3:4": "768x1024", "16:9": "1024x576", "9:16": "576x1024", "3:2": "1536x1024", "2:3": "1024x1536"}[s.GetAspectRatio()]
			}
		}
		w, h, ok := TogetherImageDimensions(s.GetSize())
		if !ok {
			return togetherMediaUnsupported()
		}
		if s.GetAspectRatio() != "" {
			a, b, ok := strings.Cut(s.GetAspectRatio(), ":")
			x, e := strconv.Atoi(a)
			y, f := strconv.Atoi(b)
			if !ok || e != nil || f != nil || x <= 0 || y <= 0 || x > 100 || y > 100 || w*y != h*x {
				return togetherMediaUnsupported()
			}
		}
		if s.Seed != nil && (s.GetSeed() < 0 || s.GetSeed() > 2147483647) {
			return togetherMediaUnsupported()
		}
		if s.GetResponseFormat() != "" && s.GetResponseFormat() != "base64" && s.GetResponseFormat() != "b64_json" {
			return togetherMediaUnsupported()
		}
		if s.GetOutputFormat() == "" {
			s.OutputFormat = "png"
		}
		if s.GetOutputFormat() != "png" && s.GetOutputFormat() != "jpeg" {
			return togetherMediaUnsupported()
		}
		if len(s.GetReferenceImages()) > 1 {
			return togetherMediaUnsupported()
		}
		for _, ref := range s.GetReferenceImages() {
			u, err := url.Parse(ref)
			if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Fragment != "" {
				return togetherMediaUnsupported()
			}
		}
		return nil
	}
	if s := req.GetSpec().GetVideoGenerate(); s != nil {
		if !IsTogetherVideoModel(model) || utf8.RuneCountInString(VideoPrompt(s)) > 32000 || utf8.RuneCountInString(s.GetNegativePrompt()) > 500 {
			return togetherMediaUnsupported()
		}
		first, last := 0, 0
		for _, c := range s.GetContent() {
			switch c.GetType() {
			case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT:
				if c.GetRole() != runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT && c.GetRole() != runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_UNSPECIFIED {
					return togetherMediaUnsupported()
				}
			case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF:
				if c.GetArtifactRef().GetArtifactId() == "" {
					return togetherMediaUnsupported()
				}
				switch c.GetRole() {
				case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME:
					first++
				case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_LAST_FRAME:
					last++
				default:
					return togetherMediaUnsupported()
				}
			default:
				return togetherMediaUnsupported()
			}
		}
		if strings.TrimSpace(VideoPrompt(s)) == "" {
			return togetherMediaUnsupported()
		}
		if model == "Wan-AI/wan2.7-t2v" {
			if s.GetMode() != runtimev1.VideoMode_VIDEO_MODE_T2V || first+last != 0 {
				return togetherMediaUnsupported()
			}
		} else {
			if s.GetMode() == runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME {
				if first != 1 || last != 0 {
					return togetherMediaUnsupported()
				}
			} else if s.GetMode() == runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST {
				if first != 1 || last != 1 {
					return togetherMediaUnsupported()
				}
			} else {
				return togetherMediaUnsupported()
			}
		}
		if s.Options == nil {
			s.Options = &runtimev1.VideoGenerationOptions{}
		}
		o := s.Options
		if o.DurationSec == nil {
			o.DurationSec = proto.Int32(5)
		}
		if o.GetDurationSec() < 2 || o.GetDurationSec() > 15 {
			return togetherMediaUnsupported()
		}
		if o.GetResolution() == "" {
			o.Resolution = "1080p"
		}
		if o.GetResolution() != "720p" && o.GetResolution() != "1080p" {
			return togetherMediaUnsupported()
		}
		if o.GetRatio() == "" {
			o.Ratio = "16:9"
		}
		if !contains(strings.Fields("16:9 9:16 1:1 4:3 3:4"), o.GetRatio()) {
			return togetherMediaUnsupported()
		}
		if o.Seed != nil && (o.GetSeed() < 0 || o.GetSeed() > 2147483647) || o.Frames != nil || o.Fps != nil && o.GetFps() != 30 || o.CameraFixed != nil || o.Watermark != nil || o.Draft != nil || o.ReturnLastFrame != nil || o.GetServiceTier() != "" || o.GetExecutionExpiresAfterSec() != 0 || o.GenerateAudio != nil && !o.GetGenerateAudio() {
			return togetherMediaUnsupported()
		}
		o.GenerateAudio = proto.Bool(true)
		o.Fps = proto.Int32(30)
		return nil
	}
	if s := req.GetSpec().GetSpeechSynthesize(); s != nil {
		if model != TogetherSpeechModel || s.GetVoiceRef().GetKind() != runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET || !contains(TogetherSpeechVoices(), s.GetVoiceRef().GetPresetVoiceId()) || strings.TrimSpace(s.GetText()) == "" || utf8.RuneCountInString(s.GetText()) > 4096 {
			return togetherMediaUnsupported()
		}
		if s.Speed != nil || s.Pitch != nil || s.Volume != nil || s.GetEmotion() != "" || s.GetVoiceRenderHints() != nil || s.GetIdentityAudio() != nil || s.GetPerformanceAudio() != nil || s.GetTimingMode() != runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_UNSPECIFIED && s.GetTimingMode() != runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_NONE {
			return togetherMediaUnsupported()
		}
		if s.GetLanguage() == "" {
			s.Language = "en"
		}
		if !contains(strings.Fields("zh en fr de it ja ko pt ru es"), s.GetLanguage()) {
			return togetherMediaUnsupported()
		}
		if s.GetAudioFormat() == "" {
			s.AudioFormat = "wav"
		}
		if s.GetAudioFormat() != "wav" && s.GetAudioFormat() != "mp3" {
			return togetherMediaUnsupported()
		}
		if s.SampleRateHz == nil {
			s.SampleRateHz = proto.Int32(24000)
		}
		if s.GetSampleRateHz() != 8000 && s.GetSampleRateHz() != 24000 {
			return togetherMediaUnsupported()
		}
		return nil
	}
	if s := req.GetSpec().GetSpeechTranscribe(); s != nil {
		if !IsTogetherTranscribeModel(model) || s.GetDiarization() || s.GetSpeakerCount() != 0 || s.GetResponseFormat() != "" && s.GetResponseFormat() != "text" || s.GetLanguage() != "" && !mistralAudioLanguage.MatchString(s.GetLanguage()) {
			return togetherMediaUnsupported()
		}
		if model != "openai/whisper-large-v3" && (s.GetPrompt() != "" || s.GetTimestamps() || s.GetLanguage() != "") {
			return togetherMediaUnsupported()
		}
		if len(s.GetAudioSource().GetAudioBytes()) == 0 || len(s.GetAudioSource().GetAudioBytes()) > 79_000_000 || s.GetMimeType() != "audio/wav" && s.GetMimeType() != "audio/mpeg" {
			return togetherMediaUnsupported()
		}
		return nil
	}
	return togetherMediaUnsupported()
}

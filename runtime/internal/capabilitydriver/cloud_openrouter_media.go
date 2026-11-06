package capabilitydriver

import (
	"strings"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

const CloudMediaAdapterOpenRouterImage = "openrouter_images_v1_adapter"
const CloudMediaAdapterOpenRouterVideo = "openrouter_video_v1_adapter"
const CloudMediaAdapterOpenRouterSpeech = "openrouter_speech_v1_adapter"
const CloudMediaAdapterOpenRouterTranscribe = "openrouter_transcribe_v1_adapter"

func openRouterMediaUnsupported() error {
	return nativeCloudSpeechUnsupported("The selected OpenRouter model does not support this exact request combination")
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r051
func validateOpenRouterMedia(req *runtimev1.SubmitScenarioJobRequest, model string, mode CloudMediaStreamMode) error {
	if len(req.GetExtensions()) > 0 || mode != CloudMediaStreamNone {
		return openRouterMediaUnsupported()
	}
	if s := req.GetSpec().GetImageGenerate(); s != nil {
		if !IsOpenRouterImageModel(model) || s.GetNegativePrompt() != "" || s.GetMask() != "" || s.GetMaskArtifactId() != "" || len(s.GetReferenceImages()) > 0 || s.GetStyle() != "" || s.Seed != nil || s.Strength != nil || s.FrameCount != nil || s.FrameDurationMs != nil || s.GetMarkup() != "" || s.GetMarkupArtifactId() != "" {
			return openRouterMediaUnsupported()
		}
		if s.GetResponseFormat() != "" && s.GetResponseFormat() != "b64_json" && s.GetResponseFormat() != "base64" {
			return openRouterMediaUnsupported()
		}
		if s.N == nil {
			s.N = proto.Int32(1)
		}
		if model == "google/gemini-nano-banana-2.1" {
			if s.GetN() != 1 || s.GetQuality() != "" || s.GetOutputFormat() != "" || s.GetComplexity() != "" {
				return openRouterMediaUnsupported()
			}
			if s.GetSize() == "" {
				s.Size = "1K"
			}
			if !contains([]string{"1K", "2K", "4K"}, s.GetSize()) {
				return openRouterMediaUnsupported()
			}
			if s.GetAspectRatio() != "" && !contains(strings.Fields("1:1 1:4 1:8 2:3 3:2 3:4 4:1 4:3 4:5 5:4 8:1 9:16 16:9 21:9"), s.GetAspectRatio()) {
				return openRouterMediaUnsupported()
			}
		} else {
			if s.GetN() < 1 || s.GetN() > 10 || s.GetSize() != "" && s.GetSize() != "auto" && !openAIImageRecommendedSizes[s.GetSize()] || s.GetQuality() != "" && !contains(strings.Fields("auto low medium high"), s.GetQuality()) {
				return openRouterMediaUnsupported()
			}
			if s.GetAspectRatio() != "" && !contains(strings.Fields("1:1 3:2 2:3 4:3 3:4 16:9 9:16 21:9 auto"), s.GetAspectRatio()) {
				return openRouterMediaUnsupported()
			}
			if s.GetSize() != "" && s.GetSize() != "auto" && s.GetAspectRatio() != "" && s.GetAspectRatio() != "auto" {
				want := map[string]string{"1024x1024": "1:1", "1536x1024": "3:2", "1024x1536": "2:3"}[s.GetSize()]
				if want != s.GetAspectRatio() {
					return openRouterMediaUnsupported()
				}
			}
			if s.GetOutputFormat() == "" {
				s.OutputFormat = "png"
			}
			if !contains(strings.Fields("png jpeg webp"), s.GetOutputFormat()) {
				return openRouterMediaUnsupported()
			}
			if err := ValidateImageControls(s); err != nil {
				return err
			}
		}
		return nil
	}
	if s := req.GetSpec().GetVideoGenerate(); s != nil {
		if model != OpenRouterVideoModel || s.GetMode() == runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE {
			return openRouterMediaUnsupported()
		}
		for _, c := range s.GetContent() {
			if c.GetType() != runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT && c.GetType() != runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF {
				return openRouterMediaUnsupported()
			}
		}
		if s.Options == nil {
			s.Options = &runtimev1.VideoGenerationOptions{}
		}
		o := s.Options
		if o.GetGenerateAudio() == false && o.GenerateAudio != nil {
			return openRouterMediaUnsupported()
		}
		copy := proto.Clone(req).(*runtimev1.SubmitScenarioJobRequest)
		copy.GetSpec().GetVideoGenerate().Options.GenerateAudio = nil
		if err := validateGeminiOmniVideoRequest(copy, GeminiOmni12VideoModel); err != nil {
			return err
		}
		if o.DurationSec == nil {
			o.DurationSec = proto.Int32(3)
		}
		if o.GetResolution() == "" {
			o.Resolution = "720p"
		}
		if o.GetRatio() == "" {
			o.Ratio = "16:9"
		}
		o.GenerateAudio = proto.Bool(true)
		return nil
	}
	if s := req.GetSpec().GetSpeechSynthesize(); s != nil {
		if model != OpenRouterSpeechModel || s.GetVoiceRef().GetKind() != runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET || !contains(OpenRouterSpeechVoices(), s.GetVoiceRef().GetPresetVoiceId()) || strings.TrimSpace(s.GetText()) == "" || utf8.RuneCountInString(s.GetText()) > 4096 {
			return openRouterMediaUnsupported()
		}
		if s.GetLanguage() != "" || s.Speed != nil || s.Pitch != nil || s.Volume != nil || s.GetEmotion() != "" || s.SampleRateHz != nil || s.GetVoiceRenderHints() != nil || s.GetIdentityAudio() != nil || s.GetPerformanceAudio() != nil || s.GetTimingMode() != runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_UNSPECIFIED && s.GetTimingMode() != runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_NONE {
			return openRouterMediaUnsupported()
		}
		if s.GetAudioFormat() != "" && s.GetAudioFormat() != "mp3" {
			return openRouterMediaUnsupported()
		}
		s.AudioFormat = "mp3"
		return nil
	}
	if s := req.GetSpec().GetSpeechTranscribe(); s != nil {
		// Both reviewed gateway targets reject verbose_json. Origin-provider
		// timestamp support does not establish support through this gateway.
		if !IsOpenRouterTranscribeModel(model) || s.GetPrompt() != "" || s.GetDiarization() || s.GetSpeakerCount() != 0 || s.GetResponseFormat() != "" && s.GetResponseFormat() != "text" || s.GetLanguage() != "" && !mistralAudioLanguage.MatchString(s.GetLanguage()) || s.GetTimestamps() {
			return openRouterMediaUnsupported()
		}
		if len(s.GetAudioSource().GetAudioBytes()) == 0 || len(s.GetAudioSource().GetAudioBytes()) > 25_000_000 || s.GetMimeType() != "audio/wav" && s.GetMimeType() != "audio/mpeg" {
			return openRouterMediaUnsupported()
		}
		return nil
	}
	return openRouterMediaUnsupported()
}

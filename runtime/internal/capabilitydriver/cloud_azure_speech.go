package capabilitydriver

import (
	"regexp"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

var azureSpeechVoice = regexp.MustCompile(`^([a-z]{2,3}-[A-Za-z]{2})-[A-Za-z0-9]+(?::[A-Za-z0-9.\-]+)?$`)
var azureOpenAIVoice = regexp.MustCompile(`^en-US-(Alloy|Echo|Fable|Onyx|Nova|Shimmer)MultilingualNeural(?:HD)?$`)

// These are provider-published per-voice style sets, not free-form instructions.
var azureFlashVoiceStyles = map[string]string{
	"zh-CN-Xiaoxiao":   "angry chat cheerful customer-service excited fearful sad voice-assistant",
	"zh-CN-Xiaoxiao2":  "affectionate angry anxious cheerful curious disappointed empathetic encouraging excited fearful guilty lonely poetry-reading sad sentimental sorry story surprised tired whispering",
	"zh-CN-Xiaochen":   "cheerful debating empathetic live-commercial poetry-reading sad sorry",
	"zh-CN-Xiaoyi":     "angry complaining cute gentle nervous sad shy strict",
	"zh-CN-Xiaoyu":     "angry debating cheerful comforting sad sorry",
	"zh-CN-Xiaohan":    "affectionate angry cheerful complaining fearful gentle sad shy strict",
	"zh-CN-Xiaoshuang": "chat",
	"zh-CN-Xiaoyou":    "chat angry cheerful poetry-reading sad story cute",
	"zh-CN-Yunxi":      "angry chat cheerful complaining depressed fearful news sad shy strict voice-assistant",
	"zh-CN-Yunyi":      "assassin captain cavalier prince game-narrator geomancer poet",
	"zh-CN-Yunxiao":    "",
	"zh-CN-Yunhan":     "angry cheerful curious empathetic encouraging excited guilty lonely sad serious sorry whispering surprised tired",
	"zh-CN-Yunxia":     "affectionate angry cheerful comforting encouraging excited fearful sad surprised",
	"zh-CN-Yunye":      "", "en-US-Tiana": "", "en-US-Tyler": "", "en-US-Jimmie": "",
}
var azureMAIVoiceStyles = map[string]string{
	"en-US-Grant":   "agent audiobook customer_call_center educational narrator neutral",
	"en-US-Harper":  "agent angry audiobook confused customer_call_center determined educational embarrassed excited happy hopeful joyful narrator neutral regretful relieved sad shouting softvoice whispering",
	"es-MX-Valeria": "angry confused determined disgusted embarrassed excited fearful happy hopeful jealous joyful neutral regretful relieved sad shouting softvoice surprised whispering",
	"fr-FR-Harper":  "agent audiobook customer_call_center educational narrator neutral",
	"ko-KR-Harper":  "agent audiobook customer_call_center educational narrator neutral",
	"zh-CN-Bo":      "angry confused determined disgusted embarrassed excited fearful happy hopeful jealous joyful neutral regretful relieved sad shouting softvoice surprised whispering",
	"zh-CN-Mei":     "angry confused determined disgusted embarrassed excited fearful happy hopeful jealous joyful neutral regretful relieved sad shouting softvoice surprised whispering",
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r051
func validateAzureSpeechRequest(req *runtimev1.SubmitScenarioJobRequest, model string, mode CloudMediaStreamMode) error {
	s := req.GetSpec().GetSpeechSynthesize()
	if s == nil || mode != CloudMediaStreamNone || len(req.GetExtensions()) != 0 || s.Speed != nil || s.Pitch != nil || s.Volume != nil || s.GetVoiceRenderHints() != nil || s.GetIdentityAudio() != nil || s.GetPerformanceAudio() != nil || s.GetTimingMode() != runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_UNSPECIFIED && s.GetTimingMode() != runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_NONE || strings.TrimSpace(s.GetText()) == "" || len(s.GetText()) > 8192 {
		return nativeCloudSpeechUnsupported("Azure Speech accepts up to 8 KiB of plain text, one exact voice and complete audio; reset unsupported delivery, timing or streaming controls")
	}
	voice := ""
	switch s.GetVoiceRef().GetKind() {
	case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET:
		voice = s.GetVoiceRef().GetPresetVoiceId()
	case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF:
		voice = s.GetVoiceRef().GetProviderVoiceRef()
	}
	parts := azureSpeechVoice.FindStringSubmatch(voice)
	if parts == nil {
		return nativeCloudSpeechUnsupported("Choose a native Azure Speech voice name")
	}
	styles := ""
	valid := false
	switch model {
	case "azure-neural-tts":
		valid = !strings.Contains(voice, ":") && strings.HasSuffix(voice, "Neural") && !azureOpenAIVoice.MatchString(voice)
	case "azure-openai-tts-preview":
		valid = azureOpenAIVoice.MatchString(voice)
	case "azure-hd-tts":
		valid = strings.HasSuffix(voice, ":DragonHDLatestNeural") || strings.HasSuffix(voice, ":DragonHDOmniLatestNeural")
	case "azure-hd-flash-tts":
		if strings.HasSuffix(voice, ":DragonHDFlashLatestNeural") {
			styles, valid = azureFlashVoiceStyles[strings.TrimSuffix(voice, ":DragonHDFlashLatestNeural")]
		}
	case "azure-mai-voice-2.1", "azure-mai-voice-2.1-flash":
		suffix := ":MAI-Voice-2.1"
		if model == "azure-mai-voice-2.1-flash" {
			suffix += "-Flash"
		}
		if strings.HasSuffix(voice, suffix) {
			// A caller may supply another native prebuilt voice in this exact
			// family. Only reviewed per-voice styles are admitted locally.
			styles, valid = azureMAIVoiceStyles[strings.TrimSuffix(voice, suffix)], true
		}
	}
	if !valid || s.GetEmotion() != "" && !contains(strings.Fields(styles), s.GetEmotion()) {
		return nativeCloudSpeechUnsupported("The selected voice or style does not belong to this reviewed Azure Speech model")
	}
	locale := parts[1][:len(parts[1])-2] + strings.ToUpper(parts[1][len(parts[1])-2:])
	if s.GetLanguage() == "" {
		s.Language = locale
	}
	if s.GetLanguage() != locale {
		return nativeCloudSpeechUnsupported("Choose a voice in the requested language for this single-speaker composition")
	}
	if s.GetAudioFormat() == "" {
		s.AudioFormat = "mp3"
	}
	defaultRate := int32(24000)
	if s.GetAudioFormat() == "ogg" {
		defaultRate = 48000
	}
	if s.SampleRateHz == nil {
		s.SampleRateHz = proto.Int32(defaultRate)
	}
	rate := s.GetSampleRateHz()
	switch s.GetAudioFormat() {
	case "mp3":
		valid = rate == 16000 || rate == 24000 || rate == 48000
	case "wav":
		valid = rate == 8000 || rate == 22050 || rate == 24000 || rate == 44100 || rate == 48000
	case "pcm":
		valid = rate == 8000 || rate == 16000 || rate == 22050 || rate == 24000 || rate == 44100 || rate == 48000
	case "ogg":
		valid = rate == 48000
	default:
		valid = false
	}
	if !valid {
		return nativeCloudSpeechUnsupported("Choose a supported Azure Speech format and sample rate; Ogg Opus uses a 48 kHz decoding clock")
	}
	return nil
}

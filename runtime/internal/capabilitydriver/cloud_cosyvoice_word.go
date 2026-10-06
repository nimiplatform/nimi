package capabilitydriver

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.r071
// The provider's exact system-voice table declares timestamp support. Private
// provider references have already passed the voice-asset owner/target checks.
func ValidateCosyVoiceWordRequest(model string, spec *runtimev1.SpeechSynthesizeScenarioSpec) error {
	if spec == nil || spec.GetTimingMode() != runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_WORD {
		return nil
	}
	if model != "cosyvoice-v3-plus" && model != "cosyvoice-v3-flash" {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	voice := spec.GetVoiceRef()
	if voice.GetKind() == runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET {
		id := strings.TrimSpace(voice.GetPresetVoiceId())
		allowed := id == "longanyang" || id == "longanhuan"
		if model == "cosyvoice-v3-flash" {
			switch id {
			case "longanhuan_v3", "longhuhu_v3", "longpaopao_v3", "longanyue_v3", "longlaotie_v3", "longxiaochun_v3", "loongbella_v3":
				allowed = true
			}
		}
		if !allowed {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
	} else if voice.GetKind() != runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	if strings.EqualFold(spec.GetAudioFormat(), "opus") && spec.SampleRateHz != nil {
		switch spec.GetSampleRateHz() {
		case 8000, 12000, 16000, 24000, 48000:
		default:
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
	}
	return nil
}

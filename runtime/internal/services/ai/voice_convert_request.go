package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.voice-conversion
func validateVoiceConvertSpec(spec *runtimev1.AudioVoiceConvertScenarioSpec) error {
	invalid := func() error {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if spec == nil || !localAppBoundedIdentifier(spec.GetSourceVocal().GetArtifactId()) {
		return invalid()
	}
	if spec.GetSourceKind() != runtimev1.VoiceConvertSourceKind_VOICE_CONVERT_SOURCE_KIND_SINGING {
		return invalid()
	}
	if r := spec.GetSourceVocal().GetRange(); r != nil && (r.GetEndFrame() <= r.GetStartFrame() || r.GetEndFrame() > 96000*600) {
		return invalid()
	}
	target := spec.GetTargetVoice()
	if target == nil {
		return invalid()
	}
	carriers := 0
	if target.GetReferenceAudio() != nil {
		carriers++
		if !localAppBoundedIdentifier(target.GetReferenceAudio().GetArtifactId()) {
			return invalid()
		}
		if target.GetReferenceAudio().GetArtifactId() == spec.GetSourceVocal().GetArtifactId() {
			return invalid()
		}
		if r := target.GetReferenceAudio().GetRange(); r != nil && (r.GetEndFrame() <= r.GetStartFrame() || r.GetEndFrame() > 96000*600) {
			return invalid()
		}
	}
	if target.GetPresetVoiceId() != "" {
		carriers++
		if !localAppBoundedIdentifier(target.GetPresetVoiceId()) {
			return invalid()
		}
	}
	if target.GetVoiceAssetId() != "" {
		carriers++
		if !localAppBoundedIdentifier(target.GetVoiceAssetId()) {
			return invalid()
		}
	}
	if carriers != 1 {
		return invalid()
	}
	if spec.SemitoneShift != nil {
		if shift := spec.GetSemitoneShift(); shift < -12 || shift > 12 {
			return invalid()
		}
	}
	return nil
}

func canonicalVoiceConvertSpec(spec *runtimev1.AudioVoiceConvertScenarioSpec) *runtimev1.AudioVoiceConvertScenarioSpec {
	return proto.Clone(spec).(*runtimev1.AudioVoiceConvertScenarioSpec)
}

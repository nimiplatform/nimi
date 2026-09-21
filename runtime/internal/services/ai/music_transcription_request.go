package ai

import (
	"sort"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

func validateMusicTranscriptionSpec(spec *runtimev1.MusicTranscribeScenarioSpec) error {
	invalid := func() error {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if spec == nil || !localAppBoundedIdentifier(spec.GetSourceAudio().GetArtifactId()) || len(spec.GetRequestedFormats()) < 1 || len(spec.GetRequestedFormats()) > 3 || len(spec.GetRequestedParts()) < 1 || len(spec.GetRequestedParts()) > 3 {
		return invalid()
	}
	if r := spec.GetSourceAudio().GetRange(); r != nil && (r.GetEndFrame() <= r.GetStartFrame() || r.GetEndFrame() > 96000*600) {
		return invalid()
	}
	formats := map[runtimev1.MusicTranscriptionFormat]bool{}
	for _, value := range spec.GetRequestedFormats() {
		if value < runtimev1.MusicTranscriptionFormat_MUSIC_TRANSCRIPTION_FORMAT_ABC || value > runtimev1.MusicTranscriptionFormat_MUSIC_TRANSCRIPTION_FORMAT_TIMELINE || formats[value] {
			return invalid()
		}
		formats[value] = true
	}
	parts := map[runtimev1.MusicTranscriptionPart]bool{}
	for _, value := range spec.GetRequestedParts() {
		if value < runtimev1.MusicTranscriptionPart_MUSIC_TRANSCRIPTION_PART_VOCAL_MELODY || value > runtimev1.MusicTranscriptionPart_MUSIC_TRANSCRIPTION_PART_FULL_ARRANGEMENT || parts[value] {
			return invalid()
		}
		parts[value] = true
	}
	return nil
}

func canonicalMusicTranscriptionSpec(spec *runtimev1.MusicTranscribeScenarioSpec) *runtimev1.MusicTranscribeScenarioSpec {
	cloned := proto.Clone(spec).(*runtimev1.MusicTranscribeScenarioSpec)
	sort.Slice(cloned.RequestedFormats, func(i, j int) bool { return cloned.RequestedFormats[i] < cloned.RequestedFormats[j] })
	sort.Slice(cloned.RequestedParts, func(i, j int) bool { return cloned.RequestedParts[i] < cloned.RequestedParts[j] })
	return cloned
}

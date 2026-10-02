package ai

import (
	"context"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/audiomedia"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"strings"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.r112
func (s *Service) captureSpeechReferences(ctx context.Context, head *runtimev1.ScenarioRequestHead, spec *runtimev1.SpeechSynthesizeScenarioSpec, capabilities *runtimev1.SpeechInputCapabilities) (*capabilitydriver.SpeechReferenceInputs, error) {
	if spec.GetIdentityAudio() == nil && spec.GetPerformanceAudio() == nil {
		return nil, nil
	}
	if capabilities == nil || (spec.GetIdentityAudio() != nil && !capabilities.GetSupportsIdentityAudio()) || (spec.GetPerformanceAudio() != nil && !capabilities.GetSupportsPerformanceAudio()) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	if spec.GetPerformanceAudio() != nil && (len(spec.GetPerformanceAudio().GetText()) > int(capabilities.GetMaxPerformanceTextBytes()) || strings.TrimSpace(spec.GetPerformanceAudio().GetText()) == "") {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	}
	capture := func(id string) ([]byte, error) {
		source, err := s.openMusicInputSource(ctx, head, id)
		if err != nil {
			return nil, err
		}
		defer source.Body.Close()
		info := source.Record.CanonicalAudio
		if info == nil || source.Record.MimeType != "audio/wav" || info.SampleRateHz == 0 || info.FrameCount > uint64(info.SampleRateHz)*uint64(capabilities.GetMaxReferenceDurationSeconds()) {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
		}
		result, err := audiomedia.ReadRange(ctx, source.Body, audiomedia.Facts{SampleRateHz: info.SampleRateHz, Channels: info.Channels, FrameCount: info.FrameCount, SizeBytes: source.Record.SizeBytes, DataOffset: info.DataOffset}, 0, info.FrameCount, int64(capabilities.GetMaxReferenceBytes()))
		if err != nil {
			return nil, err
		}
		return result, nil
	}
	references := &capabilitydriver.SpeechReferenceInputs{}
	var err error
	if input := spec.GetIdentityAudio(); input != nil {
		references.IdentityAudio, err = capture(input.GetArtifactId())
		if err != nil {
			return nil, err
		}
	}
	if input := spec.GetPerformanceAudio(); input != nil {
		references.PerformanceAudio, err = capture(input.GetArtifactId())
		if err != nil {
			return nil, err
		}
	}
	return references, nil
}

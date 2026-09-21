package ai

import (
	"context"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/audiomedia"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/grpc/codes"
	"time"
)

func (s *Service) openMusicInputSource(ctx context.Context, head *runtimev1.ScenarioRequestHead, id string) (*runtimeartifact.ArtifactSource, error) {
	if decision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(ctx); ok {
		return s.openAuthorizedLocalAppArtifact(ctx, decision, id, localAppArtifactOperationInput)
	}
	source, ok := s.runtimeArtifacts.Open(ctx, id)
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_ARTIFACT_NOT_FOUND)
	}
	owner := runtimeArtifactOwner(head)
	if owner == nil || source.Record.Owner == nil || source.Record.Owner.RegisteredAppSubject != "" || source.Record.Owner.SubjectUserID != owner.SubjectUserID || source.Record.Owner.AppID != owner.AppID || (!source.Record.MusicRecoveryUntil.IsZero() && !time.Now().Before(source.Record.MusicRecoveryUntil)) {
		_ = source.Body.Close()
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_ARTIFACT_FORBIDDEN)
	}
	return source, nil
}

func (s *Service) captureCloudMusicReference(ctx context.Context, head *runtimev1.ScenarioRequestHead, ref *runtimev1.MusicAudioInput) (*nimillm.MusicReferenceAudio, error) {
	if ref == nil {
		return nil, nil
	}
	source, err := s.openMusicInputSource(ctx, head, ref.GetArtifactId())
	if err != nil {
		return nil, err
	}
	defer source.Body.Close()
	info := source.Record.CanonicalAudio
	if info == nil || source.Record.MimeType != "audio/wav" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	}
	start, end := uint64(0), info.FrameCount
	if region := ref.GetRange(); region != nil {
		start, end = region.GetStartFrame(), region.GetEndFrame()
	}
	data, err := audiomedia.ReadRange(ctx, source.Body, audiomedia.Facts{SampleRateHz: info.SampleRateHz, Channels: info.Channels, FrameCount: info.FrameCount, SizeBytes: source.Record.SizeBytes, DataOffset: info.DataOffset}, start, end, 32<<20)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	return &nimillm.MusicReferenceAudio{ArtifactID: ref.GetArtifactId(), MIMEType: "audio/wav", Bytes: data}, nil
}

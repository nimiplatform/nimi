package ai

import (
	"context"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/grpc/codes"
	"io"
	"path/filepath"
	"time"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.music-generation
func (s *Service) captureMusicVideoReference(ctx context.Context, head *runtimev1.ScenarioRequestHead, reference *runtimev1.MusicVideoReference, budgetSeconds int32) (captured *nimillm.MusicReferenceVideo, captureErr error) {
	source, err := s.openMusicInputSource(ctx, head, reference.GetArtifactId())
	if err != nil {
		return nil, err
	}
	defer func() { _ = source.Body.Close() }() // Input read errors determine capture; this close releases custody.
	if source.Record.MimeType != "video/mp4" || source.Record.SizeBytes <= 0 || source.Record.SizeBytes > 32<<20 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	}
	data, err := io.ReadAll(io.LimitReader(source.Body, (32<<20)+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) != source.Record.SizeBytes || len(data) > 32<<20 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	}
	inspector, ok := s.localVideoMedia.(interface {
		InspectDuration(context.Context, string) (time.Duration, error)
	})
	if !ok || !filepath.IsAbs(s.localMusicStagingRoot) {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_MEDIA_CODEC_UNAVAILABLE)
	}
	name := source.BorrowedFilePath()
	if !filepath.IsAbs(name) {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_MEDIA_CODEC_UNAVAILABLE)
	}
	duration, err := inspector.InspectDuration(ctx, name)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID, err, grpcerr.ReasonOptions{})
	}
	if budgetSeconds <= 0 || duration > time.Duration(budgetSeconds)*time.Second {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	return &nimillm.MusicReferenceVideo{ArtifactID: reference.GetArtifactId(), MIMEType: "video/mp4", Bytes: data}, nil
}

package ai

import (
	"bytes"
	"context"
	"errors"
	"io"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/musicscore"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *Service) uploadLocalAppMusicScore(ctx context.Context, decision accountservice.LocalAppCallerDecision, req *runtimev1.UploadLocalAppArtifactRequest) (*runtimev1.UploadLocalAppArtifactResponse, error) {
	if req.GetAudioPreparation() != nil || req.GetAppAssetRelativePath() != "" || req.GetSourceArtifactId() != "" || len(req.GetBytes()) == 0 || req.GetMimeType() != "text/vnd.abc" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ARTIFACT_UPLOAD_INVALID)
	}
	if len(req.GetBytes()) > musicscore.MaxBytes {
		return nil, grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_AI_ARTIFACT_UPLOAD_TOO_LARGE)
	}
	if err := musicscore.ValidateABC(req.GetBytes(), false); err != nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ARTIFACT_UPLOAD_INVALID)
	}
	id := "artifact_" + ulid.Make().String()
	if s.scenarioJobs == nil || s.runtimeArtifacts == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	release, err := s.scenarioJobs.beginMusicImport(id, musicscore.MaxBytes)
	if err != nil {
		if errors.Is(err, errMusicRecoveryCapacity) {
			return nil, localAppSubmissionError(err)
		}
		return nil, canonicalAudioInternalError(err)
	}
	defer release()
	until := time.Now().UTC().Add(musicRecoveryRetention)
	if err := s.runtimeArtifacts.PutStream(ctx, id, runtimeartifact.ArtifactRecord{MimeType: "text/vnd.abc", SizeBytes: int64(len(req.GetBytes())), MusicRecoveryUntil: until, Owner: &runtimeartifact.ArtifactOwner{SubjectUserID: decision.AccountID, RegisteredAppSubject: decision.RegisteredAppSubject, AppID: decision.AppID}}, io.NopCloser(bytes.NewReader(req.GetBytes()))); err != nil {
		return nil, canonicalAudioInternalError(err)
	}
	return &runtimev1.UploadLocalAppArtifactResponse{ArtifactId: id, MimeType: "text/vnd.abc", SizeBytes: int64(len(req.GetBytes())), ExpiresAt: timestamppb.New(until)}, nil
}

// Captures the owned score once. Its bounded content is stored with the
// immutable ResolvedAssembly, so later expiry cannot change an accepted Job.
func (s *Service) captureMusicScore(ctx context.Context, head *runtimev1.ScenarioRequestHead, spec *runtimev1.MusicGenerateScenarioSpec) ([]byte, error) {
	ref := spec.GetScore()
	if ref == nil {
		return nil, nil
	}
	if ref.GetFormat() != runtimev1.MusicScoreFormat_MUSIC_SCORE_FORMAT_ABC {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	source, err := s.openMusicInputSource(ctx, head, ref.GetArtifactId())
	if err != nil {
		return nil, err
	}
	defer func() { _ = source.Body.Close() }()
	if source.Record.MimeType != "text/vnd.abc" || source.Record.SizeBytes < 1 || source.Record.SizeBytes > musicscore.MaxBytes {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	}
	data, err := io.ReadAll(io.LimitReader(source.Body, musicscore.MaxBytes+1))
	if err != nil || len(data) != int(source.Record.SizeBytes) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	}
	if err := musicscore.ValidateABC(data, spec.GetScoreConditioning() == runtimev1.MusicScoreConditioning_MUSIC_SCORE_CONDITIONING_MELODY_ONLY); err != nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	}
	return data, nil
}

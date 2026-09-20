package ai

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
	"github.com/nimiplatform/nimi/runtime/internal/audiomedia"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
)

func (s *Service) SetCanonicalAudioPreparation(processor *audiomedia.Processor, stagingRoot string) {
	s.canonicalAudio, s.canonicalAudioStagingRoot = processor, stagingRoot
}

func (s *Service) SetLocalAppAudioSource(opener func(context.Context, appstorage.ManagedOwner, string) (*appstorage.AssetSource, error)) {
	s.localAppAudioSource = opener
}

// @nimi-authority: rule.nimi.runtime.ai-provider.canonical-audio-upload
func (s *Service) prepareLocalAppAudioArtifact(ctx context.Context, decision accountservice.LocalAppCallerDecision, req *runtimev1.UploadLocalAppArtifactRequest) (*runtimev1.UploadLocalAppArtifactResponse, error) {
	invalid := func() (*runtimev1.UploadLocalAppArtifactResponse, error) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ARTIFACT_UPLOAD_INVALID)
	}
	if req.GetAudioPreparation() == nil {
		return invalid()
	}
	sourceCount := 0
	for _, present := range []bool{len(req.GetBytes()) > 0, req.GetAppAssetRelativePath() != "", req.GetSourceArtifactId() != ""} {
		if present {
			sourceCount++
		}
	}
	mime := strings.TrimSpace(req.GetMimeType())
	rate := req.GetAudioPreparation().GetTargetSampleRateHz()
	if sourceCount != 1 || (mime != "audio/wav" && mime != "audio/mpeg" && mime != "audio/flac") || (rate != 0 && (rate < audiomedia.MinSampleRate || rate > audiomedia.MaxSampleRate)) {
		return invalid()
	}
	if len(req.GetBytes()) > runtimeartifact.MaxInlineBytes {
		return nil, grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_AI_ARTIFACT_UPLOAD_TOO_LARGE)
	}
	if req.GetAppAssetRelativePath() != "" {
		if _, err := appstorage.NormalizeAssetRelativePath(req.GetAppAssetRelativePath()); err != nil {
			return invalid()
		}
	}
	if req.GetSourceArtifactId() != "" && !localAppBoundedIdentifier(req.GetSourceArtifactId()) {
		return invalid()
	}
	if s.canonicalAudio == nil || s.runtimeArtifacts == nil || !filepath.IsAbs(s.canonicalAudioStagingRoot) {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	ctx, cancel := context.WithTimeout(ctx, audiomedia.PreparationTimeout)
	defer cancel()
	var source io.ReadCloser
	var expectedSize int64
	switch {
	case len(req.GetBytes()) != 0:
		source, expectedSize = io.NopCloser(bytes.NewReader(req.GetBytes())), int64(len(req.GetBytes()))
	case req.GetAppAssetRelativePath() != "":
		if s.localAppAudioSource == nil {
			return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
		}
		opened, err := s.localAppAudioSource(ctx, appstorage.ManagedOwner{AccountID: decision.AccountID, RegisteredAppSubject: decision.RegisteredAppSubject}, req.GetAppAssetRelativePath())
		if err != nil || opened == nil || opened.Body == nil {
			return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_ARTIFACT_FORBIDDEN)
		}
		source, expectedSize = opened.Body, opened.Record.SizeBytes
	case req.GetSourceArtifactId() != "":
		opened, err := s.openAuthorizedLocalAppArtifact(ctx, decision, req.GetSourceArtifactId(), localAppArtifactOperationAudioPreparation)
		if err != nil {
			return nil, err
		}
		source, expectedSize = opened.Body, opened.Record.SizeBytes
	}
	defer source.Close()
	if expectedSize <= 0 || expectedSize > audiomedia.MaxInputBytes {
		return nil, grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_AI_ARTIFACT_UPLOAD_TOO_LARGE)
	}
	if err := os.MkdirAll(s.canonicalAudioStagingRoot, 0700); err != nil {
		return nil, canonicalAudioInternalError(err)
	}
	directory, err := os.MkdirTemp(s.canonicalAudioStagingRoot, "prepare-")
	if err != nil {
		return nil, canonicalAudioInternalError(err)
	}
	defer os.Remove(directory)
	snapshot, err := os.CreateTemp(directory, "input-")
	if err != nil {
		return nil, canonicalAudioInternalError(err)
	}
	defer os.Remove(snapshot.Name())
	defer snapshot.Close()
	count, err := copyAudioSnapshot(ctx, snapshot, source, expectedSize)
	if err != nil || count != expectedSize {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return invalid()
	}
	if err := snapshot.Close(); err != nil {
		return nil, canonicalAudioInternalError(err)
	}
	if req.GetSourceArtifactId() != "" {
		if _, err := audiomedia.InspectCanonical(ctx, snapshot.Name()); err != nil {
			return invalid()
		}
	}
	prepared, err := s.canonicalAudio.Prepare(ctx, audiomedia.Input{Path: snapshot.Name(), MIMEType: mime, TargetSampleRateHz: rate}, directory)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		if errors.Is(err, audiomedia.ErrCodecUnavailable) {
			return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
		}
		return invalid()
	}
	defer os.Remove(prepared.Path)
	body, err := os.Open(prepared.Path)
	if err != nil {
		return nil, canonicalAudioInternalError(err)
	}
	defer body.Close()
	artifactID := "artifact_" + ulid.Make().String()
	record := runtimeartifact.ArtifactRecord{
		MimeType: "audio/wav", SizeBytes: prepared.Facts.SizeBytes,
		Owner: &runtimeartifact.ArtifactOwner{SubjectUserID: decision.AccountID, RegisteredAppSubject: decision.RegisteredAppSubject, AppID: decision.AppID},
	}
	if err := s.runtimeArtifacts.PutStream(ctx, artifactID, record, body); err != nil {
		return nil, canonicalAudioInternalError(err)
	}
	if err := ctx.Err(); err != nil {
		_ = s.runtimeArtifacts.Delete(artifactID)
		return nil, err
	}
	return &runtimev1.UploadLocalAppArtifactResponse{
		ArtifactId: artifactID, SizeBytes: prepared.Facts.SizeBytes, MimeType: "audio/wav",
		AudioInfo: &runtimev1.LocalAppAudioInfo{SampleRateHz: prepared.Facts.SampleRateHz, Channels: uint32(prepared.Facts.Channels), FrameCount: prepared.Facts.FrameCount, DurationMs: int64(prepared.Facts.DurationMilliseconds())},
	}, nil
}

func copyAudioSnapshot(ctx context.Context, output io.Writer, source io.Reader, expected int64) (int64, error) {
	buffer := make([]byte, 64<<10)
	var copied int64
	reader := io.LimitReader(source, expected+1)
	for {
		if err := ctx.Err(); err != nil {
			return copied, err
		}
		n, readErr := reader.Read(buffer)
		if copied+int64(n) > expected {
			return copied, fmt.Errorf("App audio source changed size")
		}
		if n > 0 {
			written, err := output.Write(buffer[:n])
			copied += int64(written)
			if err != nil {
				return copied, err
			}
			if written != n {
				return copied, io.ErrShortWrite
			}
		}
		if errors.Is(readErr, io.EOF) {
			return copied, nil
		}
		if readErr != nil {
			return copied, readErr
		}
		if n == 0 {
			return copied, io.ErrNoProgress
		}
	}
}

func canonicalAudioInternalError(err error) error {
	return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{Message: "canonical audio could not be committed"})
}

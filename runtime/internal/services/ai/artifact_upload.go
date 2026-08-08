package ai

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"strings"

	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const (
	maxUploadedArtifactBytes      = 32 << 20
	maxUploadedArtifactChunkBytes = 4 << 20
)

func (s *Service) UploadArtifact(stream runtimev1.RuntimeAiService_UploadArtifactServer) error {
	var (
		meta        *runtimev1.UploadArtifactMetadata
		payload     []byte
		expectedSeq uint64
	)

	for {
		req, err := stream.Recv()
		if err != nil {
			if isGRPCEOF(err) {
				break
			}
			return err
		}
		if req == nil || req.Payload == nil {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ARTIFACT_UPLOAD_INVALID)
		}
		switch part := req.Payload.(type) {
		case *runtimev1.UploadArtifactRequest_Metadata:
			if meta != nil {
				return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ARTIFACT_UPLOAD_INVALID)
			}
			meta = part.Metadata
			normalizedMimeType, err := validateUploadArtifactMetadata(meta)
			if err != nil {
				return err
			}
			meta.MimeType = normalizedMimeType
		case *runtimev1.UploadArtifactRequest_Chunk:
			if meta == nil {
				return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ARTIFACT_UPLOAD_INVALID)
			}
			chunk := part.Chunk
			if chunk == nil || chunk.GetSequence() != expectedSeq || len(chunk.GetBytes()) == 0 {
				return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ARTIFACT_UPLOAD_INVALID)
			}
			if len(chunk.GetBytes()) > maxUploadedArtifactChunkBytes {
				return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ARTIFACT_UPLOAD_TOO_LARGE)
			}
			if len(payload)+len(chunk.GetBytes()) > maxUploadedArtifactBytes {
				return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ARTIFACT_UPLOAD_TOO_LARGE)
			}
			payload = append(payload, chunk.GetBytes()...)
			expectedSeq++
		default:
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ARTIFACT_UPLOAD_INVALID)
		}
	}

	if meta == nil || len(payload) == 0 {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ARTIFACT_UPLOAD_INVALID)
	}

	stored, traceID, err := s.storeUploadedArtifact(meta.GetAppId(), meta.GetSubjectUserId(), meta.GetMimeType(), payload)
	if err != nil {
		return err
	}
	return stream.SendAndClose(&runtimev1.UploadArtifactResponse{Artifact: stored, TraceId: traceID})
}

// storeUploadedArtifact is the shared owner-custody sink for the chunked owner
// UploadArtifact RPC and the trimmed Local App upload. Caller-specific
// admission and MIME clamps run before this helper; owner identity is always a
// Runtime-derived argument and is persisted in both artifact indexes.
func (s *Service) storeUploadedArtifact(appID string, subjectUserID string, mimeType string, payload []byte) (*runtimev1.ScenarioArtifact, string, error) {
	if s == nil || s.scenarioJobs == nil || s.runtimeArtifacts == nil ||
		strings.TrimSpace(appID) == "" || strings.TrimSpace(subjectUserID) == "" || len(payload) == 0 {
		return nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	traceID := ulid.Make().String()
	sum := sha256.Sum256(payload)
	artifact := &runtimev1.ScenarioArtifact{
		ArtifactId: "artifact_" + ulid.Make().String(),
		MimeType:   strings.TrimSpace(mimeType),
		Bytes:      payload,
		Sha256:     hex.EncodeToString(sum[:]),
		SizeBytes:  int64(len(payload)),
	}
	stored := s.scenarioJobs.storeUploadedArtifact(appID, subjectUserID, traceID, artifact)
	if stored == nil {
		return nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	uploadHead := &runtimev1.ScenarioRequestHead{AppId: appID, SubjectUserId: subjectUserID}
	if err := s.storeRuntimeOwnedArtifacts(uploadHead, []*runtimev1.ScenarioArtifact{stored}); err != nil {
		if s.logger != nil {
			s.logger.Warn("store uploaded runtime artifact failed", "artifact_id", stored.GetArtifactId(), "error", err)
		}
		return nil, "", grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{
			Message: "uploaded runtime artifact could not be stored",
		})
	}
	return stored, traceID, nil
}

func validateUploadArtifactMetadata(meta *runtimev1.UploadArtifactMetadata) (string, error) {
	if meta == nil {
		return "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ARTIFACT_UPLOAD_INVALID)
	}
	if strings.TrimSpace(meta.GetAppId()) == "" || strings.TrimSpace(meta.GetSubjectUserId()) == "" {
		return "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ARTIFACT_UPLOAD_INVALID)
	}
	mimeType := strings.ToLower(strings.TrimSpace(meta.GetMimeType()))
	switch {
	case strings.HasPrefix(mimeType, "image/"),
		strings.HasPrefix(mimeType, "audio/"),
		strings.HasPrefix(mimeType, "video/"):
		return mimeType, nil
	default:
		return "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ARTIFACT_UPLOAD_INVALID)
	}
}

func isGRPCEOF(err error) bool {
	return errors.Is(err, io.EOF)
}

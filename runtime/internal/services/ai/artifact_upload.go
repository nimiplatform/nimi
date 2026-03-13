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

const maxUploadedArtifactBytes = 32 << 20

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
			if err := validateUploadArtifactMetadata(meta); err != nil {
				return err
			}
		case *runtimev1.UploadArtifactRequest_Chunk:
			if meta == nil {
				return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ARTIFACT_UPLOAD_INVALID)
			}
			chunk := part.Chunk
			if chunk == nil || chunk.GetSequence() != expectedSeq || len(chunk.GetBytes()) == 0 {
				return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ARTIFACT_UPLOAD_INVALID)
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

	traceID := ulid.Make().String()
	sum := sha256.Sum256(payload)
	artifact := &runtimev1.ScenarioArtifact{
		ArtifactId: "artifact_" + ulid.Make().String(),
		MimeType:   strings.TrimSpace(meta.GetMimeType()),
		Bytes:      payload,
		Sha256:     hex.EncodeToString(sum[:]),
		SizeBytes:  int64(len(payload)),
	}
	stored := s.scenarioJobs.storeUploadedArtifact(meta.GetAppId(), meta.GetSubjectUserId(), traceID, artifact)
	if stored == nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	return stream.SendAndClose(&runtimev1.UploadArtifactResponse{
		Artifact: stored,
		TraceId:  traceID,
	})
}

func validateUploadArtifactMetadata(meta *runtimev1.UploadArtifactMetadata) error {
	if meta == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ARTIFACT_UPLOAD_INVALID)
	}
	if strings.TrimSpace(meta.GetAppId()) == "" || strings.TrimSpace(meta.GetSubjectUserId()) == "" {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ARTIFACT_UPLOAD_INVALID)
	}
	mimeType := strings.ToLower(strings.TrimSpace(meta.GetMimeType()))
	switch {
	case strings.HasPrefix(mimeType, "image/"),
		strings.HasPrefix(mimeType, "audio/"),
		strings.HasPrefix(mimeType, "video/"):
		return nil
	default:
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ARTIFACT_UPLOAD_INVALID)
	}
}

func isGRPCEOF(err error) bool {
	return errors.Is(err, io.EOF)
}

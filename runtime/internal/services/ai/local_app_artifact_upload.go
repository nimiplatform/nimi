package ai

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/grpc/codes"
)

// UploadLocalAppArtifact is the bounded unary counterpart to
// ReadLocalAppArtifact. Admission supplies the App+subject owner; the request
// can supply only image bytes and a closed MIME value. Storage delegates to
// the same owner-custody sink as the chunked UploadArtifact owner RPC.
func (s *Service) UploadLocalAppArtifact(ctx context.Context, req *runtimev1.UploadLocalAppArtifactRequest) (*runtimev1.UploadLocalAppArtifactResponse, error) {
	decision, err := localAppScenarioDecision(ctx, accountservice.LocalAppOperationArtifactUpload, localappop.AppOperationIDArtifactUpload)
	if err != nil {
		return nil, err
	}
	if req == nil || len(req.GetBytes()) == 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ARTIFACT_UPLOAD_INVALID)
	}
	if len(req.GetBytes()) > runtimeartifact.MaxInlineBytes {
		return nil, grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_AI_ARTIFACT_UPLOAD_TOO_LARGE)
	}
	mimeType := strings.ToLower(strings.TrimSpace(req.GetMimeType()))
	switch mimeType {
	case "image/png", "image/jpeg", "image/webp", "image/gif":
	default:
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_ARTIFACT_UPLOAD_MIME_UNSUPPORTED)
	}
	stored, _, err := s.storeUploadedArtifact(ctx, decision.AppID, decision.AccountID, decision.RegisteredAppSubject, mimeType, req.GetBytes())
	if err != nil {
		return nil, err
	}
	return &runtimev1.UploadLocalAppArtifactResponse{
		ArtifactId: stored.GetArtifactId(),
		SizeBytes:  stored.GetSizeBytes(),
		MimeType:   stored.GetMimeType(),
	}, nil
}

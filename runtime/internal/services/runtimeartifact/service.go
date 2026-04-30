// Package runtimeartifact implements RuntimeArtifactService gRPC handler
// admitted under K-AGCORE-053.
//
// Handler returns reason codes via grpcerr.WithReasonCode (per K-ERR-003;
// ReasonCode in ErrorInfo details, not status message string). It is a
// pure read-bytes-by-id surface; orthogonal to RuntimeAiService typed
// projections (S-RUNTIME-073), GetVoiceAsset (voice asset library), and
// UploadArtifact (write-side).
package runtimeartifact

import (
	"context"
	"log/slog"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

// Service implements RuntimeArtifactService.
type Service struct {
	runtimev1.UnimplementedRuntimeArtifactServiceServer
	store  Store
	logger *slog.Logger
}

// New constructs a Service with constructor-injected Store and logger
// (per runtime AGENTS.md: no global mutable state).
func New(store Store, logger *slog.Logger) *Service {
	if logger == nil {
		logger = slog.Default()
	}
	return &Service{
		store:  store,
		logger: logger,
	}
}

// ReadArtifactBytes returns artifact bytes + mime + size by artifact_id.
// Reason codes (admitted in common.proto ARTIFACT family 600+):
//   - ARTIFACT_INVALID_INPUT (codes.InvalidArgument): empty artifact_id
//   - ARTIFACT_NOT_FOUND (codes.NotFound): id not in store
//   - ARTIFACT_TOO_LARGE (codes.ResourceExhausted): exceeds 32 MiB inline cap
//   - ARTIFACT_FORBIDDEN (codes.PermissionDenied): reserved (current
//     single-runtime deployment never returns this)
//
// ARTIFACT_MIME_MISMATCH is SDK-side only (client expectedMimePrefix check);
// server never returns it.
func (s *Service) ReadArtifactBytes(
	ctx context.Context,
	req *runtimev1.ReadArtifactBytesRequest,
) (*runtimev1.ReadArtifactBytesResponse, error) {
	artifactID := ""
	if req != nil {
		artifactID = strings.TrimSpace(req.GetArtifactId())
	}
	if artifactID == "" || s.store == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_ARTIFACT_INVALID_INPUT)
	}

	record, ok := s.store.Get(artifactID)
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_ARTIFACT_NOT_FOUND)
	}

	if record.SizeBytes > MaxInlineBytes {
		return nil, grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_ARTIFACT_TOO_LARGE)
	}

	return &runtimev1.ReadArtifactBytesResponse{
		Bytes:        record.Bytes,
		MimeType:     record.MimeType,
		SizeBytes:    record.SizeBytes,
		MimeInferred: record.MimeInferred,
	}, nil
}

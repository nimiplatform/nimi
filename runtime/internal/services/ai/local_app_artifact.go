package ai

import (
	"context"
	"io"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/grpc/codes"
)

// ReadLocalAppArtifact mirrors runtimeartifact.Service.ReadArtifactBytes
// semantics for the Local App surface: bounded inline read (<= 32 MiB) limited
// to artifacts owned by the calling App session owner. The artifact id is a
// selector only; ownership, integrity, and size all fail closed.
func (s *Service) ReadLocalAppArtifact(ctx context.Context, req *runtimev1.ReadLocalAppArtifactRequest) (*runtimev1.ReadLocalAppArtifactResponse, error) {
	decision, err := localAppScenarioDecision(ctx, accountservice.LocalAppOperationArtifactRead, localappop.AppOperationIDArtifactRead)
	if err != nil {
		return nil, err
	}
	artifactID := ""
	if req != nil {
		artifactID = req.GetArtifactId()
	}
	if !localAppBoundedIdentifier(artifactID) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_ARTIFACT_INVALID_INPUT)
	}
	source, err := s.openAuthorizedLocalAppArtifact(ctx, decision, artifactID, localAppArtifactOperationInlineRead)
	if err != nil {
		return nil, err
	}
	defer source.Body.Close()
	record := source.Record
	if record.SizeBytes > runtimeartifact.MaxInlineBytes {
		return nil, grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_ARTIFACT_TOO_LARGE)
	}
	payload, readErr := io.ReadAll(io.LimitReader(source.Body, runtimeartifact.MaxInlineBytes+1))
	if readErr != nil || int64(len(payload)) != record.SizeBytes {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_ARTIFACT_FORBIDDEN)
	}
	if len(payload) > runtimeartifact.MaxInlineBytes {
		return nil, grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_ARTIFACT_TOO_LARGE)
	}
	return &runtimev1.ReadLocalAppArtifactResponse{
		Bytes:     payload,
		MimeType:  record.MimeType,
		SizeBytes: record.SizeBytes,
	}, nil
}

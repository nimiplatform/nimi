package ai

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"

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
	if s == nil || s.runtimeArtifacts == nil {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_ARTIFACT_FORBIDDEN)
	}
	record, ok := s.runtimeArtifacts.Get(artifactID)
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_ARTIFACT_NOT_FOUND)
	}
	if record.Owner == nil ||
		strings.TrimSpace(record.Owner.SubjectUserID) != decision.AccountID ||
		strings.TrimSpace(record.Owner.AppID) != decision.AppID {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_ARTIFACT_FORBIDDEN)
	}
	if !localAppArtifactRecordIntegrityValid(record) {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_ARTIFACT_NOT_FOUND)
	}
	if record.SizeBytes > runtimeartifact.MaxInlineBytes {
		return nil, grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_ARTIFACT_TOO_LARGE)
	}
	return &runtimev1.ReadLocalAppArtifactResponse{
		Bytes:     record.Bytes,
		MimeType:  record.MimeType,
		SizeBytes: record.SizeBytes,
	}, nil
}

// localAppArtifactRecordIntegrityValid mirrors
// runtimeartifact.artifactRecordIntegrityValid for the Local App read surface.
func localAppArtifactRecordIntegrityValid(record runtimeartifact.ArtifactRecord) bool {
	if record.SizeBytes != int64(len(record.Bytes)) || strings.TrimSpace(record.ContentSHA256) == "" {
		return false
	}
	digest := sha256.Sum256(record.Bytes)
	return strings.EqualFold(strings.TrimSpace(record.ContentSHA256), "sha256:"+hex.EncodeToString(digest[:]))
}

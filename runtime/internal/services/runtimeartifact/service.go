// Package runtimeartifact implements RuntimeArtifactService gRPC handler
// admitted under K-AGCORE-053.
//
// Handler returns reason codes via grpcerr.WithReasonCode (per K-ERR-003;
// ReasonCode in ErrorInfo details, not status message string). It is a
// protected audience-bound read-bytes surface; orthogonal to RuntimeAiService typed
// projections (S-RUNTIME-073), GetVoiceAsset (voice asset library), and
// UploadArtifact (write-side).
package runtimeartifact

import (
	"context"
	"log/slog"
	"path/filepath"
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
)

// Service implements RuntimeArtifactService.
type Service struct {
	runtimev1.UnimplementedRuntimeArtifactServiceServer
	store      Store
	logger     *slog.Logger
	authorizer InstalledOperationAuthorizer
	now        func() time.Time
}

type InstalledOperationAuthorizer interface {
	AuthorizeInstalledOperation(context.Context, accountservice.InstalledOperation) (accountservice.InstalledCallerDecision, error)
}

type Option func(*Service)

func WithInstalledOperationAuthorizer(authorizer InstalledOperationAuthorizer) Option {
	return func(service *Service) {
		service.authorizer = authorizer
	}
}

// CleanupGeneratedVoiceArtifacts deletes generated assistant voice artifacts by
// Runtime-owned selector. Empty selector fails closed; no matches is a
// successful idempotent cleanup.
func (s *Service) CleanupGeneratedVoiceArtifacts(
	ctx context.Context,
	req *runtimev1.CleanupGeneratedVoiceArtifactsRequest,
) (*runtimev1.CleanupGeneratedVoiceArtifactsResponse, error) {
	_ = ctx
	agentID := ""
	conversationAnchorID := ""
	if req != nil {
		agentID = strings.TrimSpace(req.GetAgentId())
		conversationAnchorID = strings.TrimSpace(req.GetConversationAnchorId())
	}
	if (agentID == "" && conversationAnchorID == "") || s.store == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_ARTIFACT_INVALID_INPUT)
	}
	deleted, err := s.store.CleanupGeneratedVoiceArtifacts(GeneratedVoiceArtifactSelector{
		AgentID:              agentID,
		ConversationAnchorID: conversationAnchorID,
	})
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_ARTIFACT_INVALID_INPUT)
	}
	sort.Strings(deleted)
	return &runtimev1.CleanupGeneratedVoiceArtifactsResponse{
		DeletedCount:       int32(len(deleted)),
		DeletedArtifactIds: deleted,
	}, nil
}

// New constructs a Service with constructor-injected Store and logger
// (per runtime AGENTS.md: no global mutable state).
func New(store Store, logger *slog.Logger, options ...Option) *Service {
	if logger == nil {
		logger = slog.Default()
	}
	service := &Service{
		store:  store,
		logger: logger,
		now:    time.Now,
	}
	for _, option := range options {
		if option != nil {
			option(service)
		}
	}
	return service
}

// ReadArtifactBytes returns artifact bytes + mime + size by artifact_id.
// Reason codes (admitted in common.proto ARTIFACT family 600+):
//   - ARTIFACT_INVALID_INPUT (codes.InvalidArgument): empty artifact_id
//   - ARTIFACT_NOT_FOUND (codes.NotFound): id not in store
//   - ARTIFACT_TOO_LARGE (codes.ResourceExhausted): exceeds 32 MiB inline cap
//   - ARTIFACT_FORBIDDEN (codes.PermissionDenied): caller or audience mismatch
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
	if artifactID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_ARTIFACT_INVALID_INPUT)
	}
	if s == nil || s.store == nil || s.authorizer == nil {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_ARTIFACT_FORBIDDEN)
	}
	now := s.now().UTC()
	decision, err := s.authorizer.AuthorizeInstalledOperation(ctx, accountservice.InstalledOperationReadArtifactBytes)
	if err != nil || !validInstalledArtifactDecision(decision, now) {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_ARTIFACT_FORBIDDEN)
	}

	record, ok := s.store.Get(artifactID)
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_ARTIFACT_NOT_FOUND)
	}
	if !artifactAudienceMatches(record.Audience, decision, now) {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_ARTIFACT_FORBIDDEN)
	}
	if !artifactRecordIntegrityValid(record) {
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

func validInstalledArtifactDecision(decision accountservice.InstalledCallerDecision, now time.Time) bool {
	baseValid := decision.SessionID != (protectedlocal.Identifier{}) && strings.TrimSpace(decision.AppID) != "" &&
		decision.ReleaseDigest != (protectedlocal.Identifier{}) && strings.TrimSpace(decision.AccountID) != "" &&
		strings.TrimSpace(decision.RealmEnvironmentID) != "" && decision.AccountGeneration > 0 &&
		decision.RuntimeBootEpoch != (protectedlocal.Identifier{}) && decision.Process.PID > 0 &&
		strings.TrimSpace(decision.Process.CreationMarker) != "" && decision.Process.ExecutableDigest == decision.ReleaseDigest &&
		decision.Operation == accountservice.InstalledOperationReadArtifactBytes && decision.PermissionScope == "data.scope.read#runtime.artifacts" &&
		now.Before(decision.ExpiresAt.UTC())
	if !baseValid {
		return false
	}
	switch decision.TrustClass {
	case accountservice.InstalledTrustClassProductionInstalled:
		return decision.CatalogVersion > 0 && strings.TrimSpace(decision.GrantID) != "" && decision.GrantID == strings.TrimSpace(decision.GrantID) && decision.GrantVersion > 0 &&
			decision.AuthorizationID == (protectedlocal.Identifier{}) && decision.AuthorizationGeneration == 0 && strings.TrimSpace(decision.ProjectRoot) == "" && decision.CapabilityFingerprint == (protectedlocal.Identifier{})
	case accountservice.InstalledTrustClassLocalDevelopment:
		return decision.CatalogVersion == 0 && decision.GrantID == "" && decision.GrantVersion == 0 && decision.AuthorizationID != (protectedlocal.Identifier{}) &&
			decision.AuthorizationGeneration > 0 && filepath.IsAbs(decision.ProjectRoot) && decision.CapabilityFingerprint != (protectedlocal.Identifier{}) &&
			decision.Process.ExecutableTrustSetID == protectedlocal.WindowsLocalDevelopmentTrustSetID && filepath.IsAbs(decision.Process.CanonicalExecutablePath)
	default:
		return false
	}
}

func artifactAudienceMatches(audience *ArtifactAudience, decision accountservice.InstalledCallerDecision, now time.Time) bool {
	if audience == nil || audience.AllowedUse != ArtifactUseReadBytes || !now.Before(audience.ExpiresAt.UTC()) ||
		audience.OwnerAccountID != decision.AccountID || audience.AppID != decision.AppID ||
		audience.ReleaseDigest != decision.ReleaseDigest || audience.SessionID != decision.SessionID ||
		audience.AccountGeneration != decision.AccountGeneration {
		return false
	}
	switch decision.TrustClass {
	case accountservice.InstalledTrustClassProductionInstalled:
		return audience.TrustClass == "production-installed" && audience.AuthorizationID == (protectedlocal.Identifier{}) && audience.AuthorizationGeneration == 0 && audience.ProjectRoot == "" && audience.CapabilityFingerprint == (protectedlocal.Identifier{})
	case accountservice.InstalledTrustClassLocalDevelopment:
		return audience.TrustClass == "local-development" && audience.AuthorizationID == decision.AuthorizationID && audience.AuthorizationGeneration == decision.AuthorizationGeneration && audience.ProjectRoot == decision.ProjectRoot && audience.CapabilityFingerprint == decision.CapabilityFingerprint
	default:
		return false
	}
}

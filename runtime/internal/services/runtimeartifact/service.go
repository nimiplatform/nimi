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
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/protectedprincipal"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
)

// Service implements RuntimeArtifactService.
type Service struct {
	runtimev1.UnimplementedRuntimeArtifactServiceServer
	store                             Store
	logger                            *slog.Logger
	authorizer                        LocalAppOperationAuthorizer
	protectedGeneratedVoiceAuthorizer ProtectedGeneratedVoiceAuthorizer
	now                               func() time.Time
}

type LocalAppOperationAuthorizer interface {
	AuthorizeLocalAppOperation(context.Context, accountservice.LocalAppOperation) (accountservice.LocalAppCallerDecision, error)
}

type ProtectedGeneratedVoiceAuthorizer interface {
	AuthorizeProtectedGeneratedVoiceArtifact(context.Context, ArtifactRecord) bool
	AuthorizeProtectedGeneratedVoiceCleanup(context.Context, GeneratedVoiceArtifactSelector) bool
}

type Option func(*Service)

func WithLocalAppOperationAuthorizer(authorizer LocalAppOperationAuthorizer) Option {
	return func(service *Service) {
		service.authorizer = authorizer
	}
}

func WithProtectedGeneratedVoiceAuthorizer(authorizer ProtectedGeneratedVoiceAuthorizer) Option {
	return func(service *Service) {
		service.protectedGeneratedVoiceAuthorizer = authorizer
	}
}

// CleanupGeneratedVoiceArtifacts deletes generated assistant voice artifacts by
// Runtime-owned selector. Empty selector fails closed; no matches is a
// successful idempotent cleanup.
func (s *Service) CleanupGeneratedVoiceArtifacts(
	ctx context.Context,
	req *runtimev1.CleanupGeneratedVoiceArtifactsRequest,
) (*runtimev1.CleanupGeneratedVoiceArtifactsResponse, error) {
	agentID := ""
	conversationAnchorID := ""
	if req != nil {
		agentID = strings.TrimSpace(req.GetAgentId())
		conversationAnchorID = strings.TrimSpace(req.GetConversationAnchorId())
	}
	if (agentID == "" && conversationAnchorID == "") || s.store == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_ARTIFACT_INVALID_INPUT)
	}
	selector := GeneratedVoiceArtifactSelector{
		AgentID:              agentID,
		ConversationAnchorID: conversationAnchorID,
	}
	if principal, protected := protectedprincipal.AttachedToContext(ctx); protected &&
		(!principal.Valid() || s.protectedGeneratedVoiceAuthorizer == nil ||
			!s.protectedGeneratedVoiceAuthorizer.AuthorizeProtectedGeneratedVoiceCleanup(ctx, selector)) {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_ARTIFACT_FORBIDDEN)
	}
	deleted, err := s.store.CleanupGeneratedVoiceArtifacts(selector)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_ARTIFACT_INVALID_INPUT,
			err,
			grpcerr.ReasonOptions{
				ActionHint: "retry_or_check_runtime_storage",
				Message:    "generated voice artifact cleanup failed",
			},
		)
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
	if s == nil || s.store == nil {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_ARTIFACT_FORBIDDEN)
	}
	principal, protectedCaller := protectedprincipal.AttachedToContext(ctx)
	if protectedCaller && !principal.Valid() {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_ARTIFACT_FORBIDDEN)
	}
	now := s.now().UTC()
	var decision accountservice.LocalAppCallerDecision
	if !protectedCaller {
		if s.authorizer == nil {
			return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_ARTIFACT_FORBIDDEN)
		}
		var err error
		decision, err = s.authorizer.AuthorizeLocalAppOperation(ctx, accountservice.LocalAppOperationReadArtifactBytes)
		if err != nil || !validLocalAppArtifactDecision(decision, now) {
			return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_ARTIFACT_FORBIDDEN)
		}
	}

	record, ok := s.store.Get(artifactID)
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_ARTIFACT_NOT_FOUND)
	}
	if protectedCaller {
		if s.protectedGeneratedVoiceAuthorizer == nil ||
			!s.protectedGeneratedVoiceAuthorizer.AuthorizeProtectedGeneratedVoiceArtifact(ctx, record) {
			return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_ARTIFACT_FORBIDDEN)
		}
	} else if !artifactAudienceMatches(record.Audience, decision, now) {
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

func validLocalAppArtifactDecision(decision accountservice.LocalAppCallerDecision, now time.Time) bool {
	commonValid := decision.SessionID != (protectedlocal.Identifier{}) && strings.TrimSpace(decision.AppID) != "" &&
		decision.HostExecutableDigest != (protectedlocal.Identifier{}) && strings.TrimSpace(decision.AccountID) != "" &&
		strings.TrimSpace(decision.RealmEnvironmentID) != "" && decision.AccountGeneration > 0 &&
		decision.Operation == accountservice.LocalAppOperationReadArtifactBytes && decision.OperationCapability == "data.scope.read#runtime.artifacts" &&
		decision.TrustClass == accountservice.LocalAppTrustClassDevelopment &&
		decision.AuthorizationID != (protectedlocal.Identifier{}) && decision.AuthorizationGeneration > 0 &&
		decision.CapabilityFingerprint != (protectedlocal.Identifier{})
	if !commonValid {
		return false
	}
	direct := decision.DirectPeer.OS == protectedlocal.OSMacOS && decision.DirectPeer.PID != 0 && decision.DirectPeer.UID != 0 &&
		decision.RuntimeBootEpoch == (protectedlocal.Identifier{}) && decision.Process == (protectedlocal.ProcessTuple{}) &&
		decision.ExpiresAt.IsZero() &&
		protectedlocal.IsAbsolutePathForOperatingSystem(decision.DirectPeer.OS, decision.ProjectRoot)
	sessionScoped := decision.DirectPeer == (protectedlocal.DirectLocalAppPeer{}) &&
		decision.RuntimeBootEpoch != (protectedlocal.Identifier{}) && decision.Process.PID > 0 &&
		strings.TrimSpace(decision.Process.CreationMarker) != "" &&
		decision.Process.ExecutableDigest == decision.HostExecutableDigest &&
		now.Before(decision.ExpiresAt.UTC()) &&
		protectedlocal.IsAbsolutePathForOperatingSystem(decision.Process.OS, decision.ProjectRoot) &&
		protectedlocal.IsLocalDevelopmentProcessTrustSet(decision.Process) &&
		protectedlocal.IsAbsolutePathForOperatingSystem(decision.Process.OS, decision.Process.CanonicalExecutablePath)
	return direct || sessionScoped
}

func artifactAudienceMatches(audience *ArtifactAudience, decision accountservice.LocalAppCallerDecision, now time.Time) bool {
	if audience == nil || audience.AllowedUse != ArtifactUseReadBytes || !now.Before(audience.ExpiresAt.UTC()) ||
		audience.OwnerAccountID != decision.AccountID || audience.AppID != decision.AppID ||
		audience.ReleaseDigest != decision.HostExecutableDigest || audience.SessionID != decision.SessionID ||
		audience.AccountGeneration != decision.AccountGeneration {
		return false
	}
	return decision.TrustClass == accountservice.LocalAppTrustClassDevelopment && audience.TrustClass == "local_development" &&
		audience.AuthorizationID == decision.AuthorizationID && audience.AuthorizationGeneration == decision.AuthorizationGeneration &&
		audience.ProjectRoot == decision.ProjectRoot && audience.CapabilityFingerprint == decision.CapabilityFingerprint
}

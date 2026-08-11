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
	"io"
	"log/slog"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedprincipal"
	"google.golang.org/grpc/codes"
)

// Service implements RuntimeArtifactService.
type Service struct {
	runtimev1.UnimplementedRuntimeArtifactServiceServer
	store                             Store
	logger                            *slog.Logger
	protectedGeneratedVoiceAuthorizer ProtectedGeneratedVoiceAuthorizer
}

type ProtectedGeneratedVoiceAuthorizer interface {
	AuthorizeProtectedGeneratedVoiceArtifact(context.Context, ArtifactRecord) bool
	AuthorizeProtectedGeneratedVoiceCleanup(context.Context, GeneratedVoiceArtifactSelector) bool
}

type Option func(*Service)

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
	if !protectedCaller || !principal.Valid() {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_ARTIFACT_FORBIDDEN)
	}

	source, ok := s.store.Open(ctx, artifactID)
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_ARTIFACT_NOT_FOUND)
	}
	defer func() { _ = source.Body.Close() }()
	record := source.Record
	if !artifactOwnerMatches(record.Owner, principal.AccountID, principal.AppID) &&
		(s.protectedGeneratedVoiceAuthorizer == nil ||
			!s.protectedGeneratedVoiceAuthorizer.AuthorizeProtectedGeneratedVoiceArtifact(ctx, record)) {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_ARTIFACT_FORBIDDEN)
	}
	if record.SizeBytes > MaxInlineBytes {
		return nil, grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_ARTIFACT_TOO_LARGE)
	}
	payload, err := io.ReadAll(io.LimitReader(source.Body, MaxInlineBytes+1))
	if err != nil || int64(len(payload)) != record.SizeBytes {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_ARTIFACT_NOT_FOUND)
	}
	if len(payload) > MaxInlineBytes {
		return nil, grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_ARTIFACT_TOO_LARGE)
	}

	return &runtimev1.ReadArtifactBytesResponse{
		Bytes:        payload,
		MimeType:     record.MimeType,
		SizeBytes:    record.SizeBytes,
		MimeInferred: record.MimeInferred,
	}, nil
}

// artifactOwnerMatches authorizes the uploader-owned read path
// (rule.nimi.runtime.agent-participation.r171): the exact subject + app that
// uploaded the artifact may read it back. Records without owner metadata
// (historical or producer records) never match.
func artifactOwnerMatches(owner *ArtifactOwner, subjectUserID string, appID string) bool {
	if owner == nil || strings.TrimSpace(owner.RegisteredAppSubject) != "" {
		return false
	}
	subjectUserID = strings.TrimSpace(subjectUserID)
	appID = strings.TrimSpace(appID)
	return subjectUserID != "" && appID != "" && owner.SubjectUserID == subjectUserID && owner.AppID == appID
}

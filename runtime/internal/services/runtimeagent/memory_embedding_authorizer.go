package runtimeagent

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
	"google.golang.org/grpc/codes"
)

func (s *Service) AuthorizeMemoryEmbeddingTarget(_ context.Context, reqContext *runtimev1.MemoryRequestContext, locator *runtimev1.MemoryBankLocator) error {
	if locator == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	switch locator.GetScope() {
	case runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE:
		localAgentRef := strings.TrimSpace(locator.GetAgentCore().GetAgentId())
		subjectUserID := strings.TrimSpace(reqContext.GetSubjectUserId())
		if localAgentRef == "" || subjectUserID == "" {
			return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
		}
		entry, err := s.agentByID(localAgentRef)
		if err != nil {
			return grpcerr.WrapWithReasonCode(
				codes.PermissionDenied,
				runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED,
				err,
				grpcerr.ReasonOptions{
					ActionHint: "verify_runtime_agent_identity",
					Message:    "memory embedding target could not be authorized",
				},
			)
		}
		if strings.TrimSpace(entry.Agent.GetLocalAgentRef()) != localAgentRef ||
			strings.TrimSpace(entry.Agent.GetOwnerUserId()) != subjectUserID {
			return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
		}
		return nil
	default:
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
}

func (s *Service) ResolveMemoryEmbeddingIntent(ctx context.Context, reqContext *runtimev1.MemoryRequestContext, locator *runtimev1.MemoryBankLocator) (*memoryservice.MemoryEmbeddingTextEmbedIntentSnapshot, error) {
	if err := s.AuthorizeMemoryEmbeddingTarget(ctx, reqContext, locator); err != nil {
		return nil, err
	}
	// Shared AIConfig is portable consumer intent and deliberately carries no
	// machine binding, readiness result, or revision token. Memory embedding
	// execution therefore remains unresolved until its machine-configuration
	// owner supplies an exact binding; Runtime must not synthesize one here.
	return nil, nil
}

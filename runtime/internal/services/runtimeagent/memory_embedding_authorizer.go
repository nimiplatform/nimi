package runtimeagent

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
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
			return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
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

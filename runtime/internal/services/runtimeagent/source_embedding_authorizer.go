package runtimeagent

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

// @nimi-authority: rule.nimi.runtime.security-core.r064
func (s *Service) AuthorizeSourceEmbeddingTarget(accountID, localAgentRef string) error {
	accountID = strings.TrimSpace(accountID)
	localAgentRef = strings.TrimSpace(localAgentRef)
	if s == nil || accountID == "" || localAgentRef == "" {
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
		strings.TrimSpace(entry.Agent.GetOwnerUserId()) != accountID {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	return nil
}

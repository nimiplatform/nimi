package memory

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

func (s *Service) authorizeMemoryEmbeddingTarget(ctx context.Context, reqContext *runtimev1.MemoryRequestContext, locator *runtimev1.MemoryBankLocator) error {
	if err := validateMemoryEmbeddingLocator(locator); err != nil {
		return err
	}
	if authorizer := s.memoryEmbeddingTargetAuthorizer(); authorizer != nil {
		return authorizer(ctx, reqContext, cloneLocator(locator))
	}
	switch locator.GetScope() {
	case runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_APP_PRIVATE,
		runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_WORKSPACE_PRIVATE:
		return nil
	default:
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
}

package grant

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

func (s *Service) AuthorizeExternalPrincipal(ctx context.Context, _ *runtimev1.AuthorizeExternalPrincipalRequest) (*runtimev1.AuthorizeExternalPrincipalResponse, error) {
	return nil, s.publicGrantTombstoneError(ctx, "AuthorizeExternalPrincipal")
}

func (s *Service) ValidateAppAccessToken(ctx context.Context, _ *runtimev1.ValidateAppAccessTokenRequest) (*runtimev1.ValidateAppAccessTokenResponse, error) {
	return nil, s.publicGrantTombstoneError(ctx, "ValidateAppAccessToken")
}

func (s *Service) RevokeAppAccessToken(ctx context.Context, _ *runtimev1.RevokeAppAccessTokenRequest) (*runtimev1.Ack, error) {
	return nil, s.publicGrantTombstoneError(ctx, "RevokeAppAccessToken")
}

func (s *Service) IssueDelegatedAccessToken(ctx context.Context, _ *runtimev1.IssueDelegatedAccessTokenRequest) (*runtimev1.IssueDelegatedAccessTokenResponse, error) {
	return nil, s.publicGrantTombstoneError(ctx, "IssueDelegatedAccessToken")
}

func (s *Service) ListTokenChain(ctx context.Context, _ *runtimev1.ListTokenChainRequest) (*runtimev1.ListTokenChainResponse, error) {
	return nil, s.publicGrantTombstoneError(ctx, "ListTokenChain")
}

func (s *Service) publicGrantTombstoneError(ctx context.Context, operation string) error {
	s.emitAudit(ctx, operation, "", "", runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)
	return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)
}

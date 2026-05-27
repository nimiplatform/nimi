package externalagent

import (
	"context"
	"log/slog"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

const (
	disabledStatusReason = "EXTERNAL_AGENT_ACTION_REGISTRY_EMPTY"
	defaultBindAddress   = "127.0.0.1:0"
	defaultIssuer        = "runtime"
)

// Service implements RuntimeExternalAgentService. Until the Runtime-owned
// action registry/server lands, the projection is intentionally disabled and
// all token issuance fails closed instead of preserving a Desktop-local ledger.
type Service struct {
	runtimev1.UnimplementedRuntimeExternalAgentServiceServer
	logger *slog.Logger
}

func New(logger *slog.Logger) *Service {
	return &Service{logger: logger}
}

func (s *Service) GetExternalAgentGatewayStatus(context.Context, *runtimev1.ExternalAgentGatewayStatusRequest) (*runtimev1.ExternalAgentGatewayStatusResponse, error) {
	return &runtimev1.ExternalAgentGatewayStatusResponse{
		Enabled:     false,
		BindAddress: defaultBindAddress,
		Issuer:      defaultIssuer,
		ActionCount: 0,
		Status:      "disabled",
		ReasonCode:  disabledStatusReason,
	}, nil
}

func (s *Service) IssueExternalAgentToken(_ context.Context, req *runtimev1.ExternalAgentIssueTokenRequest) (*runtimev1.ExternalAgentIssueTokenResponse, error) {
	if req == nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, grpcerr.ReasonOptions{
			ActionHint: "provide_external_agent_issue_token_request",
		})
	}
	if strings.TrimSpace(req.GetPrincipalId()) == "" ||
		strings.TrimSpace(req.GetSubjectAccountId()) == "" ||
		(strings.TrimSpace(req.GetMode()) != "delegated" && strings.TrimSpace(req.GetMode()) != "autonomous") ||
		req.GetTtlSeconds() <= 0 {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_APP_GRANT_INVALID, grpcerr.ReasonOptions{
			ActionHint: "provide_external_agent_principal_mode_subject_and_positive_ttl",
		})
	}
	if len(req.GetActions()) == 0 && len(req.GetScopes()) == 0 {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN, grpcerr.ReasonOptions{
			ActionHint: "select_external_agent_action_scope",
		})
	}
	return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_APP_GRANT_INVALID, grpcerr.ReasonOptions{
		ActionHint: disabledStatusReason,
	})
}

func (s *Service) RevokeExternalAgentToken(_ context.Context, req *runtimev1.ExternalAgentRevokeTokenRequest) (*runtimev1.Ack, error) {
	if req == nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, grpcerr.ReasonOptions{
			ActionHint: "provide_external_agent_revoke_token_request",
		})
	}
	if strings.TrimSpace(req.GetTokenId()) == "" {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, grpcerr.ReasonOptions{
			ActionHint: "provide_external_agent_token_id",
		})
	}
	return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_APP_GRANT_INVALID, grpcerr.ReasonOptions{
		ActionHint: disabledStatusReason,
	})
}

func (s *Service) ListExternalAgentTokens(context.Context, *runtimev1.ExternalAgentListTokensRequest) (*runtimev1.ExternalAgentListTokensResponse, error) {
	return &runtimev1.ExternalAgentListTokensResponse{Tokens: []*runtimev1.ExternalAgentTokenRecord{}}, nil
}

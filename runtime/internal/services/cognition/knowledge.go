package cognition

import (
	"context"
	"errors"
	"strings"

	cognitionpkg "github.com/nimiplatform/nimi/nimi-cognition/cognition"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

// CreateKnowledgeBank registers a new runtime_knowledge_bank scope via
// the typed cognition KnowledgeScopeRegistry, after the authorizer
// confirms the caller may create on the proposed owner.
func (s *Service) CreateKnowledgeBank(ctx context.Context, req *runtimev1.CreateKnowledgeBankRequest) (*runtimev1.CreateKnowledgeBankResponse, error) {
	if err := validateKnowledgeContext(req.GetContext()); err != nil {
		return nil, err
	}
	owner, err := ownerFromPublicLocator(req.GetLocator())
	if err != nil {
		return nil, err
	}
	if err := s.authorize(ctx, KnowledgeActionCreateBank, req.GetContext(), owner); err != nil {
		return nil, err
	}
	desc := cognitionpkg.KnowledgeScopeDescriptor{
		Owner:       owner,
		DisplayName: strings.TrimSpace(req.GetDisplayName()),
		Metadata:    structToMap(req.GetMetadata()),
	}
	scope, err := s.cognitionCore.KnowledgeScopeRegistry().CreateKnowledgeScope(ctx, desc)
	if err != nil {
		if errors.Is(err, cognitionpkg.ErrScopeOwnerConflict) {
			return nil, grpcerr.WithReasonCode(codes.AlreadyExists, runtimev1.ReasonCode_KNOWLEDGE_BANK_ALREADY_EXISTS)
		}
		return nil, grpcerr.WithReasonCodeOptions(codes.Internal, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE, grpcerr.ReasonOptions{
			ActionHint: "retry_after_cognition_storage_recovery",
			Message:    "create knowledge bank: cognition storage error: " + err.Error(),
		})
	}
	return &runtimev1.CreateKnowledgeBankResponse{Bank: bankFromScope(scope)}, nil
}

// GetKnowledgeBank loads a registered scope and authorizes read.
func (s *Service) GetKnowledgeBank(ctx context.Context, req *runtimev1.GetKnowledgeBankRequest) (*runtimev1.GetKnowledgeBankResponse, error) {
	if err := validateKnowledgeContext(req.GetContext()); err != nil {
		return nil, err
	}
	scope, err := s.loadAuthorizedScope(ctx, req.GetContext(), req.GetBankId(), KnowledgeActionReadBank)
	if err != nil {
		return nil, err
	}
	return &runtimev1.GetKnowledgeBankResponse{Bank: bankFromScope(scope)}, nil
}

// ListKnowledgeBanks enumerates readable app_private scopes. Any
// explicit workspace_private selector is authorization-bearing and
// must fail closed until the admitted workspace authorization carrier
// exists; returning an empty page would be pseudo-success.
func (s *Service) ListKnowledgeBanks(ctx context.Context, req *runtimev1.ListKnowledgeBanksRequest) (*runtimev1.ListKnowledgeBanksResponse, error) {
	if err := validateKnowledgeContext(req.GetContext()); err != nil {
		return nil, err
	}
	if owner, ok := explicitWorkspaceOwnerFromList(req); ok {
		return nil, s.authorize(ctx, KnowledgeActionReadBank, req.GetContext(), owner)
	}
	filter := s.buildScopeFilterFromList(req)
	scopes, nextToken, err := s.cognitionCore.KnowledgeScopeRegistry().ListKnowledgeScopes(ctx, filter)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE)
	}
	banks := make([]*runtimev1.KnowledgeBank, 0, len(scopes))
	for _, scope := range scopes {
		if err := s.authorize(ctx, KnowledgeActionReadBank, req.GetContext(), scope.Owner); err != nil {
			continue
		}
		banks = append(banks, bankFromScope(scope))
	}
	return &runtimev1.ListKnowledgeBanksResponse{Banks: banks, NextPageToken: nextToken}, nil
}

// DeleteKnowledgeBank deletes the scope and cascades all dependent
// rows in one transaction via SQLiteBackend.DeleteScope (wired into
// nimi-cognition KnowledgeScopeRegistry.DeleteKnowledgeScope).
func (s *Service) DeleteKnowledgeBank(ctx context.Context, req *runtimev1.DeleteKnowledgeBankRequest) (*runtimev1.DeleteKnowledgeBankResponse, error) {
	if err := validateKnowledgeContext(req.GetContext()); err != nil {
		return nil, err
	}
	if _, err := s.loadAuthorizedScope(ctx, req.GetContext(), req.GetBankId(), KnowledgeActionDeleteBank); err != nil {
		return nil, err
	}
	if err := s.cognitionCore.KnowledgeScopeRegistry().DeleteKnowledgeScope(ctx, strings.TrimSpace(req.GetBankId())); err != nil {
		if errors.Is(err, cognitionpkg.ErrScopeNotFound) {
			return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_BANK_NOT_FOUND)
		}
		return nil, grpcerr.WithReasonCodeOptions(codes.Internal, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE, grpcerr.ReasonOptions{
			ActionHint: "retry_after_cognition_storage_recovery",
			Message:    "delete knowledge bank: cascade error: " + err.Error(),
		})
	}
	return &runtimev1.DeleteKnowledgeBankResponse{Ack: okAck()}, nil
}

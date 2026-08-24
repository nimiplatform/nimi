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
	access, err := s.authorizeRuntimeBridgeOperation(
		ctx,
		KnowledgeActionCreateBank,
		cognitionpkg.RuntimeBridgeOperationCreateKnowledgeScope,
		req.GetContext(),
		cognitionpkg.KnowledgeScope{Owner: owner},
	)
	if err != nil {
		return nil, err
	}
	desc := cognitionpkg.KnowledgeScopeDescriptor{
		Owner:       owner,
		DisplayName: strings.TrimSpace(req.GetDisplayName()),
		Metadata:    structToMap(req.GetMetadata()),
	}
	scope, err := s.cognitionCore.RuntimeBridge().CreateKnowledgeScope(ctx, access, desc)
	if err != nil {
		if errors.Is(err, cognitionpkg.ErrScopeOwnerConflict) {
			return nil, grpcerr.WrapWithReasonCode(
				codes.AlreadyExists,
				runtimev1.ReasonCode_KNOWLEDGE_BANK_ALREADY_EXISTS,
				err,
				grpcerr.ReasonOptions{Message: "knowledge bank already exists"},
			)
		}
		return nil, cognitionStorageError(err, "knowledge bank could not be created")
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

// ListKnowledgeBanks enumerates one exact owner. An empty selector defaults
// to the current caller's app_private owner; workspace access remains bound to
// an explicit singular workspace owner and its authorization carrier.
func (s *Service) ListKnowledgeBanks(ctx context.Context, req *runtimev1.ListKnowledgeBanksRequest) (*runtimev1.ListKnowledgeBanksResponse, error) {
	if err := validateKnowledgeContext(req.GetContext()); err != nil {
		return nil, err
	}
	owner, filter, err := s.resolveScopeFilterFromList(ctx, req)
	if err != nil {
		return nil, err
	}
	access, err := s.authorizeRuntimeBridgeOperation(
		ctx,
		KnowledgeActionReadBank,
		cognitionpkg.RuntimeBridgeOperationListKnowledgeScopes,
		req.GetContext(),
		cognitionpkg.KnowledgeScope{Owner: owner},
	)
	if err != nil {
		return nil, err
	}
	scopes, nextOffset, err := s.cognitionCore.RuntimeBridge().ListKnowledgeScopes(ctx, access, filter)
	if err != nil {
		return nil, cognitionBridgeError(
			err,
			codes.Internal,
			runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE,
			grpcerr.ReasonOptions{Message: "knowledge bank listing failed"},
		)
	}
	banks := make([]*runtimev1.KnowledgeBank, 0, len(scopes))
	for _, scope := range scopes {
		banks = append(banks, bankFromScope(scope))
	}
	return &runtimev1.ListKnowledgeBanksResponse{
		Banks:         banks,
		NextPageToken: encodeKnowledgeBankListPageToken(owner, nextOffset),
	}, nil
}

// DeleteKnowledgeBank deletes the scope and cascades all dependent
// rows in one transaction via SQLiteBackend.DeleteScope (wired into
// nimi-cognition KnowledgeScopeRegistry.DeleteKnowledgeScope).
func (s *Service) DeleteKnowledgeBank(ctx context.Context, req *runtimev1.DeleteKnowledgeBankRequest) (*runtimev1.DeleteKnowledgeBankResponse, error) {
	if err := validateKnowledgeContext(req.GetContext()); err != nil {
		return nil, err
	}
	scope, err := s.loadAuthorizedScope(ctx, req.GetContext(), req.GetBankId(), KnowledgeActionDeleteBank)
	if err != nil {
		return nil, err
	}
	access, err := s.authorizeRuntimeBridgeOperation(ctx, KnowledgeActionDeleteBank, cognitionpkg.RuntimeBridgeOperationDeleteKnowledgeScope, req.GetContext(), scope)
	if err != nil {
		return nil, err
	}
	if err := s.cognitionCore.RuntimeBridge().DeleteKnowledgeScope(ctx, access, strings.TrimSpace(req.GetBankId())); err != nil {
		if errors.Is(err, cognitionpkg.ErrScopeNotFound) {
			return nil, grpcerr.WrapWithReasonCode(
				codes.NotFound,
				runtimev1.ReasonCode_KNOWLEDGE_BANK_NOT_FOUND,
				err,
				grpcerr.ReasonOptions{Message: "knowledge bank not found"},
			)
		}
		return nil, cognitionStorageError(err, "knowledge bank could not be deleted")
	}
	return &runtimev1.DeleteKnowledgeBankResponse{Ack: okAck()}, nil
}

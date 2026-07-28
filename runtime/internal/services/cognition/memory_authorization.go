package cognition

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	"google.golang.org/grpc/codes"
)

type memorySessionOwner struct {
	accountID string
	appID     string
}

func authorizeMemorySession(ctx context.Context, requestCtx *runtimev1.MemoryRequestContext, capability string) (memorySessionOwner, error) {
	identity := authn.IdentityFromContext(ctx)
	accountID := ""
	if identity != nil {
		accountID = strings.TrimSpace(identity.SubjectUserID)
	}
	appID := strings.TrimSpace(requestCtx.GetAppId())
	if accountID == "" || appID == "" || !envelope.HasValidatedProtectedCapability(ctx, appID, capability) {
		return memorySessionOwner{}, memoryAccessDenied()
	}
	if requestedSubject := strings.TrimSpace(requestCtx.GetSubjectUserId()); requestedSubject != "" && requestedSubject != accountID {
		return memorySessionOwner{}, memoryAccessDenied()
	}
	return memorySessionOwner{accountID: accountID, appID: appID}, nil
}

func authorizeMemoryLocator(ctx context.Context, requestCtx *runtimev1.MemoryRequestContext, locator *runtimev1.MemoryBankLocator, capability string) (memorySessionOwner, error) {
	owner, err := authorizeMemorySession(ctx, requestCtx, capability)
	if err != nil {
		return memorySessionOwner{}, err
	}
	if locator == nil || locator.GetScope() != runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_APP_PRIVATE {
		return memorySessionOwner{}, memoryAccessDenied()
	}
	appPrivate := locator.GetAppPrivate()
	if appPrivate == nil ||
		strings.TrimSpace(appPrivate.GetAccountId()) != owner.accountID ||
		strings.TrimSpace(appPrivate.GetAppId()) != owner.appID {
		return memorySessionOwner{}, memoryAccessDenied()
	}
	return owner, nil
}

func authorizePublicMemoryLocator(ctx context.Context, requestCtx *runtimev1.MemoryRequestContext, locator *runtimev1.PublicMemoryBankLocator, capability string) (*runtimev1.MemoryBankLocator, memorySessionOwner, error) {
	full, err := publicMemoryLocatorToFull(locator)
	if err != nil {
		return nil, memorySessionOwner{}, err
	}
	owner, err := authorizeMemoryLocator(ctx, requestCtx, full, capability)
	if err != nil {
		return nil, memorySessionOwner{}, err
	}
	return full, owner, nil
}

func authorizedMemoryListRequest(ctx context.Context, req *runtimev1.ListBanksRequest) (*runtimev1.ListBanksRequest, error) {
	owner, err := authorizeMemorySession(ctx, req.GetContext(), "runtime.memory.read")
	if err != nil {
		return nil, err
	}
	if !memoryFiltersMatchSession(req.GetScopeFilters(), req.GetOwnerFilters(), owner) {
		return nil, memoryAccessDenied()
	}
	return &runtimev1.ListBanksRequest{
		Context:      req.GetContext(),
		ScopeFilters: []runtimev1.MemoryBankScope{runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_APP_PRIVATE},
		OwnerFilters: []*runtimev1.MemoryBankOwnerFilter{memoryOwnerFilter(owner)},
		PageSize:     req.GetPageSize(),
		PageToken:    req.GetPageToken(),
	}, nil
}

func authorizedMemorySubscription(ctx context.Context, req *runtimev1.SubscribeMemoryEventsRequest) (*runtimev1.SubscribeMemoryEventsRequest, error) {
	owner, err := authorizeMemorySession(ctx, req.GetContext(), "runtime.memory.read")
	if err != nil {
		return nil, err
	}
	if !memoryFiltersMatchSession(req.GetScopeFilters(), req.GetOwnerFilters(), owner) {
		return nil, memoryAccessDenied()
	}
	return &runtimev1.SubscribeMemoryEventsRequest{
		Context:      req.GetContext(),
		ScopeFilters: []runtimev1.MemoryBankScope{runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_APP_PRIVATE},
		OwnerFilters: []*runtimev1.MemoryBankOwnerFilter{memoryOwnerFilter(owner)},
		Cursor:       req.GetCursor(),
	}, nil
}

func memoryFiltersMatchSession(scopes []runtimev1.MemoryBankScope, filters []*runtimev1.MemoryBankOwnerFilter, owner memorySessionOwner) bool {
	for _, scope := range scopes {
		if scope != runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_APP_PRIVATE {
			return false
		}
	}
	for _, filter := range filters {
		appPrivate := filter.GetAppPrivate()
		if appPrivate == nil ||
			strings.TrimSpace(appPrivate.GetAccountId()) != owner.accountID ||
			strings.TrimSpace(appPrivate.GetAppId()) != owner.appID {
			return false
		}
	}
	return true
}

func memoryOwnerFilter(owner memorySessionOwner) *runtimev1.MemoryBankOwnerFilter {
	return &runtimev1.MemoryBankOwnerFilter{
		Owner: &runtimev1.MemoryBankOwnerFilter_AppPrivate{
			AppPrivate: &runtimev1.AppPrivateBankOwner{
				AccountId: owner.accountID,
				AppId:     owner.appID,
			},
		},
	}
}

func memoryAccessDenied() error {
	return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
}

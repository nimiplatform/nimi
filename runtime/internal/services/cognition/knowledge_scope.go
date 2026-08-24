package cognition

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	cognitionpkg "github.com/nimiplatform/nimi/nimi-cognition/cognition"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/pagination"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// This bounds only the synchronous Runtime-to-Cognition handoff. It does not
// mint a session or extend the underlying identity/workspace expiry.
const knowledgeAuthorizationDecisionTTL = 30 * time.Second

// authorize is the single seam every knowledge RPC uses to invoke the
// KnowledgeAuthorizer. It maps the typed result into a gRPC error.
func (s *Service) authorize(ctx context.Context, action KnowledgeAction, operation cognitionpkg.RuntimeBridgeOperation, requestCtx *runtimev1.KnowledgeRequestContext, owner cognitionpkg.KnowledgeScopeOwner) (KnowledgeAuthResult, error) {
	if operation == "" {
		return KnowledgeAuthResult{}, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	if err := authorizeKnowledgeSession(ctx, action, requestCtx); err != nil {
		return KnowledgeAuthResult{}, err
	}
	res, err := s.authorizer.Authorize(ctx, KnowledgeAuthRequest{
		Action:         action,
		Operation:      operation,
		Context:        requestCtx,
		Caller:         knowledgeCallerFromEnvelope(ctx),
		Owner:          owner,
		RequiredScopes: requiredScopesForKnowledgeAction(action),
	})
	if err != nil {
		return KnowledgeAuthResult{}, grpcerr.WrapWithReasonCode(
			codes.Internal,
			runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE,
			err,
			grpcerr.ReasonOptions{Message: "knowledge authorization failed"},
		)
	}
	if res.Action != action || res.Operation != operation {
		return KnowledgeAuthResult{}, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	if res.Decision == KnowledgeAuthAllow {
		now := time.Now().UTC()
		expiresAt := now.Add(knowledgeAuthorizationDecisionTTL)
		if identity := authn.IdentityFromContext(ctx); identity != nil && !identity.ExpiresAt.IsZero() && identity.ExpiresAt.UTC().Before(expiresAt) {
			expiresAt = identity.ExpiresAt.UTC()
		}
		if !res.ExpiresAt.IsZero() && res.ExpiresAt.UTC().Before(expiresAt) {
			expiresAt = res.ExpiresAt.UTC()
		}
		if !expiresAt.After(now) {
			return KnowledgeAuthResult{}, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
		}
		res.EvaluatedAt = now
		res.ExpiresAt = expiresAt
		return res, nil
	}
	code := codes.PermissionDenied
	if res.Reason == runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID {
		code = codes.InvalidArgument
	}
	return KnowledgeAuthResult{}, grpcerr.WithReasonCodeOptions(code, res.Reason, grpcerr.ReasonOptions{
		ActionHint: res.ActionHint,
		Message:    res.Message,
	})
}

func authorizeKnowledgeSession(ctx context.Context, action KnowledgeAction, requestCtx *runtimev1.KnowledgeRequestContext) error {
	identity := authn.IdentityFromContext(ctx)
	accountID := ""
	if identity != nil {
		accountID = strings.TrimSpace(identity.SubjectUserID)
		if !identity.ExpiresAt.IsZero() && !identity.ExpiresAt.UTC().After(time.Now().UTC()) {
			return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
		}
	}
	appID := trimContextAppID(requestCtx)
	callerAppID := callerAppIDFromEnvelope(ctx)
	required := requiredScopesForKnowledgeAction(action)
	if accountID == "" || appID == "" || callerAppID == "" || callerAppID != appID || len(required) != 1 {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	if requestedSubject := strings.TrimSpace(requestCtx.GetSubjectUserId()); requestedSubject != "" && requestedSubject != accountID {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	if !envelope.HasValidatedProtectedCapability(ctx, appID, required[0]) {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	return nil
}

func knowledgeCallerFromEnvelope(ctx context.Context) *runtimev1.AccountCaller {
	meta, ok := envelope.MetadataFromContext(ctx)
	if !ok {
		return nil
	}
	appID := strings.TrimSpace(meta.AppID)
	appInstanceID := strings.TrimSpace(meta.AppInstanceID)
	if appID == "" || appInstanceID == "" {
		return nil
	}
	return &runtimev1.AccountCaller{
		AppId:         appID,
		AppInstanceId: appInstanceID,
		Mode:          runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_LOCAL_FIRST_PARTY_APP,
	}
}

// loadAuthorizedScope loads a scope by id and authorizes the action
// against its owner. Maps not-found to KNOWLEDGE_BANK_NOT_FOUND.
func (s *Service) loadAuthorizedScope(ctx context.Context, requestCtx *runtimev1.KnowledgeRequestContext, bankID string, action KnowledgeAction) (cognitionpkg.KnowledgeScope, error) {
	scope, err := s.cognitionCore.KnowledgeScopeRegistry().GetKnowledgeScope(ctx, strings.TrimSpace(bankID))
	if err != nil {
		if errors.Is(err, cognitionpkg.ErrScopeNotFound) {
			return cognitionpkg.KnowledgeScope{}, grpcerr.WrapWithReasonCode(
				codes.NotFound,
				runtimev1.ReasonCode_KNOWLEDGE_BANK_NOT_FOUND,
				err,
				grpcerr.ReasonOptions{Message: "knowledge bank not found"},
			)
		}
		return cognitionpkg.KnowledgeScope{}, grpcerr.WrapWithReasonCode(
			codes.Internal,
			runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE,
			err,
			grpcerr.ReasonOptions{Message: "knowledge bank lookup failed"},
		)
	}
	access, err := s.authorizeRuntimeBridgeOperation(
		ctx,
		action,
		cognitionpkg.RuntimeBridgeOperationGetKnowledgeScope,
		requestCtx,
		scope,
	)
	if err != nil {
		return cognitionpkg.KnowledgeScope{}, err
	}
	authorized, err := s.cognitionCore.RuntimeBridge().GetKnowledgeScope(ctx, access, scope.ScopeID)
	if err != nil {
		if errors.Is(err, cognitionpkg.ErrScopeNotFound) {
			return cognitionpkg.KnowledgeScope{}, grpcerr.WrapWithReasonCode(
				codes.NotFound,
				runtimev1.ReasonCode_KNOWLEDGE_BANK_NOT_FOUND,
				err,
				grpcerr.ReasonOptions{Message: "knowledge bank not found"},
			)
		}
		return cognitionpkg.KnowledgeScope{}, cognitionBridgeError(
			err,
			codes.Internal,
			runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE,
			grpcerr.ReasonOptions{Message: "knowledge bank lookup failed"},
		)
	}
	return authorized, nil
}

// listAuthorizedScopes returns every scope the caller can read. Used
// by SearchKeyword (default empty bank list) and GetIngestTask.
func (s *Service) listAuthorizedScopes(ctx context.Context, requestCtx *runtimev1.KnowledgeRequestContext) ([]cognitionpkg.KnowledgeScope, error) {
	callerAppID := callerAppIDFromEnvelope(ctx)
	owner := cognitionpkg.KnowledgeScopeOwner{Kind: cognitionpkg.KnowledgeScopeOwnerKindAppPrivate, AppID: callerAppID}
	listAccess, err := s.authorizeRuntimeBridgeOperation(
		ctx,
		KnowledgeActionReadBank,
		cognitionpkg.RuntimeBridgeOperationListKnowledgeScopes,
		requestCtx,
		cognitionpkg.KnowledgeScope{Owner: owner},
	)
	if err != nil {
		return nil, err
	}
	filter := cognitionpkg.KnowledgeScopeFilter{
		OwnerKinds: []string{cognitionpkg.KnowledgeScopeOwnerKindAppPrivate},
		Owners:     []cognitionpkg.KnowledgeScopeOwner{owner},
		PageSize:   maxKnowledgePageSize,
	}
	var scopes []cognitionpkg.KnowledgeScope
	for {
		page, nextOffset, listErr := s.cognitionCore.RuntimeBridge().ListKnowledgeScopes(ctx, listAccess, filter)
		if listErr != nil {
			return nil, cognitionBridgeError(
				listErr,
				codes.Internal,
				runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE,
				grpcerr.ReasonOptions{Message: "knowledge bank listing failed"},
			)
		}
		scopes = append(scopes, page...)
		if nextOffset == 0 {
			break
		}
		filter.PageOffset = nextOffset
	}
	return scopes, nil
}

// @nimi-authority: rule.nimi.runtime.rpc-foundations.r007
// resolveScopeFilterFromList binds the public singular selector to one exact
// owner and decodes Runtime-owned continuation state into an internal offset.
// An empty selector defaults to the current caller's app_private owner.
func (s *Service) resolveScopeFilterFromList(ctx context.Context, req *runtimev1.ListKnowledgeBanksRequest) (cognitionpkg.KnowledgeScopeOwner, cognitionpkg.KnowledgeScopeFilter, error) {
	callerAppID := callerAppIDFromEnvelope(ctx)
	owner := cognitionpkg.KnowledgeScopeOwner{}
	scope := req.GetScopeFilter()
	ownerFilter := req.GetOwnerFilter()

	switch {
	case ownerFilter == nil && scope == runtimev1.KnowledgeBankScope_KNOWLEDGE_BANK_SCOPE_UNSPECIFIED:
		owner = cognitionpkg.KnowledgeScopeOwner{Kind: cognitionpkg.KnowledgeScopeOwnerKindAppPrivate, AppID: callerAppID}
	case ownerFilter == nil && (scope == runtimev1.KnowledgeBankScope_KNOWLEDGE_BANK_SCOPE_APP_PRIVATE || scope == runtimev1.KnowledgeBankScope_KNOWLEDGE_BANK_SCOPE_WORKSPACE_PRIVATE):
		return cognitionpkg.KnowledgeScopeOwner{}, cognitionpkg.KnowledgeScopeFilter{}, invalidKnowledgeListFilter("explicit knowledge bank scope requires one matching owner")
	case ownerFilter == nil:
		return cognitionpkg.KnowledgeScopeOwner{}, cognitionpkg.KnowledgeScopeFilter{}, invalidKnowledgeListFilter("knowledge bank scope filter is invalid")
	case scope == runtimev1.KnowledgeBankScope_KNOWLEDGE_BANK_SCOPE_UNSPECIFIED:
		return cognitionpkg.KnowledgeScopeOwner{}, cognitionpkg.KnowledgeScopeFilter{}, invalidKnowledgeListFilter("explicit knowledge bank owner requires one matching scope")
	case ownerFilter.GetAppPrivate() != nil:
		appID := strings.TrimSpace(ownerFilter.GetAppPrivate().GetAppId())
		if appID == "" || appID != callerAppID || (scope != runtimev1.KnowledgeBankScope_KNOWLEDGE_BANK_SCOPE_UNSPECIFIED && scope != runtimev1.KnowledgeBankScope_KNOWLEDGE_BANK_SCOPE_APP_PRIVATE) {
			return cognitionpkg.KnowledgeScopeOwner{}, cognitionpkg.KnowledgeScopeFilter{}, invalidKnowledgeListFilter("app_private scope and owner must match the current caller App")
		}
		owner = cognitionpkg.KnowledgeScopeOwner{Kind: cognitionpkg.KnowledgeScopeOwnerKindAppPrivate, AppID: appID}
	case ownerFilter.GetWorkspacePrivate() != nil:
		workspaceID := strings.TrimSpace(ownerFilter.GetWorkspacePrivate().GetWorkspaceId())
		if workspaceID == "" || (scope != runtimev1.KnowledgeBankScope_KNOWLEDGE_BANK_SCOPE_UNSPECIFIED && scope != runtimev1.KnowledgeBankScope_KNOWLEDGE_BANK_SCOPE_WORKSPACE_PRIVATE) {
			return cognitionpkg.KnowledgeScopeOwner{}, cognitionpkg.KnowledgeScopeFilter{}, invalidKnowledgeListFilter("workspace_private scope and owner must match one non-empty workspace")
		}
		owner = cognitionpkg.KnowledgeScopeOwner{Kind: cognitionpkg.KnowledgeScopeOwnerKindWorkspace, WorkspaceID: workspaceID}
	default:
		return cognitionpkg.KnowledgeScopeOwner{}, cognitionpkg.KnowledgeScopeFilter{}, invalidKnowledgeListFilter("knowledge bank owner filter is invalid")
	}
	pageSize, err := knowledgeBankListPageSize(req.GetPageSize())
	if err != nil {
		return cognitionpkg.KnowledgeScopeOwner{}, cognitionpkg.KnowledgeScopeFilter{}, err
	}
	filterDigest := knowledgeBankListFilterDigest(owner)
	cursor, err := pagination.ValidatePageToken(req.GetPageToken(), filterDigest)
	if err != nil {
		return cognitionpkg.KnowledgeScopeOwner{}, cognitionpkg.KnowledgeScopeFilter{}, err
	}
	pageOffset := 0
	if req.GetPageToken() != "" {
		pageOffset, err = parseKnowledgeBankListCursor(cursor)
		if err != nil {
			return cognitionpkg.KnowledgeScopeOwner{}, cognitionpkg.KnowledgeScopeFilter{}, err
		}
	}

	return owner, cognitionpkg.KnowledgeScopeFilter{
		OwnerKinds: []string{owner.Kind},
		Owners:     []cognitionpkg.KnowledgeScopeOwner{owner},
		PageSize:   pageSize,
		PageOffset: pageOffset,
	}, nil
}

func knowledgeBankListPageSize(raw int32) (int, error) {
	if raw == 0 {
		return defaultKnowledgePageSize, nil
	}
	if raw < 0 || raw > maxKnowledgePageSize {
		return 0, invalidKnowledgeListFilter("knowledge bank page_size must be between 1 and 100")
	}
	return int(raw), nil
}

func knowledgeBankListFilterDigest(owner cognitionpkg.KnowledgeScopeOwner) string {
	return pagination.FilterDigest(
		"list_knowledge_banks",
		strings.TrimSpace(owner.Kind),
		strings.TrimSpace(owner.AppID),
		strings.TrimSpace(owner.WorkspaceID),
	)
}

func parseKnowledgeBankListCursor(cursor string) (int, error) {
	offset, err := strconv.Atoi(cursor)
	if err != nil || offset <= 0 || strconv.Itoa(offset) != cursor {
		return 0, invalidKnowledgeListPageToken("knowledge bank page token cursor is invalid")
	}
	return offset, nil
}

func encodeKnowledgeBankListPageToken(owner cognitionpkg.KnowledgeScopeOwner, nextOffset int) string {
	if nextOffset <= 0 {
		return ""
	}
	return pagination.Encode(strconv.Itoa(nextOffset), knowledgeBankListFilterDigest(owner))
}

func invalidKnowledgeListFilter(message string) error {
	return grpcerr.WithReasonCodeOptions(
		codes.InvalidArgument,
		runtimev1.ReasonCode_KNOWLEDGE_BANK_SCOPE_INVALID,
		grpcerr.ReasonOptions{Message: message},
	)
}

func invalidKnowledgeListPageToken(message string) error {
	return grpcerr.WithReasonCodeOptions(
		codes.InvalidArgument,
		runtimev1.ReasonCode_PAGE_TOKEN_INVALID,
		grpcerr.ReasonOptions{Message: message},
	)
}

func callerAppIDFromEnvelope(ctx context.Context) string {
	meta, ok := envelope.MetadataFromContext(ctx)
	if !ok {
		return ""
	}
	return strings.TrimSpace(meta.AppID)
}

func (s *Service) authorizeRuntimeBridgeOperation(ctx context.Context, action KnowledgeAction, operation cognitionpkg.RuntimeBridgeOperation, requestCtx *runtimev1.KnowledgeRequestContext, scope cognitionpkg.KnowledgeScope) (cognitionpkg.RuntimeAuthorization, error) {
	decision, err := s.authorize(ctx, action, operation, requestCtx, scope.Owner)
	if err != nil {
		return cognitionpkg.RuntimeAuthorization{}, err
	}
	return runtimeAuthorizationFromDecision(ctx, decision, requestCtx, scope), nil
}

func runtimeAuthorizationFromDecision(ctx context.Context, decision KnowledgeAuthResult, requestCtx *runtimev1.KnowledgeRequestContext, scope cognitionpkg.KnowledgeScope) cognitionpkg.RuntimeAuthorization {
	appID := callerAppIDFromEnvelope(ctx)
	if appID == "" {
		appID = trimContextAppID(requestCtx)
	}
	accountID := ""
	if identity := authn.IdentityFromContext(ctx); identity != nil {
		accountID = strings.TrimSpace(identity.SubjectUserID)
	}
	return cognitionpkg.RuntimeAuthorization{
		Decision:    cognitionpkg.RuntimeAuthorizationDecision(decision.Decision),
		Action:      cognitionpkg.RuntimeAuthorizationAction(decision.Action),
		Operation:   decision.Operation,
		AccountID:   accountID,
		AppID:       appID,
		ScopeID:     strings.TrimSpace(scope.ScopeID),
		Owner:       scope.Owner,
		EvaluatedAt: decision.EvaluatedAt,
		ExpiresAt:   decision.ExpiresAt,
	}
}

// ownerFromPublicLocator translates the proto PublicKnowledgeBankLocator
// into the typed KnowledgeScopeOwner used by the registry.
func ownerFromPublicLocator(locator *runtimev1.PublicKnowledgeBankLocator) (cognitionpkg.KnowledgeScopeOwner, error) {
	if locator == nil {
		return cognitionpkg.KnowledgeScopeOwner{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if app := locator.GetAppPrivate(); app != nil {
		return cognitionpkg.KnowledgeScopeOwner{
			Kind:  cognitionpkg.KnowledgeScopeOwnerKindAppPrivate,
			AppID: strings.TrimSpace(app.GetAppId()),
		}, nil
	}
	if ws := locator.GetWorkspacePrivate(); ws != nil {
		return cognitionpkg.KnowledgeScopeOwner{
			Kind:        cognitionpkg.KnowledgeScopeOwnerKindWorkspace,
			WorkspaceID: strings.TrimSpace(ws.GetWorkspaceId()),
		}, nil
	}
	return cognitionpkg.KnowledgeScopeOwner{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_KNOWLEDGE_BANK_SCOPE_INVALID)
}

// bankFromScope projects a typed KnowledgeScope into the runtime proto
// KnowledgeBank envelope. The scope_id is the bank_id.
func bankFromScope(scope cognitionpkg.KnowledgeScope) *runtimev1.KnowledgeBank {
	bank := &runtimev1.KnowledgeBank{
		BankId:      scope.ScopeID,
		Locator:     locatorFromOwner(scope.Owner),
		DisplayName: scope.DisplayName,
		Metadata:    mapToStruct(scope.Metadata),
		CreatedAt:   timestamppb.New(scope.CreatedAt),
		UpdatedAt:   timestamppb.New(scope.UpdatedAt),
	}
	return bank
}

func locatorFromOwner(owner cognitionpkg.KnowledgeScopeOwner) *runtimev1.KnowledgeBankLocator {
	switch owner.Kind {
	case cognitionpkg.KnowledgeScopeOwnerKindAppPrivate:
		return &runtimev1.KnowledgeBankLocator{
			Scope: runtimev1.KnowledgeBankScope_KNOWLEDGE_BANK_SCOPE_APP_PRIVATE,
			Owner: &runtimev1.KnowledgeBankLocator_AppPrivate{
				AppPrivate: &runtimev1.KnowledgeAppPrivateOwner{AppId: owner.AppID},
			},
		}
	case cognitionpkg.KnowledgeScopeOwnerKindWorkspace:
		return &runtimev1.KnowledgeBankLocator{
			Scope: runtimev1.KnowledgeBankScope_KNOWLEDGE_BANK_SCOPE_WORKSPACE_PRIVATE,
			Owner: &runtimev1.KnowledgeBankLocator_WorkspacePrivate{
				WorkspacePrivate: &runtimev1.KnowledgeWorkspacePrivateOwner{WorkspaceId: owner.WorkspaceID},
			},
		}
	}
	return nil
}

func structToMap(value *structpb.Struct) map[string]any {
	if value == nil {
		return nil
	}
	return value.AsMap()
}

func mapToStruct(value map[string]any) *structpb.Struct {
	if len(value) == 0 {
		return nil
	}
	out, err := structpb.NewStruct(value)
	if err != nil {
		return nil
	}
	return out
}

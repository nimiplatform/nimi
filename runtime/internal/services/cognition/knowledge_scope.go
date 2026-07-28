package cognition

import (
	"context"
	"errors"
	"strings"

	cognitionpkg "github.com/nimiplatform/nimi/nimi-cognition/cognition"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// authorize is the single seam every knowledge RPC uses to invoke the
// KnowledgeAuthorizer. It maps the typed result into a gRPC error.
func (s *Service) authorize(ctx context.Context, action KnowledgeAction, requestCtx *runtimev1.KnowledgeRequestContext, owner cognitionpkg.KnowledgeScopeOwner) error {
	if err := authorizeKnowledgeSession(ctx, action, requestCtx); err != nil {
		return err
	}
	res, err := s.authorizer.Authorize(ctx, KnowledgeAuthRequest{
		Action:         action,
		Context:        requestCtx,
		Caller:         knowledgeCallerFromEnvelope(ctx),
		Owner:          owner,
		RequiredScopes: requiredScopesForKnowledgeAction(action),
	})
	if err != nil {
		return grpcerr.WrapWithReasonCode(
			codes.Internal,
			runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE,
			err,
			grpcerr.ReasonOptions{Message: "knowledge authorization failed"},
		)
	}
	if res.Decision == KnowledgeAuthAllow {
		return nil
	}
	code := codes.PermissionDenied
	if res.Reason == runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID {
		code = codes.InvalidArgument
	}
	return grpcerr.WithReasonCodeOptions(code, res.Reason, grpcerr.ReasonOptions{
		ActionHint: res.ActionHint,
		Message:    res.Message,
	})
}

func authorizeKnowledgeSession(ctx context.Context, action KnowledgeAction, requestCtx *runtimev1.KnowledgeRequestContext) error {
	identity := authn.IdentityFromContext(ctx)
	accountID := ""
	if identity != nil {
		accountID = strings.TrimSpace(identity.SubjectUserID)
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
	if err := s.authorize(ctx, action, requestCtx, scope.Owner); err != nil {
		return cognitionpkg.KnowledgeScope{}, err
	}
	return scope, nil
}

// listAuthorizedScopes returns every scope the caller can read. Used
// by SearchKeyword (default empty bank list) and GetIngestTask.
func (s *Service) listAuthorizedScopes(ctx context.Context, requestCtx *runtimev1.KnowledgeRequestContext) ([]cognitionpkg.KnowledgeScope, error) {
	callerAppID := callerAppIDFromEnvelope(ctx)
	owner := cognitionpkg.KnowledgeScopeOwner{Kind: cognitionpkg.KnowledgeScopeOwnerKindAppPrivate, AppID: callerAppID}
	if err := s.authorize(ctx, KnowledgeActionReadBank, requestCtx, owner); err != nil {
		return nil, err
	}
	filter := cognitionpkg.KnowledgeScopeFilter{
		OwnerKinds: []string{cognitionpkg.KnowledgeScopeOwnerKindAppPrivate},
		Owners:     []cognitionpkg.KnowledgeScopeOwner{owner},
	}
	access := runtimeAuthorizationForKnowledge(ctx, KnowledgeActionReadBank, requestCtx, cognitionpkg.KnowledgeScope{Owner: owner})
	scopes, _, err := s.cognitionCore.RuntimeBridge().ListKnowledgeScopes(ctx, access, filter)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(
			codes.Internal,
			runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE,
			err,
			grpcerr.ReasonOptions{Message: "knowledge bank listing failed"},
		)
	}
	out := make([]cognitionpkg.KnowledgeScope, 0, len(scopes))
	for _, scope := range scopes {
		if err := s.authorize(ctx, KnowledgeActionReadBank, requestCtx, scope.Owner); err != nil {
			continue
		}
		out = append(out, scope)
	}
	return out, nil
}

// buildScopeFilterFromList narrows the registry list by request
// owner_filters / scope_filters; defaults to caller's app_private
// when neither is provided (per design D3 ListKnowledgeBanks).
func (s *Service) buildScopeFilterFromList(ctx context.Context, req *runtimev1.ListKnowledgeBanksRequest) cognitionpkg.KnowledgeScopeFilter {
	filter := cognitionpkg.KnowledgeScopeFilter{
		PageSize:  int(req.GetPageSize()),
		PageToken: req.GetPageToken(),
	}
	for _, scope := range req.GetScopeFilters() {
		switch scope {
		case runtimev1.KnowledgeBankScope_KNOWLEDGE_BANK_SCOPE_APP_PRIVATE:
			filter.OwnerKinds = append(filter.OwnerKinds, cognitionpkg.KnowledgeScopeOwnerKindAppPrivate)
		case runtimev1.KnowledgeBankScope_KNOWLEDGE_BANK_SCOPE_WORKSPACE_PRIVATE:
			filter.OwnerKinds = append(filter.OwnerKinds, cognitionpkg.KnowledgeScopeOwnerKindWorkspace)
		}
	}
	for _, owner := range req.GetOwnerFilters() {
		if app := owner.GetAppPrivate(); app != nil {
			filter.Owners = append(filter.Owners, cognitionpkg.KnowledgeScopeOwner{
				Kind:  cognitionpkg.KnowledgeScopeOwnerKindAppPrivate,
				AppID: strings.TrimSpace(app.GetAppId()),
			})
		}
		if ws := owner.GetWorkspacePrivate(); ws != nil {
			filter.Owners = append(filter.Owners, cognitionpkg.KnowledgeScopeOwner{
				Kind:        cognitionpkg.KnowledgeScopeOwnerKindWorkspace,
				WorkspaceID: strings.TrimSpace(ws.GetWorkspaceId()),
			})
		}
	}
	if len(filter.OwnerKinds) == 0 && len(filter.Owners) == 0 {
		filter.OwnerKinds = []string{cognitionpkg.KnowledgeScopeOwnerKindAppPrivate}
		filter.Owners = []cognitionpkg.KnowledgeScopeOwner{{
			Kind:  cognitionpkg.KnowledgeScopeOwnerKindAppPrivate,
			AppID: callerAppIDFromEnvelope(ctx),
		}}
	}
	return filter
}

func callerAppIDFromEnvelope(ctx context.Context) string {
	meta, ok := envelope.MetadataFromContext(ctx)
	if !ok {
		return ""
	}
	return strings.TrimSpace(meta.AppID)
}

func runtimeAuthorizationForKnowledge(ctx context.Context, action KnowledgeAction, requestCtx *runtimev1.KnowledgeRequestContext, scope cognitionpkg.KnowledgeScope) cognitionpkg.RuntimeAuthorization {
	appID := callerAppIDFromEnvelope(ctx)
	if appID == "" {
		appID = trimContextAppID(requestCtx)
	}
	mode := cognitionpkg.RuntimeAccessRead
	switch action {
	case KnowledgeActionCreateBank, KnowledgeActionDeleteBank, KnowledgeActionWritePage, KnowledgeActionDeletePage, KnowledgeActionWriteLink, KnowledgeActionIngest:
		mode = cognitionpkg.RuntimeAccessWrite
	}
	accountID := ""
	if identity := authn.IdentityFromContext(ctx); identity != nil {
		accountID = strings.TrimSpace(identity.SubjectUserID)
	}
	return cognitionpkg.RuntimeAuthorization{
		Allowed:   true,
		AccountID: accountID,
		AppID:     appID,
		Mode:      mode,
		ScopeID:   strings.TrimSpace(scope.ScopeID),
		Owner:     scope.Owner,
	}
}

func explicitWorkspaceOwnerFromList(req *runtimev1.ListKnowledgeBanksRequest) (cognitionpkg.KnowledgeScopeOwner, bool) {
	for _, owner := range req.GetOwnerFilters() {
		if ws := owner.GetWorkspacePrivate(); ws != nil {
			return cognitionpkg.KnowledgeScopeOwner{
				Kind:        cognitionpkg.KnowledgeScopeOwnerKindWorkspace,
				WorkspaceID: strings.TrimSpace(ws.GetWorkspaceId()),
			}, true
		}
	}
	for _, scope := range req.GetScopeFilters() {
		if scope == runtimev1.KnowledgeBankScope_KNOWLEDGE_BANK_SCOPE_WORKSPACE_PRIVATE {
			return cognitionpkg.KnowledgeScopeOwner{
				Kind: cognitionpkg.KnowledgeScopeOwnerKindWorkspace,
			}, true
		}
	}
	return cognitionpkg.KnowledgeScopeOwner{}, false
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

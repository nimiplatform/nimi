package cognition

import (
	"context"
	"log/slog"
	"strings"

	cognitionpkg "github.com/nimiplatform/nimi/nimi-cognition/cognition"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

// accountKnowledgeAuthorizer is the production KnowledgeAuthorizer.
//
// APP_PRIVATE: allow iff context.AppId == owner.AppID. Both must be
// non-empty.
//
// WORKSPACE_PRIVATE: allow only through the admitted account-owned
// workspace binding resolver. If no resolver is wired, workspace access
// keeps the previous fail-closed no-binding posture.
type accountKnowledgeAuthorizer struct {
	logger   *slog.Logger
	resolver accountservice.WorkspaceBindingResolver
}

// NewAccountKnowledgeAuthorizer constructs the production authorizer.
// The logger is optional; nil disables structured audit log lines.
func NewAccountKnowledgeAuthorizer(logger *slog.Logger, resolver ...accountservice.WorkspaceBindingResolver) KnowledgeAuthorizer {
	var resolved accountservice.WorkspaceBindingResolver
	if len(resolver) > 0 {
		resolved = resolver[0]
	}
	return &accountKnowledgeAuthorizer{logger: logger, resolver: resolved}
}

// @nimi-authority: rule.nimi.cognition.runtime-bridge.r005
// Authorize implements KnowledgeAuthorizer.
func (a *accountKnowledgeAuthorizer) Authorize(ctx context.Context, req KnowledgeAuthRequest) (KnowledgeAuthResult, error) {
	callerApp := trimCallerAppID(req.Caller)
	subjectUser := ""
	if req.Context != nil {
		subjectUser = strings.TrimSpace(req.Context.GetSubjectUserId())
	}
	switch req.Owner.Kind {
	case cognitionpkg.KnowledgeScopeOwnerKindAppPrivate:
		ownerApp := strings.TrimSpace(req.Owner.AppID)
		if callerApp != "" && ownerApp != "" && callerApp == ownerApp {
			result := allowedAuthResult()
			a.logDecision(req, callerApp, subjectUser, result)
			return result, nil
		}
		result := denyOwnerMismatchResult()
		a.logDecision(req, callerApp, subjectUser, result)
		return result, nil
	case cognitionpkg.KnowledgeScopeOwnerKindWorkspace:
		result := denyWorkspaceNoBindingResult()
		if a.resolver != nil {
			decision := a.resolver.ResolveWorkspaceBinding(ctx, accountservice.WorkspaceBindingResolveRequest{
				Caller:            req.Caller,
				Attachment:        req.Context.GetWorkspaceBinding(),
				TargetWorkspaceID: strings.TrimSpace(req.Owner.WorkspaceID),
				RequiredScopes:    append([]string(nil), req.RequiredScopes...),
				KnowledgeAction:   string(req.Action),
			})
			result = knowledgeResultFromWorkspaceDecision(decision)
		}
		a.logDecision(req, callerApp, subjectUser, result)
		return result, nil
	default:
		result := denyUnknownScopeResult(req.Owner.Kind)
		a.logDecision(req, callerApp, subjectUser, result)
		return result, nil
	}
}

func trimCallerAppID(caller *runtimev1.AccountCaller) string {
	if caller == nil {
		return ""
	}
	return strings.TrimSpace(caller.GetAppId())
}

func (a *accountKnowledgeAuthorizer) logDecision(req KnowledgeAuthRequest, callerApp, subjectUser string, result KnowledgeAuthResult) {
	if a == nil || a.logger == nil {
		return
	}
	a.logger.Debug("knowledge authorize",
		"action", string(req.Action),
		"owner_kind", req.Owner.Kind,
		"owner_app_id", strings.TrimSpace(req.Owner.AppID),
		"owner_workspace_id", strings.TrimSpace(req.Owner.WorkspaceID),
		"caller_app_id", callerApp,
		"subject_user_id", subjectUser,
		"decision", string(result.Decision),
		"reason_code", result.Reason.String(),
	)
}

func knowledgeResultFromWorkspaceDecision(decision accountservice.WorkspaceBindingResolveResult) KnowledgeAuthResult {
	if decision.Decision == accountservice.WorkspaceBindingAllow {
		return allowedAuthResult()
	}
	return KnowledgeAuthResult{
		Decision:   KnowledgeAuthDenyResolver,
		Reason:     decision.Reason,
		ActionHint: decision.ActionHint,
		Message:    "workspace private knowledge access denied: " + string(decision.Decision),
	}
}

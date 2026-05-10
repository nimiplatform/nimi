package cognition

import (
	"context"
	"log/slog"
	"strings"

	cognitionpkg "github.com/nimiplatform/nimi/nimi-cognition/cognition"
)

// accountKnowledgeAuthorizer is the production KnowledgeAuthorizer.
//
// APP_PRIVATE: allow iff context.AppId == owner.AppID. Both must be
// non-empty.
//
// WORKSPACE_PRIVATE: always deny within this topic per
// `decision-review-r1-workspace-binding-not-resolvable.md`. Functional
// re-enablement is owned by sibling topic
// `2026-05-10-runtime-workspace-binding-resolver`.
//
// The file name `authorizer_account.go` is reserved for the future
// integration with the account/app subsystem that will land the
// workspace binding resolver. Today this implementation does not
// query account services because no admitted resolver API exists.
type accountKnowledgeAuthorizer struct {
	logger *slog.Logger
}

// NewAccountKnowledgeAuthorizer constructs the production authorizer.
// The logger is optional; nil disables structured audit log lines.
func NewAccountKnowledgeAuthorizer(logger *slog.Logger) KnowledgeAuthorizer {
	return &accountKnowledgeAuthorizer{logger: logger}
}

// Authorize implements KnowledgeAuthorizer.
func (a *accountKnowledgeAuthorizer) Authorize(_ context.Context, req KnowledgeAuthRequest) (KnowledgeAuthResult, error) {
	callerApp := trimContextAppID(req.Context)
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
		a.logDecision(req, callerApp, subjectUser, result)
		return result, nil
	default:
		result := denyUnknownScopeResult(req.Owner.Kind)
		a.logDecision(req, callerApp, subjectUser, result)
		return result, nil
	}
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

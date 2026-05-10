package cognition

import (
	"context"
	"strings"

	cognitionpkg "github.com/nimiplatform/nimi/nimi-cognition/cognition"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// KnowledgeAction enumerates the typed actions a KnowledgeAuthorizer
// authorizes against a runtime knowledge bank scope. Every Knowledge
// RPC handler must map exactly one action onto exactly one Authorize
// call before touching cognition stores.
type KnowledgeAction string

const (
	KnowledgeActionCreateBank KnowledgeAction = "create_bank"
	KnowledgeActionReadBank   KnowledgeAction = "read_bank"
	KnowledgeActionDeleteBank KnowledgeAction = "delete_bank"
	KnowledgeActionWritePage  KnowledgeAction = "write_page"
	KnowledgeActionReadPage   KnowledgeAction = "read_page"
	KnowledgeActionDeletePage KnowledgeAction = "delete_page"
	KnowledgeActionSearch     KnowledgeAction = "search"
	KnowledgeActionWriteLink  KnowledgeAction = "write_link"
	KnowledgeActionReadLink   KnowledgeAction = "read_link"
	KnowledgeActionIngest     KnowledgeAction = "ingest"
)

// KnowledgeAuthDecision is the typed outcome of an authorize call.
type KnowledgeAuthDecision string

const (
	KnowledgeAuthAllow             KnowledgeAuthDecision = "allow"
	KnowledgeAuthDenyOwnerMismatch KnowledgeAuthDecision = "deny_owner_mismatch"
	KnowledgeAuthDenyNoBinding     KnowledgeAuthDecision = "deny_no_binding"
	KnowledgeAuthDenyUnknownScope  KnowledgeAuthDecision = "deny_unknown_scope"
)

// KnowledgeAuthRequest is the input envelope for an Authorize call.
// Owner is the typed owner of the target scope (or, for create_bank,
// the proposed owner from the request locator).
type KnowledgeAuthRequest struct {
	Action  KnowledgeAction
	Context *runtimev1.KnowledgeRequestContext
	Owner   cognitionpkg.KnowledgeScopeOwner
}

// KnowledgeAuthResult carries the typed decision plus the
// admitted ReasonCode that maps onto the gRPC error.
type KnowledgeAuthResult struct {
	Decision   KnowledgeAuthDecision
	Reason     runtimev1.ReasonCode
	ActionHint string
	Message    string
}

// KnowledgeAuthorizer is the typed authorization seam consumed by
// every knowledge RPC handler in cognition.Service. Production paths
// must not look up account/binding state directly.
type KnowledgeAuthorizer interface {
	Authorize(ctx context.Context, req KnowledgeAuthRequest) (KnowledgeAuthResult, error)
}

// allowedAuthResult is the constant allow envelope used when no
// further reason is needed.
func allowedAuthResult() KnowledgeAuthResult {
	return KnowledgeAuthResult{
		Decision: KnowledgeAuthAllow,
		Reason:   runtimev1.ReasonCode_ACTION_EXECUTED,
	}
}

// denyOwnerMismatchResult maps an APP_PRIVATE app_id mismatch to
// the typed bank-access-denied reason. action_hint matches the
// legacy denyWorkspaceKnowledgeAccess hint shape (semantic family
// used across knowledge auth denials).
func denyOwnerMismatchResult() KnowledgeAuthResult {
	return KnowledgeAuthResult{
		Decision:   KnowledgeAuthDenyOwnerMismatch,
		Reason:     runtimev1.ReasonCode_KNOWLEDGE_BANK_ACCESS_DENIED,
		ActionHint: "use_an_admitted_app_authorization_carrier",
		Message:    "knowledge bank access denied: caller app_id does not match owner app_id",
	}
}

// denyWorkspaceNoBindingResult is the always-deny envelope for
// WORKSPACE_PRIVATE within this topic. The action_hint must match
// the legacy denyWorkspaceKnowledgeAccess action_hint exactly per
// the wave-2 packet acceptance invariants and decision-review-r1.
func denyWorkspaceNoBindingResult() KnowledgeAuthResult {
	return KnowledgeAuthResult{
		Decision:   KnowledgeAuthDenyNoBinding,
		Reason:     runtimev1.ReasonCode_KNOWLEDGE_BANK_ACCESS_DENIED,
		ActionHint: "use_an_admitted_workspace_authorization_carrier",
		Message:    "workspace private knowledge access requires explicit workspace authority",
	}
}

// denyUnknownScopeResult maps an unrecognized owner kind onto
// the protocol-envelope-invalid reason.
func denyUnknownScopeResult(kind string) KnowledgeAuthResult {
	return KnowledgeAuthResult{
		Decision:   KnowledgeAuthDenyUnknownScope,
		Reason:     runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID,
		ActionHint: "use_an_admitted_owner_kind",
		Message:    "knowledge bank owner kind " + kind + " is not admitted",
	}
}

// trimContextAppID returns the request context's app_id with
// surrounding whitespace removed. Defensive against envelope drift.
func trimContextAppID(ctx *runtimev1.KnowledgeRequestContext) string {
	if ctx == nil {
		return ""
	}
	return strings.TrimSpace(ctx.GetAppId())
}

package cognition

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// AppMemoryAuthDecision is the typed outcome of an app-memory-access
// authorize call (C-APMEM-001..005). It mirrors the KnowledgeAuthDecision
// shape: exactly one decision per call, allow or a precise deny class.
type AppMemoryAuthDecision string

const (
	AppMemoryAuthAllow                AppMemoryAuthDecision = "allow"
	AppMemoryAuthDenyNoPolicy         AppMemoryAuthDecision = "deny_no_policy"
	AppMemoryAuthDenyUnknownPolicy    AppMemoryAuthDecision = "deny_unknown_policy"
	AppMemoryAuthDenyNoActiveGrant    AppMemoryAuthDecision = "deny_no_active_grant"
	AppMemoryAuthDenyScopeAmbiguous   AppMemoryAuthDecision = "deny_scope_ambiguous"
	AppMemoryAuthDenyOrphanProjection AppMemoryAuthDecision = "deny_orphan_projection"
	AppMemoryAuthDenyCheckerUnbound   AppMemoryAuthDecision = "deny_checker_unbound"
)

// Stable deny reason tokens surfaced verbatim as the PermissionDenied
// status message by the gated handlers. These are typed contract
// strings; tests and clients match on them exactly.
const (
	apmemReasonNoPolicy            = "apmem_no_policy"
	apmemReasonUnknownPolicy       = "apmem_unknown_policy"
	apmemReasonNoActiveGrant       = "apmem_no_active_grant"
	apmemReasonScopeAmbiguous      = "apmem_scope_ambiguous"
	apmemReasonOrphanProjection    = "apmem_orphan_projection"
	apmemReasonGrantCheckerUnbound = "apmem_grant_checker_unbound"
)

// AppMemoryAuthResult carries the typed decision, the stable deny
// reason token (empty on allow), and — only on allow — the grant
// evidence the admitted operation must record (C-APMEM-005: writes land
// a Realm audit event ref taken from the grant evidence).
type AppMemoryAuthResult struct {
	Decision AppMemoryAuthDecision
	Reason   string
	Evidence AppMemoryGrantEvidence
}

func apmemAllow(evidence AppMemoryGrantEvidence) AppMemoryAuthResult {
	return AppMemoryAuthResult{Decision: AppMemoryAuthAllow, Evidence: evidence}
}

func apmemDeny(decision AppMemoryAuthDecision, reason string) AppMemoryAuthResult {
	return AppMemoryAuthResult{Decision: decision, Reason: reason}
}

// AppMemoryWriteRequest is the typed input for AuthorizeMemoryWrite
// (C-APMEM-005 memory write boundary).
type AppMemoryWriteRequest struct {
	AppID      string
	PersonaID  string
	SessionRef string
	Policy     string
}

// AppMemoryReadRequest is the typed input for AuthorizeMemoryRead
// (C-APMEM-002 admitted memory.read.* policies).
type AppMemoryReadRequest struct {
	AppID      string
	PersonaID  string
	SessionRef string
	Policy     string
}

// AppMemoryChatDerivedProjectionRequest is the typed input for
// AuthorizeChatDerivedProjection (C-APMEM-003 chat-derived projection
// rule).
type AppMemoryChatDerivedProjectionRequest struct {
	Policy                string
	ConversationAnchorRef string
	SourceAppID           string
	TargetPersonaID       string
	RealmAuditEventID     string
}

// AppMemoryAuthorizer mechanizes the C-APMEM app-memory-access policy
// surface for the cognition service (C-APMEM-001: Cognition owns the
// app access policy decision; the realm grant lifecycle — consulted
// through the AppMemoryGrantChecker seam — decides whether the scope is
// usable at all).
//
// Decision ordering is fixed: policy admission (C-APMEM-002) →
// scope/field bounds (C-APMEM-003/004/005) → grant consult (checker
// binding, active grant, evidence completeness). Structural request
// defects deny identically whether or not a checker is bound; the
// checker seam governs only the active-grant consult. Every path is a
// deny except the fully-satisfied allow (C-APMEM-004: no implicit
// allow, no silent fallback to default allow).
type AppMemoryAuthorizer struct {
	checker AppMemoryGrantChecker
}

// NewAppMemoryAuthorizer constructs the authorizer around the realm
// grant projection seam. A nil checker is admitted and means UNBOUND:
// every grant consult denies with reason apmem_grant_checker_unbound.
// This is the deliberate fail-closed posture until the realm grant
// projection wave binds a real checker — never a fake allow
// (C-APMEM-001 / C-APMEM-004).
func NewAppMemoryAuthorizer(checker AppMemoryGrantChecker) *AppMemoryAuthorizer {
	return &AppMemoryAuthorizer{checker: checker}
}

// AuthorizeMemoryWrite decides an app-scoped memory write (C-APMEM-005):
// the write must present the admitted write policy
// memory.write.session-scoped-admitted, be session-scoped (non-empty
// session ref), persona-bound (non-empty persona id), and be covered by
// an active grant whose evidence supplies the Realm audit event ref the
// write must record.
func (a *AppMemoryAuthorizer) AuthorizeMemoryWrite(ctx context.Context, req AppMemoryWriteRequest) AppMemoryAuthResult {
	policy := strings.TrimSpace(req.Policy)
	if policy == "" {
		return apmemDeny(AppMemoryAuthDenyNoPolicy, apmemReasonNoPolicy)
	}
	if !IsAdmittedAppMemoryPolicy(policy) {
		// C-APMEM-002: closed enum; open policy strings deny.
		return apmemDeny(AppMemoryAuthDenyUnknownPolicy, apmemReasonUnknownPolicy)
	}
	if policy != AppMemoryPolicyMemoryWriteSessionScopedAdmitted {
		// Admitted enum member, but not the write admission: the policy
		// required for this operation is missing (C-APMEM-004 / C-APMEM-005).
		return apmemDeny(AppMemoryAuthDenyNoPolicy, apmemReasonNoPolicy)
	}
	appID := strings.TrimSpace(req.AppID)
	personaID := strings.TrimSpace(req.PersonaID)
	sessionRef := strings.TrimSpace(req.SessionRef)
	if appID == "" || sessionRef == "" || personaID == "" {
		// C-APMEM-005: session-scoped + persona-bound are mandatory write
		// bounds; an indeterminate app/session/persona binding is scope
		// ambiguity and denies (C-APMEM-004).
		return apmemDeny(AppMemoryAuthDenyScopeAmbiguous, apmemReasonScopeAmbiguous)
	}
	return a.consultActiveGrant(ctx, appID, personaID, policy)
}

// AuthorizeMemoryRead decides an app-scoped memory read (C-APMEM-002):
// the read must present one of the two admitted memory.read.* policies
// and satisfy that policy's bound — persona-scoped reads require a
// persona id, session-scoped reads require a session ref — plus an
// active grant.
func (a *AppMemoryAuthorizer) AuthorizeMemoryRead(ctx context.Context, req AppMemoryReadRequest) AppMemoryAuthResult {
	policy := strings.TrimSpace(req.Policy)
	if policy == "" {
		return apmemDeny(AppMemoryAuthDenyNoPolicy, apmemReasonNoPolicy)
	}
	if !IsAdmittedAppMemoryPolicy(policy) {
		return apmemDeny(AppMemoryAuthDenyUnknownPolicy, apmemReasonUnknownPolicy)
	}
	if policy != AppMemoryPolicyMemoryReadPersonaScopedBounded && policy != AppMemoryPolicyMemoryReadSessionScopedBounded {
		// Admitted enum member, but not a read admission (C-APMEM-004).
		return apmemDeny(AppMemoryAuthDenyNoPolicy, apmemReasonNoPolicy)
	}
	appID := strings.TrimSpace(req.AppID)
	if appID == "" {
		return apmemDeny(AppMemoryAuthDenyScopeAmbiguous, apmemReasonScopeAmbiguous)
	}
	personaID := strings.TrimSpace(req.PersonaID)
	sessionRef := strings.TrimSpace(req.SessionRef)
	switch policy {
	case AppMemoryPolicyMemoryReadPersonaScopedBounded:
		if personaID == "" {
			// Persona-scoped bound without a persona binding is ambiguous
			// scope → deny (C-APMEM-002 / C-APMEM-004).
			return apmemDeny(AppMemoryAuthDenyScopeAmbiguous, apmemReasonScopeAmbiguous)
		}
	case AppMemoryPolicyMemoryReadSessionScopedBounded:
		if sessionRef == "" {
			// Session-scoped bound without a session binding is ambiguous
			// scope → deny (C-APMEM-002 / C-APMEM-004).
			return apmemDeny(AppMemoryAuthDenyScopeAmbiguous, apmemReasonScopeAmbiguous)
		}
	}
	return a.consultActiveGrant(ctx, appID, personaID, policy)
}

// AuthorizeChatDerivedProjection decides a chat-transcript → memory
// projection (C-APMEM-003): the projection must present the admitted
// chat_derived.projection.admitted policy, carry ALL of conversation
// anchor ref, source app id, target persona id, and Realm audit event
// id, and be covered by an active grant. Missing any required field is
// an orphan projection and denies (C-APMEM-003 / C-APMEM-004).
//
// Invariant for the (future) projection writer: the memory record
// written under an allow MUST carry `source.anchor` and
// `source.app_id` taken from this request (C-APMEM-003); a writer that
// cannot stamp both fields must not write.
func (a *AppMemoryAuthorizer) AuthorizeChatDerivedProjection(ctx context.Context, req AppMemoryChatDerivedProjectionRequest) AppMemoryAuthResult {
	policy := strings.TrimSpace(req.Policy)
	if policy == "" {
		return apmemDeny(AppMemoryAuthDenyNoPolicy, apmemReasonNoPolicy)
	}
	if !IsAdmittedAppMemoryPolicy(policy) {
		return apmemDeny(AppMemoryAuthDenyUnknownPolicy, apmemReasonUnknownPolicy)
	}
	if policy != AppMemoryPolicyChatDerivedProjectionAdmitted {
		return apmemDeny(AppMemoryAuthDenyNoPolicy, apmemReasonNoPolicy)
	}
	anchorRef := strings.TrimSpace(req.ConversationAnchorRef)
	sourceAppID := strings.TrimSpace(req.SourceAppID)
	targetPersonaID := strings.TrimSpace(req.TargetPersonaID)
	realmAuditEventID := strings.TrimSpace(req.RealmAuditEventID)
	if anchorRef == "" || sourceAppID == "" || targetPersonaID == "" || realmAuditEventID == "" {
		return apmemDeny(AppMemoryAuthDenyOrphanProjection, apmemReasonOrphanProjection)
	}
	return a.consultActiveGrant(ctx, sourceAppID, targetPersonaID, policy)
}

// consultActiveGrant performs the realm grant consult shared by every
// decision function. Unbound checker → deny apmem_grant_checker_unbound
// (C-APMEM-001 / C-APMEM-004 fail-closed seam); no active grant → deny;
// grant evidence missing GrantRef or AuditEventID is malformed checker
// output and denies rather than producing an unauditable allow.
func (a *AppMemoryAuthorizer) consultActiveGrant(ctx context.Context, appID, personaID, policy string) AppMemoryAuthResult {
	if a == nil || a.checker == nil {
		return apmemDeny(AppMemoryAuthDenyCheckerUnbound, apmemReasonGrantCheckerUnbound)
	}
	evidence, ok := a.checker.ActiveGrant(ctx, appID, personaID, policy)
	if !ok {
		return apmemDeny(AppMemoryAuthDenyNoActiveGrant, apmemReasonNoActiveGrant)
	}
	if !evidence.complete() {
		return apmemDeny(AppMemoryAuthDenyNoActiveGrant, apmemReasonNoActiveGrant)
	}
	return apmemAllow(evidence)
}

// appMemoryWriteRequestFromWire maps the public RuntimeCognitionService
// write envelope onto the typed authorizer request. The write policy is
// operation-implied: Retain is a memory write and C-APMEM-002 admits
// exactly one write policy (memory.write.session-scoped-admitted).
//
// MemoryRequestContext carries only app_id + subject_user_id today — no
// session ref and no persona id — so the C-APMEM-005 session/persona
// bounds cannot be satisfied from the wire and the gate fails closed
// (deny apmem_scope_ambiguous). The realm grant projection wave threads
// the scope refs through this surface; nothing here may substitute
// subject_user_id or other fields for the missing bounds.
func appMemoryWriteRequestFromWire(reqCtx *runtimev1.MemoryRequestContext) AppMemoryWriteRequest {
	return AppMemoryWriteRequest{
		AppID:  strings.TrimSpace(reqCtx.GetAppId()),
		Policy: AppMemoryPolicyMemoryWriteSessionScopedAdmitted,
	}
}

// appMemoryReadRequestFromWire maps the public RuntimeCognitionService
// read envelope onto the typed authorizer request. C-APMEM-002 admits
// two read policies with different bounds (persona-scoped vs
// session-scoped); the wire carries neither a policy declaration nor
// the scope refs to derive one, so no admitted read policy is
// presentable and the gate fails closed (deny apmem_no_policy,
// C-APMEM-004: 缺少 policy → deny). The realm grant projection wave
// threads the granted policy + scope refs through this surface.
func appMemoryReadRequestFromWire(reqCtx *runtimev1.MemoryRequestContext) AppMemoryReadRequest {
	return AppMemoryReadRequest{
		AppID: strings.TrimSpace(reqCtx.GetAppId()),
	}
}

package cognition

import (
	"context"
	"strings"
)

// App memory access policy registry.
//
// `docs/authority/cognition-standalone-services-rationale.md` (C-APMEM-002)
// locks the admitted policy enum for app access to cognition memory /
// knowledge / skill surfaces. The enum is CLOSED: C-APMEM-002 forbids
// admitting open string policies — adding a policy requires amending the
// contract — so any policy string outside this set must deny
// (C-APMEM-004 no-implicit-allow). The constant values below are verbatim
// contract strings; do not paraphrase or extend them in code.
const (
	AppMemoryPolicyMemoryReadPersonaScopedBounded   = "memory.read.persona-scoped-bounded"
	AppMemoryPolicyMemoryReadSessionScopedBounded   = "memory.read.session-scoped-bounded"
	AppMemoryPolicyMemoryWriteSessionScopedAdmitted = "memory.write.session-scoped-admitted"
	AppMemoryPolicyKnowledgeReadBounded             = "knowledge.read.bounded"
	AppMemoryPolicyKnowledgeWriteAdmitted           = "knowledge.write.admitted"
	AppMemoryPolicySkillRunBounded                  = "skill.run.bounded"
	AppMemoryPolicyChatDerivedProjectionAdmitted    = "chat_derived.projection.admitted"
)

// IsAdmittedAppMemoryPolicy reports whether policy is a member of the
// closed C-APMEM-002 enum. Matching is exact; callers own envelope
// hygiene (trimming) before consulting the registry. Unknown strings
// must map to deny — there is no extension point by design.
func IsAdmittedAppMemoryPolicy(policy string) bool {
	switch policy {
	case AppMemoryPolicyMemoryReadPersonaScopedBounded,
		AppMemoryPolicyMemoryReadSessionScopedBounded,
		AppMemoryPolicyMemoryWriteSessionScopedAdmitted,
		AppMemoryPolicyKnowledgeReadBounded,
		AppMemoryPolicyKnowledgeWriteAdmitted,
		AppMemoryPolicySkillRunBounded,
		AppMemoryPolicyChatDerivedProjectionAdmitted:
		return true
	default:
		return false
	}
}

// AppMemoryGrantEvidence is the typed proof of an active admitted grant
// returned by the realm grant projection. GrantRef identifies the grant
// the decision is anchored to; AuditEventID is the realm audit lineage
// ref the admitted operation must record (C-APMEM-005 requires writes to
// land a Realm audit event; C-APMEM-003 requires projection requests to
// carry realm audit lineage). Evidence missing either field is not
// usable proof and the authorizer fails closed on it.
type AppMemoryGrantEvidence struct {
	GrantRef     string
	AuditEventID string
}

// complete reports whether the evidence carries both mandatory fields.
// Incomplete evidence from a checker is malformed checker output and
// must deny (no pseudo-success on a typed contract surface).
func (e AppMemoryGrantEvidence) complete() bool {
	return strings.TrimSpace(e.GrantRef) != "" && strings.TrimSpace(e.AuditEventID) != ""
}

// AppMemoryGrantChecker is the realm grant projection seam consumed by
// the AppMemoryAuthorizer (C-APMEM-001: Realm grant lifecycle decides
// whether a scope is usable; Cognition policy decides the shape of the
// admitted read / write / projection). ActiveGrant must report whether
// an active, non-revoked grant admits `policy` for `appID` (and, when
// the policy binds a persona, `personaID`), returning the grant
// evidence on success.
//
// The runtime currently has no bindable implementation: the local
// grant.Service token state carries no agent persona dimension and no
// per-grant realm audit event id, and its validation surfaces require
// the caller-held token secret, which the cognition memory wire does
// not carry. Until the realm grant projection wave binds a real
// checker, the cognition service is constructed with a nil checker and
// every grant consult denies with reason apmem_grant_checker_unbound
// (C-APMEM-004: no silent fallback to default allow).
type AppMemoryGrantChecker interface {
	ActiveGrant(ctx context.Context, appID, personaID, policy string) (AppMemoryGrantEvidence, bool)
}

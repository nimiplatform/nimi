package cognition

import (
	"context"
	"testing"
)

type fakeGrantCall struct {
	AppID     string
	PersonaID string
	Policy    string
}

// fakeAppMemoryGrantChecker is the test double for the realm grant
// projection seam. It records every consult so tests can assert the
// exact (appID, personaID, policy) dimensions the authorizer queried.
type fakeAppMemoryGrantChecker struct {
	evidence AppMemoryGrantEvidence
	ok       bool
	calls    []fakeGrantCall
}

func (f *fakeAppMemoryGrantChecker) ActiveGrant(_ context.Context, appID, personaID, policy string) (AppMemoryGrantEvidence, bool) {
	f.calls = append(f.calls, fakeGrantCall{AppID: appID, PersonaID: personaID, Policy: policy})
	return f.evidence, f.ok
}

func grantingChecker() *fakeAppMemoryGrantChecker {
	return &fakeAppMemoryGrantChecker{
		evidence: AppMemoryGrantEvidence{GrantRef: "grant-001", AuditEventID: "audit-evt-001"},
		ok:       true,
	}
}

func TestAppMemoryPolicyRegistryIsClosedSet(t *testing.T) {
	// C-APMEM-002: exactly these seven policies are admitted, verbatim.
	admitted := []string{
		"memory.read.persona-scoped-bounded",
		"memory.read.session-scoped-bounded",
		"memory.write.session-scoped-admitted",
		"knowledge.read.bounded",
		"knowledge.write.admitted",
		"skill.run.bounded",
		"chat_derived.projection.admitted",
	}
	for _, policy := range admitted {
		if !IsAdmittedAppMemoryPolicy(policy) {
			t.Fatalf("admitted policy %q rejected by registry", policy)
		}
	}
	// C-APMEM-002 MUST NOT admit open strings: near-misses, casing
	// variants, prefixes, and extensions all fall outside the closed set.
	rejected := []string{
		"",
		"memory.read",
		"memory.read.persona-scoped-bounded ",
		"MEMORY.READ.PERSONA-SCOPED-BOUNDED",
		"memory.read.persona-scoped",
		"memory.write.admitted",
		"knowledge.read.bounded.extra",
		"chat_derived.projection",
		"skill.run.unbounded",
	}
	for _, policy := range rejected {
		if IsAdmittedAppMemoryPolicy(policy) {
			t.Fatalf("non-admitted policy %q accepted by registry", policy)
		}
	}
}

func validWriteRequest() AppMemoryWriteRequest {
	return AppMemoryWriteRequest{
		AppID:      "app-1",
		PersonaID:  "persona-1",
		SessionRef: "session-1",
		Policy:     AppMemoryPolicyMemoryWriteSessionScopedAdmitted,
	}
}

func TestAuthorizeMemoryWriteDenyMatrix(t *testing.T) {
	ctx := context.Background()
	cases := []struct {
		name    string
		mutate  func(*AppMemoryWriteRequest)
		checker AppMemoryGrantChecker
		want    AppMemoryAuthDecision
		reason  string
	}{
		{
			name:    "empty policy",
			mutate:  func(r *AppMemoryWriteRequest) { r.Policy = "" },
			checker: grantingChecker(),
			want:    AppMemoryAuthDenyNoPolicy,
			reason:  "apmem_no_policy",
		},
		{
			name:    "unknown policy",
			mutate:  func(r *AppMemoryWriteRequest) { r.Policy = "memory.write.everything" },
			checker: grantingChecker(),
			want:    AppMemoryAuthDenyUnknownPolicy,
			reason:  "apmem_unknown_policy",
		},
		{
			name:    "admitted but not the write policy",
			mutate:  func(r *AppMemoryWriteRequest) { r.Policy = AppMemoryPolicyMemoryReadPersonaScopedBounded },
			checker: grantingChecker(),
			want:    AppMemoryAuthDenyNoPolicy,
			reason:  "apmem_no_policy",
		},
		{
			name:    "missing app id",
			mutate:  func(r *AppMemoryWriteRequest) { r.AppID = " " },
			checker: grantingChecker(),
			want:    AppMemoryAuthDenyScopeAmbiguous,
			reason:  "apmem_scope_ambiguous",
		},
		{
			name:    "missing session ref",
			mutate:  func(r *AppMemoryWriteRequest) { r.SessionRef = "" },
			checker: grantingChecker(),
			want:    AppMemoryAuthDenyScopeAmbiguous,
			reason:  "apmem_scope_ambiguous",
		},
		{
			name:    "missing persona id",
			mutate:  func(r *AppMemoryWriteRequest) { r.PersonaID = "" },
			checker: grantingChecker(),
			want:    AppMemoryAuthDenyScopeAmbiguous,
			reason:  "apmem_scope_ambiguous",
		},
		{
			name:    "checker unbound",
			mutate:  func(*AppMemoryWriteRequest) {},
			checker: nil,
			want:    AppMemoryAuthDenyCheckerUnbound,
			reason:  "apmem_grant_checker_unbound",
		},
		{
			name:    "no active grant",
			mutate:  func(*AppMemoryWriteRequest) {},
			checker: &fakeAppMemoryGrantChecker{ok: false},
			want:    AppMemoryAuthDenyNoActiveGrant,
			reason:  "apmem_no_active_grant",
		},
		{
			name:   "grant evidence missing grant ref",
			mutate: func(*AppMemoryWriteRequest) {},
			checker: &fakeAppMemoryGrantChecker{
				evidence: AppMemoryGrantEvidence{AuditEventID: "audit-evt-001"},
				ok:       true,
			},
			want:   AppMemoryAuthDenyNoActiveGrant,
			reason: "apmem_no_active_grant",
		},
		{
			name:   "grant evidence missing audit event id",
			mutate: func(*AppMemoryWriteRequest) {},
			checker: &fakeAppMemoryGrantChecker{
				evidence: AppMemoryGrantEvidence{GrantRef: "grant-001"},
				ok:       true,
			},
			want:   AppMemoryAuthDenyNoActiveGrant,
			reason: "apmem_no_active_grant",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := validWriteRequest()
			tc.mutate(&req)
			result := NewAppMemoryAuthorizer(tc.checker).AuthorizeMemoryWrite(ctx, req)
			if result.Decision != tc.want {
				t.Fatalf("decision mismatch: got=%s want=%s", result.Decision, tc.want)
			}
			if result.Reason != tc.reason {
				t.Fatalf("reason mismatch: got=%q want=%q", result.Reason, tc.reason)
			}
			if result.Evidence != (AppMemoryGrantEvidence{}) {
				t.Fatalf("deny must not leak grant evidence: %+v", result.Evidence)
			}
		})
	}
}

func TestAuthorizeMemoryWriteAllowCarriesGrantEvidence(t *testing.T) {
	checker := grantingChecker()
	result := NewAppMemoryAuthorizer(checker).AuthorizeMemoryWrite(context.Background(), validWriteRequest())
	if result.Decision != AppMemoryAuthAllow {
		t.Fatalf("expected allow, got %s (%s)", result.Decision, result.Reason)
	}
	// C-APMEM-005: the write must record the Realm audit event ref taken
	// from the grant evidence.
	if result.Evidence.GrantRef != "grant-001" || result.Evidence.AuditEventID != "audit-evt-001" {
		t.Fatalf("allow evidence mismatch: %+v", result.Evidence)
	}
	if len(checker.calls) != 1 {
		t.Fatalf("expected exactly one grant consult, got %d", len(checker.calls))
	}
	call := checker.calls[0]
	if call.AppID != "app-1" || call.PersonaID != "persona-1" || call.Policy != AppMemoryPolicyMemoryWriteSessionScopedAdmitted {
		t.Fatalf("grant consult dimensions mismatch: %+v", call)
	}
}

func TestAuthorizeMemoryReadDecisionMatrix(t *testing.T) {
	ctx := context.Background()
	cases := []struct {
		name    string
		req     AppMemoryReadRequest
		checker AppMemoryGrantChecker
		want    AppMemoryAuthDecision
		reason  string
	}{
		{
			name: "allow persona-scoped",
			req: AppMemoryReadRequest{
				AppID:     "app-1",
				PersonaID: "persona-1",
				Policy:    AppMemoryPolicyMemoryReadPersonaScopedBounded,
			},
			checker: grantingChecker(),
			want:    AppMemoryAuthAllow,
		},
		{
			name: "allow session-scoped",
			req: AppMemoryReadRequest{
				AppID:      "app-1",
				SessionRef: "session-1",
				Policy:     AppMemoryPolicyMemoryReadSessionScopedBounded,
			},
			checker: grantingChecker(),
			want:    AppMemoryAuthAllow,
		},
		{
			name: "persona-scoped without persona binding",
			req: AppMemoryReadRequest{
				AppID:      "app-1",
				SessionRef: "session-1",
				Policy:     AppMemoryPolicyMemoryReadPersonaScopedBounded,
			},
			checker: grantingChecker(),
			want:    AppMemoryAuthDenyScopeAmbiguous,
			reason:  "apmem_scope_ambiguous",
		},
		{
			name: "session-scoped without session binding",
			req: AppMemoryReadRequest{
				AppID:     "app-1",
				PersonaID: "persona-1",
				Policy:    AppMemoryPolicyMemoryReadSessionScopedBounded,
			},
			checker: grantingChecker(),
			want:    AppMemoryAuthDenyScopeAmbiguous,
			reason:  "apmem_scope_ambiguous",
		},
		{
			name: "empty policy",
			req: AppMemoryReadRequest{
				AppID:     "app-1",
				PersonaID: "persona-1",
			},
			checker: grantingChecker(),
			want:    AppMemoryAuthDenyNoPolicy,
			reason:  "apmem_no_policy",
		},
		{
			name: "unknown policy",
			req: AppMemoryReadRequest{
				AppID:     "app-1",
				PersonaID: "persona-1",
				Policy:    "memory.read.unbounded",
			},
			checker: grantingChecker(),
			want:    AppMemoryAuthDenyUnknownPolicy,
			reason:  "apmem_unknown_policy",
		},
		{
			name: "admitted but not a read policy",
			req: AppMemoryReadRequest{
				AppID:      "app-1",
				PersonaID:  "persona-1",
				SessionRef: "session-1",
				Policy:     AppMemoryPolicyMemoryWriteSessionScopedAdmitted,
			},
			checker: grantingChecker(),
			want:    AppMemoryAuthDenyNoPolicy,
			reason:  "apmem_no_policy",
		},
		{
			name: "missing app id",
			req: AppMemoryReadRequest{
				PersonaID: "persona-1",
				Policy:    AppMemoryPolicyMemoryReadPersonaScopedBounded,
			},
			checker: grantingChecker(),
			want:    AppMemoryAuthDenyScopeAmbiguous,
			reason:  "apmem_scope_ambiguous",
		},
		{
			name: "checker unbound",
			req: AppMemoryReadRequest{
				AppID:     "app-1",
				PersonaID: "persona-1",
				Policy:    AppMemoryPolicyMemoryReadPersonaScopedBounded,
			},
			checker: nil,
			want:    AppMemoryAuthDenyCheckerUnbound,
			reason:  "apmem_grant_checker_unbound",
		},
		{
			name: "no active grant",
			req: AppMemoryReadRequest{
				AppID:     "app-1",
				PersonaID: "persona-1",
				Policy:    AppMemoryPolicyMemoryReadPersonaScopedBounded,
			},
			checker: &fakeAppMemoryGrantChecker{ok: false},
			want:    AppMemoryAuthDenyNoActiveGrant,
			reason:  "apmem_no_active_grant",
		},
		{
			name: "incomplete grant evidence",
			req: AppMemoryReadRequest{
				AppID:      "app-1",
				SessionRef: "session-1",
				Policy:     AppMemoryPolicyMemoryReadSessionScopedBounded,
			},
			checker: &fakeAppMemoryGrantChecker{
				evidence: AppMemoryGrantEvidence{GrantRef: "grant-001"},
				ok:       true,
			},
			want:   AppMemoryAuthDenyNoActiveGrant,
			reason: "apmem_no_active_grant",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			result := NewAppMemoryAuthorizer(tc.checker).AuthorizeMemoryRead(ctx, tc.req)
			if result.Decision != tc.want {
				t.Fatalf("decision mismatch: got=%s want=%s", result.Decision, tc.want)
			}
			if result.Reason != tc.reason {
				t.Fatalf("reason mismatch: got=%q want=%q", result.Reason, tc.reason)
			}
			if tc.want == AppMemoryAuthAllow && !result.Evidence.complete() {
				t.Fatalf("allow must carry complete grant evidence: %+v", result.Evidence)
			}
		})
	}
}

func validChatDerivedRequest() AppMemoryChatDerivedProjectionRequest {
	return AppMemoryChatDerivedProjectionRequest{
		Policy:                AppMemoryPolicyChatDerivedProjectionAdmitted,
		ConversationAnchorRef: "anchor-1",
		SourceAppID:           "app-chat",
		TargetPersonaID:       "persona-1",
		RealmAuditEventID:     "realm-audit-1",
	}
}

func TestAuthorizeChatDerivedProjectionRequiresEveryField(t *testing.T) {
	ctx := context.Background()
	// C-APMEM-003: the projection request must carry ALL of conversation
	// anchor ref, source app id, target persona id, and realm audit event
	// id. Drop each field one at a time → deny_orphan_projection.
	drops := []struct {
		name   string
		mutate func(*AppMemoryChatDerivedProjectionRequest)
	}{
		{"missing conversation anchor", func(r *AppMemoryChatDerivedProjectionRequest) { r.ConversationAnchorRef = "" }},
		{"missing source app id", func(r *AppMemoryChatDerivedProjectionRequest) { r.SourceAppID = " " }},
		{"missing target persona id", func(r *AppMemoryChatDerivedProjectionRequest) { r.TargetPersonaID = "" }},
		{"missing realm audit event id", func(r *AppMemoryChatDerivedProjectionRequest) { r.RealmAuditEventID = "" }},
	}
	for _, tc := range drops {
		t.Run(tc.name, func(t *testing.T) {
			checker := grantingChecker()
			req := validChatDerivedRequest()
			tc.mutate(&req)
			result := NewAppMemoryAuthorizer(checker).AuthorizeChatDerivedProjection(ctx, req)
			if result.Decision != AppMemoryAuthDenyOrphanProjection {
				t.Fatalf("decision mismatch: got=%s want=%s", result.Decision, AppMemoryAuthDenyOrphanProjection)
			}
			if result.Reason != "apmem_orphan_projection" {
				t.Fatalf("reason mismatch: got=%q", result.Reason)
			}
			if len(checker.calls) != 0 {
				t.Fatalf("orphan projection must not consult the grant checker, got %d calls", len(checker.calls))
			}
		})
	}
}

func TestAuthorizeChatDerivedProjectionPolicyAndGrantMatrix(t *testing.T) {
	ctx := context.Background()
	cases := []struct {
		name    string
		mutate  func(*AppMemoryChatDerivedProjectionRequest)
		checker AppMemoryGrantChecker
		want    AppMemoryAuthDecision
		reason  string
	}{
		{
			name:    "empty policy",
			mutate:  func(r *AppMemoryChatDerivedProjectionRequest) { r.Policy = "" },
			checker: grantingChecker(),
			want:    AppMemoryAuthDenyNoPolicy,
			reason:  "apmem_no_policy",
		},
		{
			name:    "unknown policy",
			mutate:  func(r *AppMemoryChatDerivedProjectionRequest) { r.Policy = "chat_derived.projection.open" },
			checker: grantingChecker(),
			want:    AppMemoryAuthDenyUnknownPolicy,
			reason:  "apmem_unknown_policy",
		},
		{
			name:    "admitted but not the projection policy",
			mutate:  func(r *AppMemoryChatDerivedProjectionRequest) { r.Policy = AppMemoryPolicyKnowledgeWriteAdmitted },
			checker: grantingChecker(),
			want:    AppMemoryAuthDenyNoPolicy,
			reason:  "apmem_no_policy",
		},
		{
			name:    "checker unbound",
			mutate:  func(*AppMemoryChatDerivedProjectionRequest) {},
			checker: nil,
			want:    AppMemoryAuthDenyCheckerUnbound,
			reason:  "apmem_grant_checker_unbound",
		},
		{
			name:    "no active grant",
			mutate:  func(*AppMemoryChatDerivedProjectionRequest) {},
			checker: &fakeAppMemoryGrantChecker{ok: false},
			want:    AppMemoryAuthDenyNoActiveGrant,
			reason:  "apmem_no_active_grant",
		},
		{
			name:   "incomplete grant evidence",
			mutate: func(*AppMemoryChatDerivedProjectionRequest) {},
			checker: &fakeAppMemoryGrantChecker{
				evidence: AppMemoryGrantEvidence{AuditEventID: "audit-evt-001"},
				ok:       true,
			},
			want:   AppMemoryAuthDenyNoActiveGrant,
			reason: "apmem_no_active_grant",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := validChatDerivedRequest()
			tc.mutate(&req)
			result := NewAppMemoryAuthorizer(tc.checker).AuthorizeChatDerivedProjection(ctx, req)
			if result.Decision != tc.want {
				t.Fatalf("decision mismatch: got=%s want=%s", result.Decision, tc.want)
			}
			if result.Reason != tc.reason {
				t.Fatalf("reason mismatch: got=%q want=%q", result.Reason, tc.reason)
			}
		})
	}
}

func TestAuthorizeChatDerivedProjectionAllowConsultsSourceAppAndTargetPersona(t *testing.T) {
	checker := grantingChecker()
	result := NewAppMemoryAuthorizer(checker).AuthorizeChatDerivedProjection(context.Background(), validChatDerivedRequest())
	if result.Decision != AppMemoryAuthAllow {
		t.Fatalf("expected allow, got %s (%s)", result.Decision, result.Reason)
	}
	if !result.Evidence.complete() {
		t.Fatalf("allow must carry complete grant evidence: %+v", result.Evidence)
	}
	if len(checker.calls) != 1 {
		t.Fatalf("expected exactly one grant consult, got %d", len(checker.calls))
	}
	call := checker.calls[0]
	if call.AppID != "app-chat" || call.PersonaID != "persona-1" || call.Policy != AppMemoryPolicyChatDerivedProjectionAdmitted {
		t.Fatalf("grant consult dimensions mismatch: %+v", call)
	}
}

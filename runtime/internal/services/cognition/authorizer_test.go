package cognition

import (
	"context"
	"testing"

	cognitionpkg "github.com/nimiplatform/nimi/nimi-cognition/cognition"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// S2.18 — Authorizer table test. Each KnowledgeAction is exercised
// against APP_PRIVATE (allow on app match, deny on mismatch),
// WORKSPACE_PRIVATE (always deny), and unknown owner kind. Verifies
// the action_hint for WORKSPACE_PRIVATE is the canonical
// use_an_admitted_workspace_authorization_carrier value.
func TestAccountKnowledgeAuthorizerTable(t *testing.T) {
	authz := NewAccountKnowledgeAuthorizer(nil)
	ctx := context.Background()
	actions := []KnowledgeAction{
		KnowledgeActionCreateBank,
		KnowledgeActionReadBank,
		KnowledgeActionDeleteBank,
		KnowledgeActionWritePage,
		KnowledgeActionReadPage,
		KnowledgeActionDeletePage,
		KnowledgeActionSearch,
		KnowledgeActionWriteLink,
		KnowledgeActionReadLink,
		KnowledgeActionIngest,
	}

	for _, action := range actions {
		// APP_PRIVATE allow.
		res, err := authz.Authorize(ctx, KnowledgeAuthRequest{
			Action:  action,
			Context: &runtimev1.KnowledgeRequestContext{AppId: "app.x"},
			Owner:   cognitionpkg.KnowledgeScopeOwner{Kind: cognitionpkg.KnowledgeScopeOwnerKindAppPrivate, AppID: "app.x"},
		})
		if err != nil {
			t.Fatalf("%s app allow: err %v", action, err)
		}
		if res.Decision != KnowledgeAuthAllow {
			t.Fatalf("%s app allow: got decision %s", action, res.Decision)
		}

		// APP_PRIVATE mismatch.
		res, err = authz.Authorize(ctx, KnowledgeAuthRequest{
			Action:  action,
			Context: &runtimev1.KnowledgeRequestContext{AppId: "app.intruder"},
			Owner:   cognitionpkg.KnowledgeScopeOwner{Kind: cognitionpkg.KnowledgeScopeOwnerKindAppPrivate, AppID: "app.x"},
		})
		if err != nil {
			t.Fatalf("%s app mismatch: err %v", action, err)
		}
		if res.Decision != KnowledgeAuthDenyOwnerMismatch {
			t.Fatalf("%s app mismatch: expected deny_owner_mismatch, got %s", action, res.Decision)
		}
		if res.Reason != runtimev1.ReasonCode_KNOWLEDGE_BANK_ACCESS_DENIED {
			t.Fatalf("%s app mismatch: expected KNOWLEDGE_BANK_ACCESS_DENIED reason, got %v", action, res.Reason)
		}

		// WORKSPACE_PRIVATE always deny + canonical action_hint.
		res, err = authz.Authorize(ctx, KnowledgeAuthRequest{
			Action:  action,
			Context: &runtimev1.KnowledgeRequestContext{AppId: "app.any"},
			Owner:   cognitionpkg.KnowledgeScopeOwner{Kind: cognitionpkg.KnowledgeScopeOwnerKindWorkspace, WorkspaceID: "ws.any"},
		})
		if err != nil {
			t.Fatalf("%s workspace deny: err %v", action, err)
		}
		if res.Decision != KnowledgeAuthDenyNoBinding {
			t.Fatalf("%s workspace deny: expected deny_no_binding, got %s", action, res.Decision)
		}
		if res.Reason != runtimev1.ReasonCode_KNOWLEDGE_BANK_ACCESS_DENIED {
			t.Fatalf("%s workspace deny: expected KNOWLEDGE_BANK_ACCESS_DENIED reason, got %v", action, res.Reason)
		}
		if res.ActionHint != "use_an_admitted_workspace_authorization_carrier" {
			t.Fatalf("%s workspace deny: expected canonical action_hint, got %q", action, res.ActionHint)
		}

		// Unknown owner kind.
		res, err = authz.Authorize(ctx, KnowledgeAuthRequest{
			Action:  action,
			Context: &runtimev1.KnowledgeRequestContext{AppId: "app.any"},
			Owner:   cognitionpkg.KnowledgeScopeOwner{Kind: "agent_core", AppID: "anything"},
		})
		if err != nil {
			t.Fatalf("%s unknown kind: err %v", action, err)
		}
		if res.Decision != KnowledgeAuthDenyUnknownScope {
			t.Fatalf("%s unknown kind: expected deny_unknown_scope, got %s", action, res.Decision)
		}
		if res.Reason != runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID {
			t.Fatalf("%s unknown kind: expected PROTOCOL_ENVELOPE_INVALID reason, got %v", action, res.Reason)
		}
	}

	// subject_user_id does not influence the decision.
	res1, _ := authz.Authorize(ctx, KnowledgeAuthRequest{
		Action:  KnowledgeActionReadBank,
		Context: &runtimev1.KnowledgeRequestContext{AppId: "app.x", SubjectUserId: "user-1"},
		Owner:   cognitionpkg.KnowledgeScopeOwner{Kind: cognitionpkg.KnowledgeScopeOwnerKindAppPrivate, AppID: "app.x"},
	})
	res2, _ := authz.Authorize(ctx, KnowledgeAuthRequest{
		Action:  KnowledgeActionReadBank,
		Context: &runtimev1.KnowledgeRequestContext{AppId: "app.x", SubjectUserId: "user-2"},
		Owner:   cognitionpkg.KnowledgeScopeOwner{Kind: cognitionpkg.KnowledgeScopeOwnerKindAppPrivate, AppID: "app.x"},
	})
	if res1.Decision != res2.Decision {
		t.Fatalf("subject_user_id changed decision: %s vs %s", res1.Decision, res2.Decision)
	}
}

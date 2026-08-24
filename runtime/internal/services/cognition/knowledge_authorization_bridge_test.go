package cognition

import (
	"context"
	"testing"
	"time"

	cognitionpkg "github.com/nimiplatform/nimi/nimi-cognition/cognition"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type mismatchedKnowledgeActionAuthorizer struct{}

func (mismatchedKnowledgeActionAuthorizer) Authorize(context.Context, KnowledgeAuthRequest) (KnowledgeAuthResult, error) {
	return bindKnowledgeAuthIdentity(KnowledgeActionReadBank, cognitionpkg.RuntimeBridgeOperationLoadKnowledge, allowedAuthResult()), nil
}

type mismatchedKnowledgeOperationAuthorizer struct{}

func (mismatchedKnowledgeOperationAuthorizer) Authorize(_ context.Context, req KnowledgeAuthRequest) (KnowledgeAuthResult, error) {
	return bindKnowledgeAuthIdentity(req.Action, cognitionpkg.RuntimeBridgeOperationListKnowledge, allowedAuthResult()), nil
}

type recordingKnowledgeAuthorizer struct {
	requests []KnowledgeAuthRequest
}

func (a *recordingKnowledgeAuthorizer) Authorize(_ context.Context, req KnowledgeAuthRequest) (KnowledgeAuthResult, error) {
	a.requests = append(a.requests, req)
	return bindKnowledgeAuthIdentity(req.Action, req.Operation, allowedAuthResult()), nil
}

func TestKnowledgeAuthorizationCarriesExactDecisionActionOperationAndFreshness(t *testing.T) {
	svc, _, cleanup := newTestService(t)
	defer cleanup()

	ctx := testKnowledgeEnvelopeContext("app.authorization")
	requestCtx := &runtimev1.KnowledgeRequestContext{AppId: "app.authorization"}
	owner := cognitionpkg.KnowledgeScopeOwner{
		Kind:  cognitionpkg.KnowledgeScopeOwnerKindAppPrivate,
		AppID: "app.authorization",
	}
	decision, err := svc.authorize(ctx, KnowledgeActionReadPage, cognitionpkg.RuntimeBridgeOperationLoadKnowledge, requestCtx, owner)
	if err != nil {
		t.Fatalf("authorize: %v", err)
	}
	if decision.Decision != KnowledgeAuthAllow ||
		decision.Action != KnowledgeActionReadPage ||
		decision.Operation != cognitionpkg.RuntimeBridgeOperationLoadKnowledge {
		t.Fatalf("decision identity = %+v", decision)
	}
	if decision.EvaluatedAt.IsZero() || !decision.ExpiresAt.After(decision.EvaluatedAt) || decision.ExpiresAt.Sub(decision.EvaluatedAt) > knowledgeAuthorizationDecisionTTL {
		t.Fatalf("decision freshness = evaluated %v expires %v", decision.EvaluatedAt, decision.ExpiresAt)
	}

	access := runtimeAuthorizationFromDecision(
		ctx,
		decision,
		requestCtx,
		cognitionpkg.KnowledgeScope{ScopeID: "scope-1", Owner: owner},
	)
	if access.Decision != cognitionpkg.RuntimeAuthorizationDecisionAllow ||
		access.Action != cognitionpkg.RuntimeAuthorizationActionReadPage ||
		access.Operation != cognitionpkg.RuntimeBridgeOperationLoadKnowledge ||
		!access.EvaluatedAt.Equal(decision.EvaluatedAt) ||
		!access.ExpiresAt.Equal(decision.ExpiresAt) {
		t.Fatalf("runtime bridge authorization = %+v", access)
	}

	expiredContext := authn.WithIdentity(ctx, &authn.Identity{
		SubjectUserID: "acct-1",
		ExpiresAt:     time.Now().UTC().Add(-time.Second),
	})
	if _, err := svc.authorize(expiredContext, KnowledgeActionReadPage, cognitionpkg.RuntimeBridgeOperationLoadKnowledge, requestCtx, owner); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("expired identity authorization = %v", err)
	}

	svc.authorizer = mismatchedKnowledgeActionAuthorizer{}
	if _, err := svc.authorize(ctx, KnowledgeActionReadPage, cognitionpkg.RuntimeBridgeOperationLoadKnowledge, requestCtx, owner); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("mismatched action authorization = %v", err)
	}

	svc.authorizer = mismatchedKnowledgeOperationAuthorizer{}
	if _, err := svc.authorize(ctx, KnowledgeActionReadPage, cognitionpkg.RuntimeBridgeOperationLoadKnowledge, requestCtx, owner); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("mismatched operation authorization = %v", err)
	}

	if _, err := svc.authorize(ctx, KnowledgeActionReadPage, "", requestCtx, owner); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("missing operation authorization = %v", err)
	}
}

func TestPutPageAuthorizesEachRuntimeBridgeOperationIndependently(t *testing.T) {
	svc, _, cleanup := newTestService(t)
	defer cleanup()

	recorder := &recordingKnowledgeAuthorizer{}
	svc.authorizer = recorder
	ctx := testKnowledgeEnvelopeContext("app.composite")
	requestCtx := &runtimev1.KnowledgeRequestContext{AppId: "app.composite"}
	created, err := svc.CreateKnowledgeBank(ctx, &runtimev1.CreateKnowledgeBankRequest{
		Context: requestCtx,
		Locator: &runtimev1.PublicKnowledgeBankLocator{
			Locator: &runtimev1.PublicKnowledgeBankLocator_AppPrivate{
				AppPrivate: &runtimev1.KnowledgeAppPrivateOwner{AppId: "app.composite"},
			},
		},
		DisplayName: "Composite",
	})
	if err != nil {
		t.Fatalf("CreateKnowledgeBank: %v", err)
	}
	recorder.requests = nil

	if _, err := svc.PutPage(ctx, &runtimev1.PutPageRequest{
		Context: requestCtx,
		BankId:  created.GetBank().GetBankId(),
		Slug:    "page",
		Title:   "Page",
		Content: "content",
	}); err != nil {
		t.Fatalf("PutPage: %v", err)
	}

	operations := make([]cognitionpkg.RuntimeBridgeOperation, 0, len(recorder.requests))
	for _, request := range recorder.requests {
		if request.Action != KnowledgeActionWritePage {
			t.Fatalf("PutPage authorization action = %q", request.Action)
		}
		operations = append(operations, request.Operation)
	}
	want := []cognitionpkg.RuntimeBridgeOperation{
		cognitionpkg.RuntimeBridgeOperationGetKnowledgeScope,
		cognitionpkg.RuntimeBridgeOperationListKnowledge,
		cognitionpkg.RuntimeBridgeOperationSaveKnowledge,
	}
	if len(operations) != len(want) {
		t.Fatalf("PutPage authorization operations = %v, want %v", operations, want)
	}
	for index := range want {
		if operations[index] != want[index] {
			t.Fatalf("PutPage authorization operations = %v, want %v", operations, want)
		}
	}
}

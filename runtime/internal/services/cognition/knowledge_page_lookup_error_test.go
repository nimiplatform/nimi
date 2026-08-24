package cognition

import (
	"context"
	"errors"
	"testing"

	cognitionpkg "github.com/nimiplatform/nimi/nimi-cognition/cognition"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type failLoadKnowledgeAuthorizer struct {
	err error
}

func (a failLoadKnowledgeAuthorizer) Authorize(_ context.Context, req KnowledgeAuthRequest) (KnowledgeAuthResult, error) {
	if req.Operation == cognitionpkg.RuntimeBridgeOperationLoadKnowledge {
		return KnowledgeAuthResult{}, a.err
	}
	return bindKnowledgeAuthIdentity(req.Action, req.Operation, allowedAuthResult()), nil
}

func appPrivateKnowledgeScope(bankID, appID string) cognitionpkg.KnowledgeScope {
	return cognitionpkg.KnowledgeScope{
		ScopeID: bankID,
		Owner: cognitionpkg.KnowledgeScopeOwner{
			Kind:  cognitionpkg.KnowledgeScopeOwnerKindAppPrivate,
			AppID: appID,
		},
	}
}

func assertKnowledgeLookupError(t *testing.T, err error, code codes.Code, reason runtimev1.ReasonCode) {
	t.Helper()
	if status.Code(err) != code {
		t.Fatalf("lookup status = %v, want %v: %v", status.Code(err), code, err)
	}
	actual, ok := grpcerr.ExtractReasonCode(err)
	if !ok || actual != reason {
		t.Fatalf("lookup reason = %v, %t, want %v", actual, ok, reason)
	}
}

func TestResolveKnowledgePageDistinguishesPageScopeAuthorizationAndStorageFailures(t *testing.T) {
	svc, _, cleanup := newTestService(t)
	defer cleanup()
	appID := "app.lookup-errors"
	ctx := testKnowledgeEnvelopeContext(appID)
	requestCtx := &runtimev1.KnowledgeRequestContext{AppId: appID}
	bankID := newAppPrivateBank(t, svc, appID, "Lookup Errors")
	scope := appPrivateKnowledgeScope(bankID, appID)

	page, err := svc.resolveKnowledgePage(ctx, KnowledgeActionReadPage, requestCtx, scope, bankID, "missing-page", "")
	if err != nil || page != nil {
		t.Fatalf("typed page-not-found = page:%+v err:%v", page, err)
	}

	_, err = svc.resolveKnowledgePage(
		ctx,
		KnowledgeActionReadPage,
		requestCtx,
		appPrivateKnowledgeScope("missing-bank", appID),
		"missing-bank",
		"missing-page",
		"",
	)
	assertKnowledgeLookupError(t, err, codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_BANK_NOT_FOUND)

	svc.authorizer = permitAllKnowledgeAuthorizer{}
	mismatched := scope
	mismatched.Owner.AppID = "app.other"
	_, err = svc.resolveKnowledgePage(ctx, KnowledgeActionReadPage, requestCtx, mismatched, bankID, "missing-page", "")
	assertKnowledgeLookupError(t, err, codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)

	if err := svc.cognitionCore.Close(); err != nil {
		t.Fatalf("close cognition core: %v", err)
	}
	_, err = svc.resolveKnowledgePage(ctx, KnowledgeActionReadPage, requestCtx, scope, bankID, "missing-page", "")
	assertKnowledgeLookupError(t, err, codes.Internal, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE)
	if errors.Unwrap(err) == nil {
		t.Fatalf("storage lookup failure lost its typed cause: %v", err)
	}
}

func TestPutPageStopsWhenExistingPageLookupFails(t *testing.T) {
	svc, _, cleanup := newTestService(t)
	defer cleanup()
	appID := "app.lookup-write-stop"
	ctx := testKnowledgeEnvelopeContext(appID)
	requestCtx := &runtimev1.KnowledgeRequestContext{AppId: appID}
	bankID := newAppPrivateBank(t, svc, appID, "Lookup Write Stop")
	failure := errors.New("load adapter unavailable")
	svc.authorizer = failLoadKnowledgeAuthorizer{err: failure}

	_, err := svc.PutPage(ctx, &runtimev1.PutPageRequest{
		Context: requestCtx,
		BankId:  bankID,
		PageId:  "page-must-not-be-written",
		Slug:    "must-not-write",
		Title:   "Must not write",
		Content: "lookup failed before save",
	})
	assertKnowledgeLookupError(t, err, codes.Internal, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE)
	if !errors.Is(err, failure) {
		t.Fatalf("PutPage lookup failure lost adapter cause: %v", err)
	}

	svc.authorizer = permitAllKnowledgeAuthorizer{}
	_, err = svc.GetPage(ctx, &runtimev1.GetPageRequest{
		Context: requestCtx,
		BankId:  bankID,
		Lookup:  &runtimev1.GetPageRequest_PageId{PageId: "page-must-not-be-written"},
	})
	assertKnowledgeLookupError(t, err, codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_PAGE_NOT_FOUND)
}

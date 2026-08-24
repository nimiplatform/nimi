package cognition

import (
	"context"
	"errors"
	"testing"
	"time"

	cognitionpkg "github.com/nimiplatform/nimi/nimi-cognition/cognition"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestCognitionBridgeErrorMapsExpiredAuthorizationBeforeFallback(t *testing.T) {
	svc, _, cleanup := newTestService(t)
	defer cleanup()
	owner := cognitionpkg.KnowledgeScopeOwner{Kind: cognitionpkg.KnowledgeScopeOwnerKindAppPrivate, AppID: "app.bridge-error"}
	_, _, cause := svc.cognitionCore.RuntimeBridge().ListKnowledgeScopes(context.Background(), cognitionpkg.RuntimeAuthorization{
		Decision:    cognitionpkg.RuntimeAuthorizationDecisionAllow,
		Action:      cognitionpkg.RuntimeAuthorizationActionReadBank,
		Operation:   cognitionpkg.RuntimeBridgeOperationListKnowledgeScopes,
		AccountID:   "account-1",
		AppID:       owner.AppID,
		Owner:       owner,
		EvaluatedAt: time.Now().UTC().Add(-2 * time.Minute),
		ExpiresAt:   time.Now().UTC().Add(-time.Minute),
	}, cognitionpkg.KnowledgeScopeFilter{
		OwnerKinds: []string{owner.Kind},
		Owners:     []cognitionpkg.KnowledgeScopeOwner{owner},
		PageSize:   1,
	})
	if !cognitionpkg.IsRuntimeAuthorizationDenied(cause) {
		t.Fatalf("bridge cause = %v, want authorization denied", cause)
	}
	mapped := cognitionBridgeError(cause, codes.Internal, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE, grpcerr.ReasonOptions{Message: "fallback"})
	if status.Code(mapped) != codes.PermissionDenied {
		t.Fatalf("mapped code = %v, want PermissionDenied", status.Code(mapped))
	}
	if reason, ok := grpcerr.ExtractReasonCode(mapped); !ok || reason != runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED {
		t.Fatalf("mapped reason = %v, %t", reason, ok)
	}
}

func TestKnowledgeIngestTaskLookupErrorDistinguishesNotFoundFromStorageFailure(t *testing.T) {
	notFound := knowledgeIngestTaskLookupError(cognitionpkg.ErrKnowledgeIngestTaskNotFound)
	if status.Code(notFound) != codes.NotFound {
		t.Fatalf("not-found code = %v, want NotFound", status.Code(notFound))
	}
	if reason, ok := grpcerr.ExtractReasonCode(notFound); !ok || reason != runtimev1.ReasonCode_KNOWLEDGE_INGEST_TASK_NOT_FOUND {
		t.Fatalf("not-found reason = %v, %t", reason, ok)
	}

	storageCause := errors.New("cognition storage unavailable")
	storageFailure := knowledgeIngestTaskLookupError(storageCause)
	if !errors.Is(storageFailure, storageCause) {
		t.Fatalf("storage failure lost cause: %v", storageFailure)
	}
	if status.Code(storageFailure) != codes.Internal {
		t.Fatalf("storage failure code = %v, want Internal", status.Code(storageFailure))
	}
	if reason, ok := grpcerr.ExtractReasonCode(storageFailure); !ok || reason != runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE {
		t.Fatalf("storage failure reason = %v, %t", reason, ok)
	}
}

func TestCognitionBridgeErrorPreservesPaginationCategory(t *testing.T) {
	svc, _, cleanup := newTestService(t)
	defer cleanup()
	owner := cognitionpkg.KnowledgeScopeOwner{Kind: cognitionpkg.KnowledgeScopeOwnerKindAppPrivate, AppID: "app.bridge-pagination"}
	now := time.Now().UTC()
	_, _, cause := svc.cognitionCore.RuntimeBridge().ListKnowledgeScopes(context.Background(), cognitionpkg.RuntimeAuthorization{
		Decision:    cognitionpkg.RuntimeAuthorizationDecisionAllow,
		Action:      cognitionpkg.RuntimeAuthorizationActionReadBank,
		Operation:   cognitionpkg.RuntimeBridgeOperationListKnowledgeScopes,
		AccountID:   "account-1",
		AppID:       owner.AppID,
		Owner:       owner,
		EvaluatedAt: now.Add(-time.Second),
		ExpiresAt:   now.Add(time.Minute),
	}, cognitionpkg.KnowledgeScopeFilter{
		OwnerKinds: []string{owner.Kind},
		Owners:     []cognitionpkg.KnowledgeScopeOwner{owner},
		PageSize:   101,
	})
	mapped := cognitionBridgeError(cause, codes.Internal, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE, grpcerr.ReasonOptions{Message: "fallback"})
	if status.Code(mapped) != codes.InvalidArgument {
		t.Fatalf("mapped code = %v, want InvalidArgument", status.Code(mapped))
	}
	if reason, ok := grpcerr.ExtractReasonCode(mapped); !ok || reason != runtimev1.ReasonCode_PAGE_TOKEN_INVALID {
		t.Fatalf("mapped reason = %v, %t", reason, ok)
	}
}

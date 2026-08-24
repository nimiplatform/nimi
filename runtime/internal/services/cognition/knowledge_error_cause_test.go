package cognition

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	cognitionpkg "github.com/nimiplatform/nimi/nimi-cognition/cognition"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type failingKnowledgeAuthorizer struct {
	err error
}

func (a failingKnowledgeAuthorizer) Authorize(context.Context, KnowledgeAuthRequest) (KnowledgeAuthResult, error) {
	return KnowledgeAuthResult{}, a.err
}

func TestAuthorizeRetainsCauseWithoutPublishingIt(t *testing.T) {
	svc, _, cleanup := newTestService(t)
	defer cleanup()

	cause := errors.New(`authorization backend failed at C:\private\state.db`)
	svc.authorizer = failingKnowledgeAuthorizer{err: cause}
	_, err := svc.authorize(
		testKnowledgeEnvelopeContext("app.cause-test"),
		KnowledgeActionReadBank,
		cognitionpkg.RuntimeBridgeOperationGetKnowledgeScope,
		&runtimev1.KnowledgeRequestContext{AppId: "app.cause-test"},
		cognitionpkg.KnowledgeScopeOwner{
			Kind:  cognitionpkg.KnowledgeScopeOwnerKindAppPrivate,
			AppID: "app.cause-test",
		},
	)
	if !errors.Is(err, cause) {
		t.Fatalf("authorization error does not retain cause: %v", err)
	}
	if got := status.Code(err); got != codes.Internal {
		t.Fatalf("gRPC code = %v, want %v", got, codes.Internal)
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE {
		t.Fatalf("reason = %v, ok = %v", reason, ok)
	}
	publicMessage := status.Convert(err).Message()
	var payload struct {
		Message string `json:"message"`
	}
	if decodeErr := json.Unmarshal([]byte(publicMessage), &payload); decodeErr != nil {
		t.Fatalf("public message is not structured: %q: %v", publicMessage, decodeErr)
	}
	if payload.Message != "knowledge authorization failed" {
		t.Fatalf("public message = %q", payload.Message)
	}
	if strings.Contains(publicMessage, cause.Error()) {
		t.Fatalf("public message exposes cause: %q", publicMessage)
	}
}

func TestCognitionStorageErrorRetainsCauseWithoutPublishingIt(t *testing.T) {
	cause := errors.New(`cognition storage failed at C:\private\runtime-cognition.db`)

	err := cognitionStorageError(cause, "knowledge page could not be saved")
	if !errors.Is(err, cause) {
		t.Fatalf("storage error does not retain cause: %v", err)
	}
	if got := status.Code(err); got != codes.Internal {
		t.Fatalf("gRPC code = %v, want %v", got, codes.Internal)
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE {
		t.Fatalf("reason = %v, ok = %v", reason, ok)
	}
	publicMessage := status.Convert(err).Message()
	if strings.Contains(publicMessage, cause.Error()) || strings.Contains(publicMessage, `C:\private`) {
		t.Fatalf("public message exposes storage cause: %q", publicMessage)
	}
}

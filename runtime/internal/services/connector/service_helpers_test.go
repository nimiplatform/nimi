package connector

import (
	"context"
	"testing"

	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

func TestSubjectUserIDFromContextUsesAuthorizedLocalAppAccount(t *testing.T) {
	ctx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{
		RegisteredAppSubject: "principal-local-app",
		AccountID:            "account-local-app",
		Operation:            accountservice.LocalAppOperationReferenceList,
		OperationCapability:  "agent.local",
	})
	subjectUserID, ok := subjectUserIDFromContext(ctx)
	if !ok || subjectUserID != "account-local-app" {
		t.Fatalf("local-app subject = %q, %v", subjectUserID, ok)
	}
}

package connector

import (
	"context"
	"testing"

	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

func TestSubjectUserIDFromContextUsesAuthorizedLocalAppAccount(t *testing.T) {
	ctx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{
		LocalAppPrincipalID: "principal-local-app",
		LocalAppRecordID:    "record-local-app",
		AccountID:           "account-local-app",
		Operation:           accountservice.LocalAppOperationSharedAIConfigGet,
		OperationCapability: "agents.configure",
	})
	subjectUserID, ok := subjectUserIDFromContext(ctx)
	if !ok || subjectUserID != "account-local-app" {
		t.Fatalf("local-app subject = %q, %v", subjectUserID, ok)
	}
}

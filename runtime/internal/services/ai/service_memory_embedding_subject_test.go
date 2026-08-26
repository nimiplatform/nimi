package ai

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/protectedprincipal"
)

func TestMemoryEmbeddingAccountIDAcceptsRuntimeProtectedPrincipal(t *testing.T) {
	principal := protectedprincipal.New(
		"nimi.zhiyu", "zhiyu.test", "agent.local",
		&runtimev1.AccountProjection{AccountId: "account-1", RealmEnvironmentId: "realm-test"},
		1, [32]byte{1}, make(chan struct{}),
	)
	ctx := protectedprincipal.With(context.Background(), principal)
	if got := memoryEmbeddingAccountID(ctx); got != "account-1" {
		t.Fatalf("memory embedding account = %q", got)
	}
}

func TestMemoryEmbeddingAccountIDAcceptsRuntimePrivateExecutionSubject(t *testing.T) {
	ctx := executionintent.WithRuntimeAccountSubject(context.Background(), "account-2")
	if got := memoryEmbeddingAccountID(ctx); got != "account-2" {
		t.Fatalf("memory embedding Runtime-private account = %q", got)
	}
	owner, protected, err := canonicalScenarioJobOwnerWithProvider(ctx, nil)
	if err != nil || protected || owner != "account-2" {
		t.Fatalf("scenario job Runtime-private owner = %q protected=%v err=%v", owner, protected, err)
	}
}

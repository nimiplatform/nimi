package grpcserver

import (
	"context"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"testing"
)

func TestCognitionMemoryEmbeddingExecutionBindsRuntimeOwnerSubject(t *testing.T) {
	ctx := cognitionMemoryEmbeddingExecutionContext(context.Background(), "account-memory-owner")
	account, ok := executionintent.RuntimeAccountSubjectFromContext(ctx)
	if !ok || account != "account-memory-owner" {
		t.Fatalf("execution subject = %q ok=%v", account, ok)
	}
}

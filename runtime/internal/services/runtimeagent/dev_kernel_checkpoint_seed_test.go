package runtimeagent

import (
	"context"
	"testing"
)

func TestDevKernelCheckpointSeedIsIdempotentAndCreatesNoConversation(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentTestService(t)
	seed := DevKernelCheckpointSeed{
		OwnerUserID:      "dev-kernel-account-primary",
		LocalAgentRef:    "local-agent:runtime-1f2e3d4c5b6a79800123456789abcdef",
		RuntimeSourceRef: "dev-kernel-source-primary",
		DisplayName:      "知语开发内核验收伙伴",
	}
	first, err := svc.EnsureDevKernelCheckpointSeed(context.Background(), seed)
	if err != nil {
		t.Fatalf("first seed: %v", err)
	}
	second, err := svc.EnsureDevKernelCheckpointSeed(context.Background(), seed)
	if err != nil {
		t.Fatalf("second seed: %v", err)
	}
	if first.GetLocalAgentRef() != second.GetLocalAgentRef() || len(svc.agents) != 1 {
		t.Fatalf("seed was not idempotent: first=%q second=%q agents=%d", first.GetLocalAgentRef(), second.GetLocalAgentRef(), len(svc.agents))
	}
	if len(svc.chatAnchors) != 0 || len(svc.chatTurns) != 0 {
		t.Fatalf("seed must not create conversation authority: anchors=%d turns=%d", len(svc.chatAnchors), len(svc.chatTurns))
	}
}

func TestDevKernelCheckpointSeedRejectsIdentityDrift(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentTestService(t)
	seed := DevKernelCheckpointSeed{
		OwnerUserID:      "dev-kernel-account-primary",
		LocalAgentRef:    "local-agent:runtime-1f2e3d4c5b6a79800123456789abcdef",
		RuntimeSourceRef: "dev-kernel-source-primary",
		DisplayName:      "知语开发内核验收伙伴",
	}
	if _, err := svc.EnsureDevKernelCheckpointSeed(context.Background(), seed); err != nil {
		t.Fatal(err)
	}
	seed.DisplayName = "changed"
	if _, err := svc.EnsureDevKernelCheckpointSeed(context.Background(), seed); err == nil {
		t.Fatal("seed accepted an existing RuntimeAgent display identity drift")
	}
}

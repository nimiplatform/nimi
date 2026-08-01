package runtimeagent

import (
	"context"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
)

func TestRuntimeAgentOwnsCanonicalMemoryBankStatusAndBind(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	memorySvc, err := memoryservice.New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("memory.New: %v", err)
	}
	closeRuntimeAgentMemoryServiceForTest(t, memorySvc)
	setRuntimeAgentManagedEmbeddingProfileForTest(memorySvc, &runtimev1.MemoryEmbeddingProfile{
		Provider:        "local",
		ModelId:         runtimeAgentAIConfigTestEmbedModel,
		Dimension:       4,
		DistanceMetric:  runtimev1.MemoryDistanceMetric_MEMORY_DISTANCE_METRIC_COSINE,
		Version:         "v1",
		MigrationPolicy: runtimev1.MemoryMigrationPolicy_MEMORY_MIGRATION_POLICY_REINDEX,
	})

	svc, err := New(nil, localStatePath, memorySvc)
	if err != nil {
		t.Fatalf("runtimeagent.New: %v", err)
	}
	closeRuntimeAgentServiceForTest(t, svc)
	memorySvc.SetRuntimeEmbeddingIntentResolver(svc.ResolveMemoryEmbeddingIntent)
	memorySvc.SetMemoryEmbeddingTargetAuthorizer(svc.AuthorizeMemoryEmbeddingTarget)
	memorySvc.SetRuntimeEmbeddingProfileResolver(func(
		_ context.Context,
		snapshot *memoryservice.MemoryEmbeddingTextEmbedIntentSnapshot,
	) memoryservice.MemoryEmbeddingResolvedProfile {
		if snapshot == nil || snapshot.LocalBinding == nil ||
			snapshot.LocalBinding.ReadinessRef != "test_runtime_readiness:v2:default-embed" {
			return memoryservice.MemoryEmbeddingResolvedProfile{ResolutionState: "unresolved"}
		}
		return memoryservice.MemoryEmbeddingResolvedProfile{
			Profile:         memorySvc.ManagedEmbeddingProfile(),
			ResolutionState: "resolved",
		}
	})

	agentCtx := testRuntimeAgentIdentityContext("agent-memory-bank")
	if _, err := materializeRealmSourceTestAgent(t, svc, ctx, &realmSourceTestAgentInput{
		Context: agentCtx,
	}); err != nil {
		t.Fatalf("RealmSourceMaterialization: %v", err)
	}

	initial, err := svc.GetAgentCanonicalMemoryBankStatus(ctx, &runtimev1.GetAgentCanonicalMemoryBankStatusRequest{
		Context: agentCtx,
		AgentId: agentCtx.GetLocalAgentRef(),
	})
	if err != nil {
		t.Fatalf("GetAgentCanonicalMemoryBankStatus(initial): %v", err)
	}
	if initial.GetStatus().GetMode() != runtimev1.AgentCanonicalMemoryBankMode_AGENT_CANONICAL_MEMORY_BANK_MODE_UNAVAILABLE {
		t.Fatalf("initial mode = %s, want unavailable", initial.GetStatus().GetMode())
	}

	configureRuntimeAgentTestAIConfig(t, svc, agentCtx)

	baseline, err := svc.GetAgentCanonicalMemoryBankStatus(ctx, &runtimev1.GetAgentCanonicalMemoryBankStatusRequest{
		Context: agentCtx,
		AgentId: agentCtx.GetLocalAgentRef(),
	})
	if err != nil {
		t.Fatalf("GetAgentCanonicalMemoryBankStatus(baseline): %v", err)
	}
	if baseline.GetStatus().GetMode() != runtimev1.AgentCanonicalMemoryBankMode_AGENT_CANONICAL_MEMORY_BANK_MODE_BASELINE {
		t.Fatalf("baseline mode = %s, want baseline", baseline.GetStatus().GetMode())
	}
	if !baseline.GetStatus().GetBindAllowed() {
		t.Fatal("baseline bind_allowed = false, want true")
	}

	bind, err := svc.RequestAgentCanonicalMemoryBankBind(ctx, &runtimev1.RequestAgentCanonicalMemoryBankBindRequest{
		Context: agentCtx,
		AgentId: agentCtx.GetLocalAgentRef(),
	})
	if err != nil {
		t.Fatalf("RequestAgentCanonicalMemoryBankBind: %v", err)
	}
	if bind.GetOutcome() != "bound" {
		t.Fatalf("bind outcome = %q, want bound", bind.GetOutcome())
	}
	if bind.GetStatus().GetMode() != runtimev1.AgentCanonicalMemoryBankMode_AGENT_CANONICAL_MEMORY_BANK_MODE_STANDARD {
		t.Fatalf("bind status mode = %s, want standard", bind.GetStatus().GetMode())
	}
	if bind.GetStatus().GetEmbeddingProfile().GetModelId() != runtimeAgentAIConfigTestEmbedModel {
		t.Fatalf("embedding model = %q, want %s", bind.GetStatus().GetEmbeddingProfile().GetModelId(), runtimeAgentAIConfigTestEmbedModel)
	}
}

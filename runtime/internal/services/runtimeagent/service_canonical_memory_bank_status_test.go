package runtimeagent

import (
	"context"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aiconfig"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
)

func TestRuntimeAgentCanonicalMemoryBankUsesSharedLocalIntentMarker(t *testing.T) {
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
	aiConfigStore := aiconfig.NewMemoryStore()
	svc.SetAIConfigStore(aiConfigStore)
	if err := aiConfigStore.Overwrite(ctx, "user-1", &runtimev1.AIConfig{
		Owner: aiconfig.LocalAgentSubsystemOwner(),
		Capabilities: []*runtimev1.AIConfigCapabilityIntent{{
			CapabilityContract: capabilitydriver.TextEmbedCapabilityContract,
			Route:              &runtimev1.AIConfigCapabilityIntent_Local{Local: &runtimev1.AIConfigLocalIntent{}},
		}},
	}); err != nil {
		t.Fatalf("seed shared AIConfig: %v", err)
	}
	memorySvc.SetRuntimeEmbeddingIntentResolver(svc.ResolveMemoryEmbeddingIntent)
	memorySvc.SetMemoryEmbeddingTargetAuthorizer(svc.AuthorizeMemoryEmbeddingTarget)
	memorySvc.SetRuntimeEmbeddingProfileResolver(func(
		_ context.Context,
		snapshot *memoryservice.MemoryEmbeddingTextEmbedIntentSnapshot,
	) memoryservice.MemoryEmbeddingResolvedProfile {
		if snapshot == nil || snapshot.LocalBinding == nil {
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
	if initial.GetStatus().GetMode() != runtimev1.AgentCanonicalMemoryBankMode_AGENT_CANONICAL_MEMORY_BANK_MODE_BASELINE {
		t.Fatalf("initial mode = %s, want baseline", initial.GetStatus().GetMode())
	}
	if !initial.GetStatus().GetBindAllowed() {
		t.Fatal("resolved selected-Loadout profile must be bindable")
	}
}

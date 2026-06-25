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
		ModelId:         "nimi-embed",
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
	memorySvc.SetMemoryEmbeddingTargetAuthorizer(svc.AuthorizeMemoryEmbeddingTarget)

	agentCtx := testRuntimeAgentIdentityContext("agent-memory-bank")
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		Context:     agentCtx,
		DisplayName: "Memory Bank",
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
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

	locator := &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: agentCtx.GetLocalAgentRef()},
		},
	}
	if _, err := memorySvc.SetMemoryEmbeddingBindingIntent(ctx, memoryservice.SetMemoryEmbeddingBindingIntentRequest{
		Context: &runtimev1.MemoryRequestContext{
			AppId:         agentCtx.GetAppId(),
			SubjectUserId: agentCtx.GetOwnerUserId(),
		},
		Locator: locator,
		BindingIntent: &memoryservice.MemoryEmbeddingBindingIntentSnapshot{
			SourceKind: memoryservice.MemoryEmbeddingBindingSourceKindLocal,
			LocalBinding: &memoryservice.MemoryEmbeddingLocalBindingRef{
				ProfileBindingID: "nimi-embed",
			},
			RevisionToken: "rev-memory-bank",
		},
	}); err != nil {
		t.Fatalf("SetMemoryEmbeddingBindingIntent: %v", err)
	}

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
	if bind.GetStatus().GetEmbeddingProfile().GetModelId() != "nimi-embed" {
		t.Fatalf("embedding model = %q, want nimi-embed", bind.GetStatus().GetEmbeddingProfile().GetModelId())
	}
}

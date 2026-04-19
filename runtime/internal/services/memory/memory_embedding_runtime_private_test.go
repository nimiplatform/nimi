package memory

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
)

func newMemoryEmbeddingRuntimePrivateService(t *testing.T) *Service {
	t.Helper()
	svc, err := newMemoryEmbeddingRuntimePrivateServiceAtPath(filepath.Join(t.TempDir(), "local-state.json"))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return svc
}

func newMemoryEmbeddingRuntimePrivateServiceAtPath(path string) (*Service, error) {
	return New(nil, config.Config{LocalStatePath: path})
}

func testMemoryEmbeddingLocator(agentID string) *runtimev1.MemoryBankLocator {
	return &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: agentID},
		},
	}
}

func testManagedEmbeddingProfile(modelID string) *runtimev1.MemoryEmbeddingProfile {
	return &runtimev1.MemoryEmbeddingProfile{
		Provider:        "local",
		ModelId:         modelID,
		Dimension:       256,
		DistanceMetric:  runtimev1.MemoryDistanceMetric_MEMORY_DISTANCE_METRIC_COSINE,
		Version:         modelID + "@v1",
		MigrationPolicy: runtimev1.MemoryMigrationPolicy_MEMORY_MIGRATION_POLICY_REINDEX,
	}
}

func testLocalBindingSnapshot(modelID string) *MemoryEmbeddingBindingIntentSnapshot {
	return &MemoryEmbeddingBindingIntentSnapshot{
		SourceKind: MemoryEmbeddingBindingSourceKindLocal,
		LocalBinding: &MemoryEmbeddingLocalBindingRef{
			LocalModelID: modelID,
		},
		RevisionToken: "rev-1",
	}
}

func testCloudBindingSnapshot(connectorID string, modelID string) *MemoryEmbeddingBindingIntentSnapshot {
	return &MemoryEmbeddingBindingIntentSnapshot{
		SourceKind: MemoryEmbeddingBindingSourceKindCloud,
		CloudBinding: &MemoryEmbeddingCloudBindingRef{
			ConnectorID: connectorID,
			ModelID:     modelID,
		},
		RevisionToken: "rev-cloud-1",
	}
}

func TestInspectMemoryEmbeddingStateMissingWhenIntentAbsent(t *testing.T) {
	t.Parallel()

	svc := newMemoryEmbeddingRuntimePrivateService(t)
	state, err := svc.InspectMemoryEmbeddingState(context.Background(), InspectMemoryEmbeddingStateRequest{
		Locator: testMemoryEmbeddingLocator("agent-missing"),
	})
	if err != nil {
		t.Fatalf("InspectMemoryEmbeddingState: %v", err)
	}
	if state.BindingIntentPresent {
		t.Fatal("expected no binding intent")
	}
	if state.ResolutionState != memoryEmbeddingResolutionStateMissing {
		t.Fatalf("expected missing resolution state, got %s", state.ResolutionState)
	}
	if state.CanonicalBankStatus != memoryEmbeddingCanonicalBankStatusUnbound {
		t.Fatalf("expected unbound bank status, got %s", state.CanonicalBankStatus)
	}
	if state.OperationReadiness.BindAllowed {
		t.Fatal("bind should not be allowed without intent")
	}
}

func TestInspectMemoryEmbeddingStateReportsEquivalentBoundProfile(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	svc := newMemoryEmbeddingRuntimePrivateService(t)
	locator := testMemoryEmbeddingLocator("agent-equivalent")
	profile := testManagedEmbeddingProfile("local/embed-alpha")
	svc.SetManagedEmbeddingProfile(profile)
	if _, err := svc.EnsureCanonicalBank(ctx, locator, "Agent Memory", nil); err != nil {
		t.Fatalf("EnsureCanonicalBank: %v", err)
	}
	if _, err := svc.BindCanonicalBankEmbeddingProfile(ctx, locator); err != nil {
		t.Fatalf("BindCanonicalBankEmbeddingProfile: %v", err)
	}

	state, err := svc.InspectMemoryEmbeddingState(ctx, InspectMemoryEmbeddingStateRequest{
		Locator:               locator,
		BindingIntentSnapshot: testLocalBindingSnapshot("local/embed-alpha"),
	})
	if err != nil {
		t.Fatalf("InspectMemoryEmbeddingState: %v", err)
	}
	if state.ResolutionState != memoryEmbeddingResolutionStateResolved {
		t.Fatalf("expected resolved state, got %s", state.ResolutionState)
	}
	if state.CanonicalBankStatus != memoryEmbeddingCanonicalBankStatusBoundEquivalent {
		t.Fatalf("expected bound_equivalent, got %s", state.CanonicalBankStatus)
	}
	if state.ResolvedProfileIdentity == nil || state.ResolvedProfileIdentity.GetModelId() != "local/embed-alpha" {
		t.Fatalf("unexpected resolved profile identity: %#v", state.ResolvedProfileIdentity)
	}
}

func TestRequestCanonicalMemoryEmbeddingBindBindsUnboundCanonicalBank(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	svc := newMemoryEmbeddingRuntimePrivateService(t)
	locator := testMemoryEmbeddingLocator("agent-bind-runtime-private")
	svc.SetManagedEmbeddingProfile(testManagedEmbeddingProfile("local/embed-bind"))

	result, err := svc.RequestCanonicalMemoryEmbeddingBind(ctx, RequestCanonicalMemoryEmbeddingBindRequest{
		Locator:               locator,
		BindingIntentSnapshot: testLocalBindingSnapshot("local/embed-bind"),
	})
	if err != nil {
		t.Fatalf("RequestCanonicalMemoryEmbeddingBind: %v", err)
	}
	if result.Outcome != "bound" {
		t.Fatalf("expected bound outcome, got %s", result.Outcome)
	}
	if result.CanonicalBankStatusAfter != memoryEmbeddingCanonicalBankStatusBoundEquivalent {
		t.Fatalf("expected bound_equivalent after bind, got %s", result.CanonicalBankStatusAfter)
	}
	bank, err := svc.bankForLocator(locator)
	if err != nil {
		t.Fatalf("bankForLocator: %v", err)
	}
	if bank.Bank.GetEmbeddingProfile() == nil {
		t.Fatal("expected bank embedding profile to be bound")
	}
	if currentEmbeddingGenerationID(bank.Bank) == "" {
		t.Fatal("expected bound canonical bank to have current embedding generation id")
	}
}

func TestRequestCanonicalMemoryEmbeddingBindStagesProfileMismatch(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	svc := newMemoryEmbeddingRuntimePrivateService(t)
	locator := testMemoryEmbeddingLocator("agent-bind-mismatch")
	svc.SetManagedEmbeddingProfile(testManagedEmbeddingProfile("local/embed-old"))
	if _, err := svc.EnsureCanonicalBank(ctx, locator, "Agent Memory", nil); err != nil {
		t.Fatalf("EnsureCanonicalBank: %v", err)
	}
	if _, err := svc.BindCanonicalBankEmbeddingProfile(ctx, locator); err != nil {
		t.Fatalf("BindCanonicalBankEmbeddingProfile(old): %v", err)
	}
	svc.SetManagedEmbeddingProfile(testManagedEmbeddingProfile("local/embed-new"))

	result, err := svc.RequestCanonicalMemoryEmbeddingBind(ctx, RequestCanonicalMemoryEmbeddingBindRequest{
		Locator:               locator,
		BindingIntentSnapshot: testLocalBindingSnapshot("local/embed-new"),
	})
	if err != nil {
		t.Fatalf("RequestCanonicalMemoryEmbeddingBind: %v", err)
	}
	if result.Outcome != "staged_rebuild" {
		t.Fatalf("expected staged_rebuild outcome, got %s", result.Outcome)
	}
	if result.CanonicalBankStatusAfter != memoryEmbeddingCanonicalBankStatusRebuildPending {
		t.Fatalf("expected rebuild_pending, got %s", result.CanonicalBankStatusAfter)
	}
	if !result.PendingCutover {
		t.Fatal("expected pending cutover after staged mismatch bind")
	}
	bank, err := svc.bankForLocator(locator)
	if err != nil {
		t.Fatalf("bankForLocator: %v", err)
	}
	if currentEmbeddingGenerationID(bank.Bank) == "" {
		t.Fatal("expected current embedding generation id to remain set")
	}
	if bank.PendingEmbeddingCutover == nil || strings.TrimSpace(bank.PendingEmbeddingCutover.GenerationID) == "" {
		t.Fatal("expected staged mismatch bind to allocate pending generation id")
	}
}

func TestRequestCanonicalMemoryEmbeddingBindUsesRuntimeResolverProfile(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	svc := newMemoryEmbeddingRuntimePrivateService(t)
	locator := testMemoryEmbeddingLocator("agent-cloud-bind")
	svc.SetRuntimeEmbeddingProfileResolver(func(_ context.Context, snapshot *MemoryEmbeddingBindingIntentSnapshot) MemoryEmbeddingResolvedProfile {
		if snapshot == nil || snapshot.CloudBinding == nil || snapshot.CloudBinding.ModelID != "gemini-embedding-001" {
			return MemoryEmbeddingResolvedProfile{
				ResolutionState:   memoryEmbeddingResolutionStateUnresolved,
				BlockedReasonCode: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
			}
		}
		return MemoryEmbeddingResolvedProfile{
			Profile: &runtimev1.MemoryEmbeddingProfile{
				Provider:        "google",
				ModelId:         "gemini-embedding-001",
				Dimension:       256,
				DistanceMetric:  runtimev1.MemoryDistanceMetric_MEMORY_DISTANCE_METRIC_COSINE,
				Version:         "conn-gemini",
				MigrationPolicy: runtimev1.MemoryMigrationPolicy_MEMORY_MIGRATION_POLICY_REINDEX,
			},
			ResolutionState:   memoryEmbeddingResolutionStateResolved,
			BlockedReasonCode: runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
		}
	})

	result, err := svc.RequestCanonicalMemoryEmbeddingBind(ctx, RequestCanonicalMemoryEmbeddingBindRequest{
		Locator:               locator,
		BindingIntentSnapshot: testCloudBindingSnapshot("conn-gemini", "gemini-embedding-001"),
	})
	if err != nil {
		t.Fatalf("RequestCanonicalMemoryEmbeddingBind: %v", err)
	}
	if result.Outcome != "bound" {
		t.Fatalf("expected bound outcome, got %s", result.Outcome)
	}
	bank, err := svc.bankForLocator(locator)
	if err != nil {
		t.Fatalf("bankForLocator: %v", err)
	}
	if bank.Bank.GetEmbeddingProfile() == nil || bank.Bank.GetEmbeddingProfile().GetProvider() != "google" {
		t.Fatalf("expected resolved cloud embedding profile to bind, got %#v", bank.Bank.GetEmbeddingProfile())
	}
	if currentEmbeddingGenerationID(bank.Bank) == "" {
		t.Fatal("expected resolved-profile bind to stamp current generation id")
	}
}

func TestRequestCanonicalMemoryEmbeddingBindStagesRebuildOnProfileMismatch(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	svc := newMemoryEmbeddingRuntimePrivateService(t)
	locator := testMemoryEmbeddingLocator("agent-stage-mismatch")
	svc.SetManagedEmbeddingProfile(testManagedEmbeddingProfile("local/embed-old"))
	if _, err := svc.EnsureCanonicalBank(ctx, locator, "Agent Memory", nil); err != nil {
		t.Fatalf("EnsureCanonicalBank: %v", err)
	}
	if _, err := svc.BindCanonicalBankEmbeddingProfile(ctx, locator); err != nil {
		t.Fatalf("BindCanonicalBankEmbeddingProfile(old): %v", err)
	}
	svc.SetManagedEmbeddingProfile(testManagedEmbeddingProfile("local/embed-new"))

	result, err := svc.RequestCanonicalMemoryEmbeddingBind(ctx, RequestCanonicalMemoryEmbeddingBindRequest{
		Locator:               locator,
		BindingIntentSnapshot: testLocalBindingSnapshot("local/embed-new"),
	})
	if err != nil {
		t.Fatalf("RequestCanonicalMemoryEmbeddingBind: %v", err)
	}
	if result.Outcome != "staged_rebuild" {
		t.Fatalf("expected staged_rebuild outcome, got %s", result.Outcome)
	}
	if !result.PendingCutover {
		t.Fatal("expected pending cutover after staged rebuild")
	}
	if result.CanonicalBankStatusAfter != memoryEmbeddingCanonicalBankStatusRebuildPending {
		t.Fatalf("expected rebuild_pending after stage, got %s", result.CanonicalBankStatusAfter)
	}

	state, err := svc.InspectMemoryEmbeddingState(ctx, InspectMemoryEmbeddingStateRequest{
		Locator:               locator,
		BindingIntentSnapshot: testLocalBindingSnapshot("local/embed-new"),
	})
	if err != nil {
		t.Fatalf("InspectMemoryEmbeddingState: %v", err)
	}
	if state.CanonicalBankStatus != memoryEmbeddingCanonicalBankStatusCutoverReady {
		t.Fatalf("expected cutover_ready inspect status, got %s", state.CanonicalBankStatus)
	}
	if !state.OperationReadiness.CutoverAllowed {
		t.Fatal("expected cutover to be allowed after staging")
	}
	bank, err := svc.bankForLocator(locator)
	if err != nil {
		t.Fatalf("bankForLocator: %v", err)
	}
	if bank.PendingEmbeddingCutover == nil || bank.PendingEmbeddingCutover.TargetProfile == nil {
		t.Fatal("expected pending embedding cutover state")
	}
	if strings.TrimSpace(bank.PendingEmbeddingCutover.GenerationID) == "" {
		t.Fatal("expected pending cutover to carry generation id")
	}
	if bank.PendingEmbeddingCutover.TargetProfile.GetModelId() != "local/embed-new" {
		t.Fatalf("expected pending target profile to be staged, got %#v", bank.PendingEmbeddingCutover.TargetProfile)
	}
	if bank.Bank.GetEmbeddingProfile() == nil || bank.Bank.GetEmbeddingProfile().GetModelId() != "local/embed-old" {
		t.Fatalf("expected current bank profile to remain old until cutover, got %#v", bank.Bank.GetEmbeddingProfile())
	}
	if currentEmbeddingGenerationID(bank.Bank) == bank.PendingEmbeddingCutover.GenerationID {
		t.Fatal("expected pending generation id to differ from current generation id")
	}
}

func TestRequestMemoryEmbeddingCutoverCommitsStagedProfile(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	svc := newMemoryEmbeddingRuntimePrivateService(t)
	locator := testMemoryEmbeddingLocator("agent-cutover")
	svc.SetManagedEmbeddingProfile(testManagedEmbeddingProfile("local/embed-old"))
	if _, err := svc.EnsureCanonicalBank(ctx, locator, "Agent Memory", nil); err != nil {
		t.Fatalf("EnsureCanonicalBank: %v", err)
	}
	if _, err := svc.BindCanonicalBankEmbeddingProfile(ctx, locator); err != nil {
		t.Fatalf("BindCanonicalBankEmbeddingProfile(old): %v", err)
	}
	svc.SetManagedEmbeddingProfile(testManagedEmbeddingProfile("local/embed-new"))
	if _, err := svc.RequestCanonicalMemoryEmbeddingBind(ctx, RequestCanonicalMemoryEmbeddingBindRequest{
		Locator:               locator,
		BindingIntentSnapshot: testLocalBindingSnapshot("local/embed-new"),
	}); err != nil {
		t.Fatalf("RequestCanonicalMemoryEmbeddingBind(stage): %v", err)
	}
	beforeCutover, err := svc.bankForLocator(locator)
	if err != nil {
		t.Fatalf("bankForLocator(beforeCutover): %v", err)
	}
	beforeGenerationID := currentEmbeddingGenerationID(beforeCutover.Bank)
	pendingGenerationID := ""
	if beforeCutover.PendingEmbeddingCutover != nil {
		pendingGenerationID = beforeCutover.PendingEmbeddingCutover.GenerationID
	}

	result, err := svc.RequestMemoryEmbeddingCutover(ctx, RequestMemoryEmbeddingCutoverRequest{
		Locator:               locator,
		BindingIntentSnapshot: testLocalBindingSnapshot("local/embed-new"),
	})
	if err != nil {
		t.Fatalf("RequestMemoryEmbeddingCutover: %v", err)
	}
	if result.Outcome != "cutover_committed" {
		t.Fatalf("expected cutover_committed outcome, got %s", result.Outcome)
	}
	if result.CanonicalBankStatusAfter != memoryEmbeddingCanonicalBankStatusBoundEquivalent {
		t.Fatalf("expected bound_equivalent after cutover, got %s", result.CanonicalBankStatusAfter)
	}
	bank, err := svc.bankForLocator(locator)
	if err != nil {
		t.Fatalf("bankForLocator: %v", err)
	}
	if bank.PendingEmbeddingCutover != nil {
		t.Fatalf("expected pending cutover to clear after commit, got %#v", bank.PendingEmbeddingCutover)
	}
	if bank.Bank.GetEmbeddingProfile() == nil || bank.Bank.GetEmbeddingProfile().GetModelId() != "local/embed-new" {
		t.Fatalf("expected current bank profile to switch after cutover, got %#v", bank.Bank.GetEmbeddingProfile())
	}
	afterGenerationID := currentEmbeddingGenerationID(bank.Bank)
	if afterGenerationID == "" {
		t.Fatal("expected cutover to preserve current generation id")
	}
	if afterGenerationID == beforeGenerationID {
		t.Fatal("expected cutover to advance current generation id")
	}
	if pendingGenerationID == "" || afterGenerationID != pendingGenerationID {
		t.Fatalf("expected cutover to promote pending generation id, got current=%q pending=%q", afterGenerationID, pendingGenerationID)
	}
}

func TestPendingMemoryEmbeddingCutoverPersistsAcrossRestart(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	statePath := filepath.Join(t.TempDir(), "local-state.json")
	svc, err := newMemoryEmbeddingRuntimePrivateServiceAtPath(statePath)
	if err != nil {
		t.Fatalf("New(initial): %v", err)
	}
	locator := testMemoryEmbeddingLocator("agent-persist-cutover")
	svc.SetManagedEmbeddingProfile(testManagedEmbeddingProfile("local/embed-old"))
	if _, err := svc.EnsureCanonicalBank(ctx, locator, "Agent Memory", nil); err != nil {
		t.Fatalf("EnsureCanonicalBank: %v", err)
	}
	if _, err := svc.BindCanonicalBankEmbeddingProfile(ctx, locator); err != nil {
		t.Fatalf("BindCanonicalBankEmbeddingProfile(old): %v", err)
	}
	svc.SetManagedEmbeddingProfile(testManagedEmbeddingProfile("local/embed-new"))
	if _, err := svc.RequestCanonicalMemoryEmbeddingBind(ctx, RequestCanonicalMemoryEmbeddingBindRequest{
		Locator:               locator,
		BindingIntentSnapshot: testLocalBindingSnapshot("local/embed-new"),
	}); err != nil {
		t.Fatalf("RequestCanonicalMemoryEmbeddingBind(stage): %v", err)
	}
	if err := svc.Close(); err != nil {
		t.Fatalf("Close(initial): %v", err)
	}

	restarted, err := newMemoryEmbeddingRuntimePrivateServiceAtPath(statePath)
	if err != nil {
		t.Fatalf("New(restarted): %v", err)
	}
	defer restarted.Close()
	restarted.SetManagedEmbeddingProfile(testManagedEmbeddingProfile("local/embed-new"))

	state, err := restarted.InspectMemoryEmbeddingState(ctx, InspectMemoryEmbeddingStateRequest{
		Locator:               locator,
		BindingIntentSnapshot: testLocalBindingSnapshot("local/embed-new"),
	})
	if err != nil {
		t.Fatalf("InspectMemoryEmbeddingState(restarted): %v", err)
	}
	if state.CanonicalBankStatus != memoryEmbeddingCanonicalBankStatusCutoverReady {
		t.Fatalf("expected persisted cutover_ready status after restart, got %s", state.CanonicalBankStatus)
	}
	if !state.OperationReadiness.CutoverAllowed {
		t.Fatal("expected cutover to remain allowed after restart")
	}
	bank, err := restarted.bankForLocator(locator)
	if err != nil {
		t.Fatalf("bankForLocator(restarted): %v", err)
	}
	if currentEmbeddingGenerationID(bank.Bank) == "" {
		t.Fatal("expected current generation id to persist across restart")
	}
	if bank.PendingEmbeddingCutover == nil || strings.TrimSpace(bank.PendingEmbeddingCutover.GenerationID) == "" {
		t.Fatal("expected pending generation id to persist across restart")
	}
}

func TestRequestMemoryEmbeddingCutoverReportsNotReadyWhenRebuildReadinessFails(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	svc := newMemoryEmbeddingRuntimePrivateService(t)
	locator := testMemoryEmbeddingLocator("agent-cutover-not-ready")
	svc.SetManagedEmbeddingProfile(testManagedEmbeddingProfile("local/embed-old"))
	if _, err := svc.EnsureCanonicalBank(ctx, locator, "Agent Memory", nil); err != nil {
		t.Fatalf("EnsureCanonicalBank: %v", err)
	}
	if _, err := svc.BindCanonicalBankEmbeddingProfile(ctx, locator); err != nil {
		t.Fatalf("BindCanonicalBankEmbeddingProfile(old): %v", err)
	}
	if _, err := svc.Retain(ctx, &runtimev1.RetainRequest{
		Bank: locator,
		Records: []*runtimev1.MemoryRecordInput{
			{
				Kind:           runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_SEMANTIC,
				CanonicalClass: runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_PUBLIC_SHARED,
				Provenance: &runtimev1.MemoryProvenance{
					SourceSystem:  "test",
					SourceEventId: "evt-cutover-not-ready",
				},
				Payload: &runtimev1.MemoryRecordInput_Semantic{
					Semantic: &runtimev1.SemanticMemoryRecord{
						Subject:   "Alice",
						Predicate: "works_at",
						Object:    "Nimi",
					},
				},
			},
		},
	}); err != nil {
		t.Fatalf("Retain: %v", err)
	}
	svc.SetManagedEmbeddingProfile(testManagedEmbeddingProfile("local/embed-new"))
	svc.SetRuntimeEmbeddingVectorExecutor(func(_ context.Context, profile *runtimev1.MemoryEmbeddingProfile, raws []string) ([][]float64, error) {
		if profile != nil && profile.GetModelId() == "local/embed-new" && len(raws) > 0 {
			return nil, errors.New("embedding executor unavailable")
		}
		return embeddingVectorsWithExecutor(context.Background(), nil, profile, raws)
	})
	if _, err := svc.RequestCanonicalMemoryEmbeddingBind(ctx, RequestCanonicalMemoryEmbeddingBindRequest{
		Locator:               locator,
		BindingIntentSnapshot: testLocalBindingSnapshot("local/embed-new"),
	}); err != nil {
		t.Fatalf("RequestCanonicalMemoryEmbeddingBind(stage): %v", err)
	}

	result, err := svc.RequestMemoryEmbeddingCutover(ctx, RequestMemoryEmbeddingCutoverRequest{
		Locator:               locator,
		BindingIntentSnapshot: testLocalBindingSnapshot("local/embed-new"),
	})
	if err != nil {
		t.Fatalf("RequestMemoryEmbeddingCutover: %v", err)
	}
	if result.Outcome != "not_ready" {
		t.Fatalf("expected not_ready outcome, got %s", result.Outcome)
	}
	if result.CanonicalBankStatusAfter != memoryEmbeddingCanonicalBankStatusRebuildPending {
		t.Fatalf("expected rebuild_pending after failed readiness, got %s", result.CanonicalBankStatusAfter)
	}
	if result.BlockedReasonCode != runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE {
		t.Fatalf("expected AI_LOCAL_SERVICE_UNAVAILABLE blocked reason, got %s", result.BlockedReasonCode)
	}

	state, err := svc.inspectMemoryEmbeddingState(ctx, InspectMemoryEmbeddingStateRequest{
		Locator:               locator,
		BindingIntentSnapshot: testLocalBindingSnapshot("local/embed-new"),
	}, false)
	if err != nil {
		t.Fatalf("inspectMemoryEmbeddingState: %v", err)
	}
	if state.CanonicalBankStatus != memoryEmbeddingCanonicalBankStatusRebuildPending {
		t.Fatalf("expected rebuild_pending inspect status, got %s", state.CanonicalBankStatus)
	}
	if state.OperationReadiness.CutoverAllowed {
		t.Fatal("expected cutover to remain blocked while rebuild is not ready")
	}
	if state.BlockedReasonCode != runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE {
		t.Fatalf("expected persisted blocked reason, got %s", state.BlockedReasonCode)
	}
}

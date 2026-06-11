package cognition

import (
	"context"
	"log/slog"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// createGateTestBank provisions an APP_PRIVATE public bank so the gate
// tests exercise otherwise fully well-formed Retain/Recall requests.
func createGateTestBank(t *testing.T, svc *Service) *runtimev1.MemoryBankLocator {
	t.Helper()
	createResp, err := svc.CreateBank(context.Background(), &runtimev1.CreateBankRequest{
		Context: &runtimev1.MemoryRequestContext{AppId: "app-gate"},
		Locator: &runtimev1.PublicMemoryBankLocator{
			Locator: &runtimev1.PublicMemoryBankLocator_AppPrivate{
				AppPrivate: &runtimev1.AppPrivateBankOwner{AccountId: "acct-gate", AppId: "app-gate"},
			},
		},
	})
	if err != nil {
		t.Fatalf("CreateBank: %v", err)
	}
	return createResp.GetBank().GetLocator()
}

// TestRetainPublicSurfaceFailsClosedWithoutAppMemoryAdmission asserts
// the C-APMEM-005 gate on the app-facing write entry: the wire surface
// (MemoryRequestContext) cannot present the mandatory session/persona
// bounds today, so even a fully well-formed Retain request denies with
// the typed apmem_scope_ambiguous reason BEFORE any pipeline work
// (C-APMEM-004 no implicit allow). No record may be written under deny.
func TestRetainPublicSurfaceFailsClosedWithoutAppMemoryAdmission(t *testing.T) {
	svc, _, cleanup := newTestService(t)
	defer cleanup()

	ctx := context.Background()
	locator := createGateTestBank(t, svc)

	_, err := svc.Retain(ctx, &runtimev1.RetainRequest{
		Context: &runtimev1.MemoryRequestContext{AppId: "app-gate"},
		Bank:    locator,
		Records: []*runtimev1.MemoryRecordInput{{
			Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_EPISODIC,
			Payload: &runtimev1.MemoryRecordInput_Episodic{
				Episodic: &runtimev1.EpisodicMemoryRecord{Summary: "must not land"},
			},
		}},
	})
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("expected PermissionDenied, got %v", err)
	}
	if got := status.Convert(err).Message(); got != "apmem_scope_ambiguous" {
		t.Fatalf("deny reason mismatch: got=%q want=%q", got, "apmem_scope_ambiguous")
	}

	// The denied write must not have committed anything: the admitted
	// read pipeline over the same bank sees zero records.
	historyResp, err := svc.History(ctx, &runtimev1.HistoryRequest{
		Context: &runtimev1.MemoryRequestContext{AppId: "app-gate"},
		Bank:    locator,
	})
	if err != nil {
		t.Fatalf("History: %v", err)
	}
	if len(historyResp.GetRecords()) != 0 {
		t.Fatalf("denied retain leaked %d records into the bank", len(historyResp.GetRecords()))
	}
}

// TestRecallPublicSurfaceFailsClosedWithoutAppMemoryAdmission asserts
// the C-APMEM-002 gate on the app-facing read entry: the wire carries
// no admitted memory.read.* policy declaration or scope refs, so the
// gate denies with the typed apmem_no_policy reason (C-APMEM-004:
// missing policy → deny).
func TestRecallPublicSurfaceFailsClosedWithoutAppMemoryAdmission(t *testing.T) {
	svc, _, cleanup := newTestService(t)
	defer cleanup()

	locator := createGateTestBank(t, svc)
	_, err := svc.Recall(context.Background(), &runtimev1.RecallRequest{
		Context: &runtimev1.MemoryRequestContext{AppId: "app-gate"},
		Bank:    locator,
		Query:   &runtimev1.MemoryRecallQuery{Query: "anything", Limit: 5},
	})
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("expected PermissionDenied, got %v", err)
	}
	if got := status.Convert(err).Message(); got != "apmem_no_policy" {
		t.Fatalf("deny reason mismatch: got=%q want=%q", got, "apmem_no_policy")
	}
}

// TestAgentInternalMemoryPathRemainsUngatedByAppMemoryPolicy is the
// C-APMEM-001 carve-out regression: RuntimeAgentService stays the
// semantic owner of canonical agent memory admission (K-AGCORE-004),
// and its agent-memory path flows through memoryservice.Service
// Retain/Recall directly (runtimeagent/memory_policy_runtime.go) — it
// never enters the app-facing RuntimeCognitionService handlers gated
// above. That route must keep working with zero C-APMEM grant
// artifacts: no policy, no grant checker, no persona/session wire refs.
func TestAgentInternalMemoryPathRemainsUngatedByAppMemoryPolicy(t *testing.T) {
	root := t.TempDir()
	cfg := config.Config{LocalStatePath: filepath.Join(root, "local-state.json")}
	logger := slog.New(slog.NewTextHandler(testWriter{t: t}, nil))

	memorySvc, err := memoryservice.New(logger, cfg)
	if err != nil {
		t.Fatalf("memoryservice.New: %v", err)
	}
	defer func() { _ = memorySvc.Close() }()
	setMemoryEmbeddingVectorExecutorForTest(memorySvc)
	memorySvc.SetManagedEmbeddingProfile(testRuntimeEmbeddingProfile("local/agent-path-embed"))

	ctx := context.Background()
	locator := testAgentCoreMemoryLocator("agent-apmem-carveout")
	// Mirror RuntimeAgentService's own provisioning sequence
	// (agent_admin_runtime.go): canonical bank ensure + embedding bind.
	if _, err := memorySvc.EnsureCanonicalBank(ctx, locator, "Agent Memory", nil); err != nil {
		t.Fatalf("EnsureCanonicalBank: %v", err)
	}
	if _, err := memorySvc.BindCanonicalBankEmbeddingProfile(ctx, locator); err != nil {
		t.Fatalf("BindCanonicalBankEmbeddingProfile: %v", err)
	}

	retainResp, err := memorySvc.Retain(ctx, &runtimev1.RetainRequest{
		Bank: locator,
		Records: []*runtimev1.MemoryRecordInput{{
			Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
			Payload: &runtimev1.MemoryRecordInput_Observational{
				Observational: &runtimev1.ObservationalMemoryRecord{Observation: "agent canonical memory path"},
			},
		}},
	})
	if err != nil {
		t.Fatalf("agent-internal Retain must not be gated by C-APMEM: %v", err)
	}
	if len(retainResp.GetRecords()) != 1 {
		t.Fatalf("agent-internal retain records mismatch: got=%d want=1", len(retainResp.GetRecords()))
	}

	recallResp, err := memorySvc.Recall(ctx, &runtimev1.RecallRequest{
		Bank:  locator,
		Query: &runtimev1.MemoryRecallQuery{Query: "canonical", Limit: 5},
	})
	if err != nil {
		t.Fatalf("agent-internal Recall must not be gated by C-APMEM: %v", err)
	}
	if len(recallResp.GetHits()) == 0 {
		t.Fatal("agent-internal recall returned no hits")
	}
}

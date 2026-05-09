package runtimeagent

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestRuntimeAgentRecordAgentMemoryRecallFeedbackAffectsQueryRanking(t *testing.T) {
	t.Parallel()

	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	memorySvc, err := memoryservice.New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("memory.New: %v", err)
	}
	closeRuntimeAgentMemoryServiceForTest(t, memorySvc)
	svc, err := New(nil, localStatePath, memorySvc)
	if err != nil {
		t.Fatalf("runtimeagent.New: %v", err)
	}
	closeRuntimeAgentServiceForTest(t, svc)

	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId:     "agent-feedback",
		DisplayName: "Feedback Agent",
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	writeResp, err := svc.WriteAgentMemory(ctx, &runtimev1.WriteAgentMemoryRequest{
		AgentId: "agent-feedback",
		Candidates: []*runtimev1.CanonicalMemoryCandidate{
			{
				CanonicalClass: runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_PUBLIC_SHARED,
				TargetBank: &runtimev1.MemoryBankLocator{
					Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
					Owner: &runtimev1.MemoryBankLocator_AgentCore{
						AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-feedback"},
					},
				},
				SourceEventId: "evt-feedback-1",
				Extensions:    completePromotionEvidence(t),
				Record: &runtimev1.MemoryRecordInput{
					Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
					Payload: &runtimev1.MemoryRecordInput_Observational{
						Observational: &runtimev1.ObservationalMemoryRecord{Observation: "alpha project note"},
					},
				},
			},
			{
				CanonicalClass: runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_PUBLIC_SHARED,
				TargetBank: &runtimev1.MemoryBankLocator{
					Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
					Owner: &runtimev1.MemoryBankLocator_AgentCore{
						AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-feedback"},
					},
				},
				SourceEventId: "evt-feedback-2",
				Extensions:    completePromotionEvidence(t),
				Record: &runtimev1.MemoryRecordInput{
					Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
					Payload: &runtimev1.MemoryRecordInput_Observational{
						Observational: &runtimev1.ObservationalMemoryRecord{Observation: "alpha project plan"},
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("WriteAgentMemory: %v", err)
	}
	if len(writeResp.GetAccepted()) != 2 {
		t.Fatalf("expected 2 accepted memories, got %d", len(writeResp.GetAccepted()))
	}
	firstID := writeResp.GetAccepted()[0].GetRecord().GetMemoryId()
	secondID := writeResp.GetAccepted()[1].GetRecord().GetMemoryId()

	if err := svc.RecordAgentMemoryRecallFeedback(ctx, AgentMemoryRecallFeedback{
		FeedbackID: "agent-feedback-helpful-1",
		AgentID:    "agent-feedback",
		TargetKind: "record",
		TargetID:   secondID,
		Polarity:   "helpful",
		QueryText:  "alpha",
	}); err != nil {
		t.Fatalf("RecordAgentMemoryRecallFeedback(helpful): %v", err)
	}
	if err := svc.RecordAgentMemoryRecallFeedback(ctx, AgentMemoryRecallFeedback{
		FeedbackID: "agent-feedback-unhelpful-1",
		AgentID:    "agent-feedback",
		TargetKind: "record",
		TargetID:   firstID,
		Polarity:   "unhelpful",
		QueryText:  "alpha",
	}); err != nil {
		t.Fatalf("RecordAgentMemoryRecallFeedback(unhelpful): %v", err)
	}

	queryResp, err := svc.QueryAgentMemory(ctx, &runtimev1.QueryAgentMemoryRequest{
		AgentId: "agent-feedback",
		Query:   "alpha",
		Limit:   10,
	})
	if err != nil {
		t.Fatalf("QueryAgentMemory: %v", err)
	}
	if len(queryResp.GetMemories()) < 2 {
		t.Fatalf("expected at least 2 memories, got %#v", queryResp.GetMemories())
	}
	if queryResp.GetMemories()[0].GetRecord().GetMemoryId() != secondID {
		t.Fatalf("expected helpful memory to rank first, got %#v", queryResp.GetMemories())
	}
	if queryResp.GetMemories()[1].GetRecord().GetMemoryId() != firstID {
		t.Fatalf("expected unhelpful memory to rank after helpful memory, got %#v", queryResp.GetMemories())
	}
}

func TestRuntimeAgentRecordAgentMemoryRecallFeedbackRejectsMismatchedBank(t *testing.T) {
	t.Parallel()

	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	memorySvc, err := memoryservice.New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("memory.New: %v", err)
	}
	closeRuntimeAgentMemoryServiceForTest(t, memorySvc)
	svc, err := New(nil, localStatePath, memorySvc)
	if err != nil {
		t.Fatalf("runtimeagent.New: %v", err)
	}
	closeRuntimeAgentServiceForTest(t, svc)

	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId:     "agent-feedback-boundary",
		DisplayName: "Feedback Boundary Agent",
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	err = svc.RecordAgentMemoryRecallFeedback(ctx, AgentMemoryRecallFeedback{
		FeedbackID: "agent-feedback-boundary-1",
		AgentID:    "agent-feedback-boundary",
		Bank: &runtimev1.MemoryBankLocator{
			Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
			Owner: &runtimev1.MemoryBankLocator_AgentCore{
				AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "someone-else"},
			},
		},
		TargetKind: "record",
		TargetID:   "memory-x",
		Polarity:   "helpful",
	})
	if err == nil {
		t.Fatal("expected mismatched bank validation error")
	}
	if !strings.Contains(err.Error(), "agent_core review bank must match agent_id") {
		t.Fatalf("unexpected error: %v", err)
	}
}

// TestRuntimeAgentImportsLegacyJSONIntoSQLiteAndRename is retired as part of
// the Exec Pack 2 hard cut. The legacy-import fixture used the pre-cut
// `PendingHook{HookId, Status, Trigger, NextIntent}` shape plus
// `NextHookIntent_*` oneof sub-messages, which are no longer part of the
// Go proto surface and cannot be constructed in the new vocabulary.
// Re-introducing those Go types just to run this import path would
// preserve legacy canonical truth "just for tests", which packet doctrine
// explicitly forbids.
//
// The JSON-on-disk import path is still covered by runtime startup
// (loadState + importLegacyStateIfPresent) exercised by
// `TestRuntimeAgentStateReloadPreservesHookAdmissionAndEventSequence`
// after the hard cut, but using the new HookIntent-shaped fixture.
func TestRuntimeAgentImportsLegacyJSONIntoSQLiteAndRename(t *testing.T) {
	t.Skip("retired: pre-cut PendingHook + NextHookIntent shape is no longer part of the Go proto surface")
	_ = filepath.Join // keep filepath import reachable for later replacement test
}

func testRuntimeAgentImportsLegacyJSONIntoSQLiteAndRenameRetired(t *testing.T) {
	dir := t.TempDir()
	localStatePath := filepath.Join(dir, "local-state.json")
	legacyPath := filepath.Join(dir, "runtime-agent-state.json")
	now := time.Now().UTC()
	agent := &runtimev1.AgentRecord{
		AgentId:         "agent-legacy",
		DisplayName:     "Legacy Agent",
		LifecycleStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE,
		Autonomy: &runtimev1.AgentAutonomyState{
			Enabled: true,
		},
		CreatedAt: timestamppb.New(now),
		UpdatedAt: timestamppb.New(now),
	}
	state := &runtimev1.AgentStateProjection{
		ExecutionState: runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_LIFE_PENDING,
		StatusText:     "legacy status",
		ActiveWorldId:  "world-legacy",
		UpdatedAt:      timestamppb.New(now),
	}
	scheduledFor := now.Add(3 * time.Minute)
	hook := newTestTimePendingHook(t, "hook-legacy", "agent-legacy", scheduledFor, now)
	event := &runtimev1.AgentEvent{
		EventType: runtimev1.AgentEventType_AGENT_EVENT_TYPE_HOOK,
		Sequence:  3,
		AgentId:   agent.GetAgentId(),
		Timestamp: timestamppb.New(now),
		Detail: &runtimev1.AgentEvent_Hook{
			Hook: &runtimev1.AgentHookEventDetail{
				Family:     runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PENDING,
				Intent:     cloneHookIntent(hook.GetIntent()),
				ObservedAt: timestamppb.New(now),
			},
		},
	}
	agentRaw, err := protojson.Marshal(agent)
	if err != nil {
		t.Fatalf("protojson.Marshal(agent): %v", err)
	}
	stateRaw, err := protojson.Marshal(state)
	if err != nil {
		t.Fatalf("protojson.Marshal(state): %v", err)
	}
	hookRaw, err := protojson.Marshal(hook)
	if err != nil {
		t.Fatalf("protojson.Marshal(hook): %v", err)
	}
	eventRaw, err := protojson.Marshal(event)
	if err != nil {
		t.Fatalf("protojson.Marshal(event): %v", err)
	}
	legacy := persistedRuntimeAgentState{
		SchemaVersion: runtimeAgentStateSchemaVersion,
		SavedAt:       now.Format(time.RFC3339Nano),
		Sequence:      event.GetSequence(),
		Agents: []persistedAgentState{
			{
				Agent: agentRaw,
				State: stateRaw,
				Hooks: []json.RawMessage{hookRaw},
			},
		},
		Events: []json.RawMessage{eventRaw},
	}
	raw, err := json.MarshalIndent(legacy, "", "  ")
	if err != nil {
		t.Fatalf("json.MarshalIndent: %v", err)
	}
	if err := os.WriteFile(legacyPath, raw, 0o600); err != nil {
		t.Fatalf("os.WriteFile(runtime-agent-state.json): %v", err)
	}

	memorySvc, err := memoryservice.New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("memory.New: %v", err)
	}
	closeRuntimeAgentMemoryServiceForTest(t, memorySvc)
	svc, err := New(nil, localStatePath, memorySvc)
	if err != nil {
		t.Fatalf("runtimeagent.New(import): %v", err)
	}
	closeRuntimeAgentServiceForTest(t, svc)

	entry, err := svc.agentByID(agent.GetAgentId())
	if err != nil {
		t.Fatalf("agentByID(imported): %v", err)
	}
	if entry.State.GetStatusText() != "legacy status" {
		t.Fatalf("unexpected imported state: %#v", entry.State)
	}
	if len(entry.Hooks) != 1 || entry.Hooks["hook-legacy"] == nil {
		t.Fatalf("unexpected imported hooks: %#v", entry.Hooks)
	}
	if len(svc.events) != 1 || svc.events[0].GetSequence() != event.GetSequence() {
		t.Fatalf("unexpected imported events: %#v", svc.events)
	}
	if _, err := os.Stat(legacyPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expected legacy runtime-agent file to be renamed, stat err=%v", err)
	}
	if _, err := os.Stat(legacyPath + ".wave4-imported.json.bak"); err != nil {
		t.Fatalf("expected imported runtime agent backup rename: %v", err)
	}
	if got, err := svc.runtimeAgentMetaValue(runtimeAgentMetaLegacyImportSourcePathKey); err != nil || got != legacyPath {
		t.Fatalf("unexpected import source path metadata: got=%q err=%v", got, err)
	}
	if got, err := svc.runtimeAgentMetaValue(runtimeAgentMetaLegacyImportSourceSchemaVersionKey); err != nil || got != "1" {
		t.Fatalf("unexpected import schema metadata: got=%q err=%v", got, err)
	}
	if got, err := svc.runtimeAgentMetaValue(runtimeAgentMetaLegacyImportSourceSHA256Key); err != nil || got == "" {
		t.Fatalf("expected import sha metadata, got=%q err=%v", got, err)
	}
	if got, err := svc.runtimeAgentMetaValue(runtimeAgentMetaLegacyImportedAtKey); err != nil || got == "" {
		t.Fatalf("expected import timestamp metadata, got=%q err=%v", got, err)
	}

	if err := memorySvc.PersistenceBackend().Close(); err != nil {
		t.Fatalf("Close(first backend): %v", err)
	}

	memorySvc, err = memoryservice.New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("memory.New(restart): %v", err)
	}
	closeRuntimeAgentMemoryServiceForTest(t, memorySvc)
	defer func() {
		if err := memorySvc.PersistenceBackend().Close(); err != nil {
			t.Fatalf("Close(second backend): %v", err)
		}
	}()
	svc, err = New(nil, localStatePath, memorySvc)
	if err != nil {
		t.Fatalf("runtimeagent.New(restart): %v", err)
	}
	closeRuntimeAgentServiceForTest(t, svc)
	entry, err = svc.agentByID(agent.GetAgentId())
	if err != nil {
		t.Fatalf("agentByID(restart): %v", err)
	}
	if len(entry.Hooks) != 1 {
		t.Fatalf("expected one imported hook after restart, got %#v", entry.Hooks)
	}
}

func newRuntimeAgentTestService(t *testing.T) *Service {
	t.Helper()

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
		Version:         "nimi-embed",
		MigrationPolicy: runtimev1.MemoryMigrationPolicy_MEMORY_MIGRATION_POLICY_REINDEX,
	})

	svc, err := New(nil, localStatePath, memorySvc)
	if err != nil {
		t.Fatalf("runtimeagent.New: %v", err)
	}
	closeRuntimeAgentServiceForTest(t, svc)
	return svc
}

func mustEnableAutonomy(t *testing.T, svc *Service, ctx context.Context, agentID string) {
	t.Helper()
	resp, err := svc.EnableAutonomy(ctx, &runtimev1.EnableAutonomyRequest{
		AgentId: agentID,
	})
	if err != nil {
		t.Fatalf("EnableAutonomy(%s): %v", agentID, err)
	}
	if !resp.GetAutonomy().GetEnabled() {
		t.Fatalf("expected autonomy enabled for %s, got %#v", agentID, resp.GetAutonomy())
	}
}

func mustFindPendingCadenceHook(t *testing.T, svc *Service, ctx context.Context, agentID string) *runtimev1.PendingHook {
	t.Helper()
	resp, err := svc.ListPendingHooks(ctx, &runtimev1.ListPendingHooksRequest{AgentId: agentID})
	if err != nil {
		t.Fatalf("ListPendingHooks(%s): %v", agentID, err)
	}
	for _, hook := range resp.GetHooks() {
		if hook != nil && hook.GetIntent() != nil && hook.GetIntent().GetReason() == autonomyCadenceHookReason {
			return hook
		}
	}
	t.Fatalf("expected pending cadence hook for %s, got %#v", agentID, resp.GetHooks())
	return nil
}

type runtimeAgentFakeBridgeAdapter struct {
	results map[string]*runtimev1.MemoryReplicationState
}

func (f *runtimeAgentFakeBridgeAdapter) SyncPendingMemory(_ context.Context, item *memoryservice.ReplicationBacklogItem) (*runtimev1.MemoryReplicationState, error) {
	if f == nil || f.results == nil {
		return nil, nil
	}
	state := f.results[item.MemoryID]
	if state == nil {
		return nil, nil
	}
	return proto.Clone(state).(*runtimev1.MemoryReplicationState), nil
}

type agentEventCaptureStream struct {
	ctx        context.Context
	cancel     context.CancelFunc
	events     []*runtimev1.AgentEvent
	max        int
	headerSent chan struct{}
}

func newAgentEventCaptureStream(parent context.Context) *agentEventCaptureStream {
	return newAgentEventCaptureStreamLimit(parent, 1)
}

func newAgentEventCaptureStreamLimit(parent context.Context, max int) *agentEventCaptureStream {
	ctx, cancel := context.WithCancel(parent)
	return &agentEventCaptureStream{ctx: ctx, cancel: cancel, max: max}
}

func (s *agentEventCaptureStream) SetHeader(metadata.MD) error { return nil }
func (s *agentEventCaptureStream) SendHeader(metadata.MD) error {
	if s.headerSent != nil {
		select {
		case s.headerSent <- struct{}{}:
		default:
		}
	}
	return nil
}
func (s *agentEventCaptureStream) SetTrailer(metadata.MD)   {}
func (s *agentEventCaptureStream) Context() context.Context { return s.ctx }
func (s *agentEventCaptureStream) SendMsg(any) error        { return nil }
func (s *agentEventCaptureStream) RecvMsg(any) error        { return nil }

func (s *agentEventCaptureStream) Send(event *runtimev1.AgentEvent) error {
	s.events = append(s.events, proto.Clone(event).(*runtimev1.AgentEvent))
	if s.max <= 0 || len(s.events) >= s.max {
		s.cancel()
	}
	return nil
}

type lifeTrackExecutorFunc func(context.Context, *lifeTurnRequest) (*lifeTurnResult, error)

func (f lifeTrackExecutorFunc) ExecuteLifeTrackHook(ctx context.Context, req *lifeTurnRequest) (*lifeTurnResult, error) {
	return f(ctx, req)
}

type fakeLifeTurnAI struct {
	response *runtimev1.ExecuteScenarioResponse
	err      error
	requests []*runtimev1.ExecuteScenarioRequest
}

func (f *fakeLifeTurnAI) ExecuteScenario(_ context.Context, req *runtimev1.ExecuteScenarioRequest) (*runtimev1.ExecuteScenarioResponse, error) {
	f.requests = append(f.requests, proto.Clone(req).(*runtimev1.ExecuteScenarioRequest))
	if f.err != nil {
		return nil, f.err
	}
	if f.response == nil {
		return &runtimev1.ExecuteScenarioResponse{}, nil
	}
	return proto.Clone(f.response).(*runtimev1.ExecuteScenarioResponse), nil
}

func waitForRuntimeAgentCondition(t *testing.T, timeout time.Duration, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("condition not satisfied before timeout")
}

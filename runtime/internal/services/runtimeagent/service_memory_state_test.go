package runtimeagent

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/proto"
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
		Context:     testRuntimeAgentIdentityContext("agent-feedback"),
		DisplayName: "Feedback Agent",
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	writeResp, err := svc.WriteAgentMemory(ctx, &runtimev1.WriteAgentMemoryRequest{
		Context: testRuntimeAgentIdentityContext("agent-feedback"),
		AgentId: "agent-feedback",
		Candidates: []*runtimev1.CanonicalMemoryCandidate{
			{
				CanonicalClass: runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_PUBLIC_SHARED,
				TargetBank: &runtimev1.MemoryBankLocator{
					Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
					Owner: &runtimev1.MemoryBankLocator_AgentCore{
						AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: testRuntimeAgentLocalRef("agent-feedback")},
					},
				},
				SourceEventId: "evt-feedback-1",
				Extensions:    completePromotionEvidence(t, svc),
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
						AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: testRuntimeAgentLocalRef("agent-feedback")},
					},
				},
				SourceEventId: "evt-feedback-2",
				Extensions:    completePromotionEvidence(t, svc),
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
		AgentID:    testRuntimeAgentLocalRef("agent-feedback"),
		TargetKind: "record",
		TargetID:   secondID,
		Polarity:   "helpful",
		QueryText:  "alpha",
	}); err != nil {
		t.Fatalf("RecordAgentMemoryRecallFeedback(helpful): %v", err)
	}
	if err := svc.RecordAgentMemoryRecallFeedback(ctx, AgentMemoryRecallFeedback{
		FeedbackID: "agent-feedback-unhelpful-1",
		AgentID:    testRuntimeAgentLocalRef("agent-feedback"),
		TargetKind: "record",
		TargetID:   firstID,
		Polarity:   "unhelpful",
		QueryText:  "alpha",
	}); err != nil {
		t.Fatalf("RecordAgentMemoryRecallFeedback(unhelpful): %v", err)
	}

	queryResp, err := svc.QueryAgentMemory(ctx, &runtimev1.QueryAgentMemoryRequest{
		Context:          testRuntimeAgentIdentityContext("agent-feedback"),
		AgentId:          "agent-feedback",
		Query:            "alpha",
		Limit:            10,
		CanonicalClasses: []runtimev1.MemoryCanonicalClass{runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_PUBLIC_SHARED},
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
		Context:     testRuntimeAgentIdentityContext("agent-feedback-boundary"),
		DisplayName: "Feedback Boundary Agent",
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	err = svc.RecordAgentMemoryRecallFeedback(ctx, AgentMemoryRecallFeedback{
		FeedbackID: "agent-feedback-boundary-1",
		AgentID:    testRuntimeAgentLocalRef("agent-feedback-boundary"),
		Bank: &runtimev1.MemoryBankLocator{
			Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
			Owner: &runtimev1.MemoryBankLocator_AgentCore{
				AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: testRuntimeAgentLocalRef("someone-else")},
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
	if secret := strings.TrimSpace(os.Getenv(sourceMaterializationHMACSecretEnv)); secret != "" {
		svc.SetSourceMaterializationPacketHMACSecret(secret)
	}
	closeRuntimeAgentServiceForTest(t, svc)
	return svc
}

func mustEnableAutonomy(t *testing.T, svc *Service, ctx context.Context, agentID string) {
	t.Helper()
	resp, err := svc.EnableAutonomy(ctx, &runtimev1.EnableAutonomyRequest{
		Context: testRuntimeAgentIdentityContext(agentID),
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
	resp, err := svc.ListPendingHooks(ctx, &runtimev1.ListPendingHooksRequest{
		Context: testRuntimeAgentIdentityContext(agentID), AgentId: agentID})
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

type agentVoiceStreamCaptureStream struct {
	ctx        context.Context
	cancel     context.CancelFunc
	events     []*runtimev1.AgentVoiceStreamEvent
	max        int
	headerSent chan struct{}
}

func newAgentVoiceStreamCaptureStreamLimit(parent context.Context, max int) *agentVoiceStreamCaptureStream {
	ctx, cancel := context.WithCancel(parent)
	return &agentVoiceStreamCaptureStream{ctx: ctx, cancel: cancel, max: max}
}

func (s *agentVoiceStreamCaptureStream) SetHeader(metadata.MD) error { return nil }
func (s *agentVoiceStreamCaptureStream) SendHeader(metadata.MD) error {
	if s.headerSent != nil {
		select {
		case s.headerSent <- struct{}{}:
		default:
		}
	}
	return nil
}
func (s *agentVoiceStreamCaptureStream) SetTrailer(metadata.MD)   {}
func (s *agentVoiceStreamCaptureStream) Context() context.Context { return s.ctx }
func (s *agentVoiceStreamCaptureStream) SendMsg(any) error        { return nil }
func (s *agentVoiceStreamCaptureStream) RecvMsg(any) error        { return nil }

func (s *agentVoiceStreamCaptureStream) Send(event *runtimev1.AgentVoiceStreamEvent) error {
	s.events = append(s.events, proto.Clone(event).(*runtimev1.AgentVoiceStreamEvent))
	if s.max > 0 && len(s.events) >= s.max {
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

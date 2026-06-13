package runtimeagent

import (
	"context"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type testRealmGroupMessageCandidateExecutor struct {
	output RealmGroupMessageCandidateExecutionOutput
	calls  int
}

type testRealmGroupMessageCandidateAI struct {
	t       *testing.T
	output  string
	traceID string
	calls   int
	inspect func(*runtimev1.ExecuteScenarioRequest)
}

type testRealmGroupMessageCandidateBindingResolver struct {
	modelID     string
	routePolicy runtimev1.RoutePolicy
	calls       int
	inspect     func(PublicChatBindingResolutionRequest)
}

func newRealmGroupMessageCandidateTestService(t *testing.T) *Service {
	t.Helper()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	svc.SetAuditStore(auditlog.New(128, 128))
	return svc
}

func (r *testRealmGroupMessageCandidateBindingResolver) ResolvePublicChatBinding(_ context.Context, req PublicChatBindingResolutionRequest) (PublicChatBindingResolution, error) {
	r.calls++
	if r.inspect != nil {
		r.inspect(req)
	}
	return PublicChatBindingResolution{
		ModelID:     strings.TrimSpace(r.modelID),
		RoutePolicy: r.routePolicy,
	}, nil
}

func (e *testRealmGroupMessageCandidateExecutor) CreateRealmGroupMessageCandidate(_ context.Context, input RealmGroupMessageCandidateExecutionInput) (RealmGroupMessageCandidateExecutionOutput, error) {
	e.calls++
	output := e.output
	if output.RuntimeTraceRef == "" {
		output.RuntimeTraceRef = "runtime-trace:" + input.CandidateID
	}
	if output.OutputCandidateRef == "" {
		output.OutputCandidateRef = input.OutputCandidateRef
	}
	if output.AuditLineageRef == "" {
		output.AuditLineageRef = input.AuditLineageRef
	}
	if output.PolicyVerdictRef == "" {
		output.PolicyVerdictRef = input.PolicyVerdictRef
	}
	if output.ProfileKind == "" {
		output.ProfileKind = "realm_group_agent"
	}
	if output.IdentitySource == "" {
		output.IdentitySource = "runtime_local_agent_identity"
	}
	if output.ParticipantRef == "" {
		output.ParticipantRef = input.LocalAgentRef
	}
	if len(output.ContextBlockRefs) == 0 {
		output.ContextBlockRefs = realmGroupCandidateContextBlockRefs(input.ContextRefs)
	}
	if output.OutputDestination == "" {
		output.OutputDestination = "realm_group_thread:" + input.RealmGroupThreadID
	}
	if output.MemoryReadVerdict == "" {
		output.MemoryReadVerdict = input.MemoryReadVerdict
	}
	if output.MemoryWriteVerdict == "" {
		output.MemoryWriteVerdict = input.MemoryWriteVerdict
	}
	if output.CapabilityScopeVerdict == "" {
		output.CapabilityScopeVerdict = input.CapabilityScopeVerdict
	}
	if output.AuditID == "" {
		output.AuditID = input.AuditID
	}
	return output, nil
}

func (e *testRealmGroupMessageCandidateAI) ExecuteScenario(_ context.Context, req *runtimev1.ExecuteScenarioRequest) (*runtimev1.ExecuteScenarioResponse, error) {
	e.calls++
	if e.inspect != nil {
		e.inspect(req)
	}
	return &runtimev1.ExecuteScenarioResponse{
		Output: &runtimev1.ScenarioOutput{
			Output: &runtimev1.ScenarioOutput_TextGenerate{
				TextGenerate: &runtimev1.TextGenerateOutput{Text: e.output},
			},
		},
		TraceId: e.traceID,
	}, nil
}

func TestRealmGroupMessageCandidateCreatesImmutableEvidence(t *testing.T) {
	svc := newRealmGroupMessageCandidateTestService(t)
	executor := &testRealmGroupMessageCandidateExecutor{
		output: RealmGroupMessageCandidateExecutionOutput{
			CommitDisposition: runtimev1.RealmGroupMessageCandidateCommitDisposition_REALM_GROUP_MESSAGE_CANDIDATE_COMMIT_DISPOSITION_MESSAGE_CANDIDATE,
			MessageType:       "TEXT",
			Body:              "hello from local agent",
		},
	}
	svc.SetRealmGroupMessageCandidateExecutor(executor)
	req := validRealmGroupMessageCandidateRequest("idem-1")

	resp, err := svc.CreateRealmGroupMessageCandidate(context.Background(), req)
	if err != nil {
		t.Fatalf("CreateRealmGroupMessageCandidate: %v", err)
	}
	candidate := resp.GetCandidate()
	if candidate.GetCandidateKind() != "REALM_GROUP_MESSAGE_CANDIDATE" {
		t.Fatalf("candidate kind = %q", candidate.GetCandidateKind())
	}
	if candidate.GetEvidenceHash() == "" || candidate.GetRuntimeTraceRef() == "" {
		t.Fatalf("candidate must return evidence hash and runtime trace ref: %+v", candidate)
	}
	if candidate.GetCommitDisposition() != runtimev1.RealmGroupMessageCandidateCommitDisposition_REALM_GROUP_MESSAGE_CANDIDATE_COMMIT_DISPOSITION_MESSAGE_CANDIDATE {
		t.Fatalf("unexpected disposition: %v", candidate.GetCommitDisposition())
	}

	evidenceResp, err := svc.GetRealmGroupMessageCandidateEvidence(context.Background(), &runtimev1.GetRealmGroupMessageCandidateEvidenceRequest{
		Context:                       req.GetContext(),
		CandidateId:                   candidate.GetCandidateId(),
		CandidateKind:                 candidate.GetCandidateKind(),
		CandidateEvidenceRef:          candidate.GetCandidateEvidenceRef(),
		EvidenceHash:                  candidate.GetEvidenceHash(),
		RuntimeTraceRef:               candidate.GetRuntimeTraceRef(),
		ExpectedRealmGroupAgentSlotId: req.GetRealmGroupAgentSlotId(),
		ExpectedLocalAgentRef:         req.GetLocalAgentRef(),
		TriggerRef:                    req.GetTriggerRef(),
		TargetRealmGroupThreadId:      req.GetRealmGroupThreadId(),
	})
	if err != nil {
		t.Fatalf("GetRealmGroupMessageCandidateEvidence: %v", err)
	}
	evidence := evidenceResp.GetEvidence()
	if evidence.GetBody() != "hello from local agent" {
		t.Fatalf("evidence body = %q", evidence.GetBody())
	}
	if evidence.GetBodyHash() != sha256Hex("hello from local agent") {
		t.Fatalf("body hash mismatch: %q", evidence.GetBodyHash())
	}
	if evidence.GetEvidenceHash() != candidate.GetEvidenceHash() {
		t.Fatalf("evidence hash mismatch: evidence=%q handle=%q", evidence.GetEvidenceHash(), candidate.GetEvidenceHash())
	}

	replay, err := svc.CreateRealmGroupMessageCandidate(context.Background(), req)
	if err != nil {
		t.Fatalf("Create replay: %v", err)
	}
	if replay.GetCandidate().GetCandidateId() != candidate.GetCandidateId() {
		t.Fatalf("idempotent replay candidate id = %q, want %q", replay.GetCandidate().GetCandidateId(), candidate.GetCandidateId())
	}
	if executor.calls != 1 {
		t.Fatalf("idempotent replay called executor %d times", executor.calls)
	}
}

func TestAIBackedRealmGroupMessageCandidateExecutorCreatesMessageEvidence(t *testing.T) {
	svc := newRealmGroupMessageCandidateTestService(t)
	ai := &testRealmGroupMessageCandidateAI{
		t:       t,
		output:  `<realm-group-message-candidate><message>Hello from the group agent.</message></realm-group-message-candidate>`,
		traceID: "trace-rgmc-1",
		inspect: func(req *runtimev1.ExecuteScenarioRequest) {
			if req.GetHead().GetAppId() != realmGroupMessageCandidateExecutorAppID {
				t.Fatalf("executor app id = %q", req.GetHead().GetAppId())
			}
			if req.GetHead().GetFallback() != runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY {
				t.Fatalf("expected fallback deny, got %v", req.GetHead().GetFallback())
			}
			if req.GetHead().GetModelId() != "realm-group-routing-model" {
				t.Fatalf("executor model id = %q", req.GetHead().GetModelId())
			}
			if req.GetHead().GetRoutePolicy() != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
				t.Fatalf("executor route policy = %v", req.GetHead().GetRoutePolicy())
			}
			spec := req.GetSpec().GetTextGenerate()
			if spec == nil {
				t.Fatal("expected text generate scenario spec")
			}
			if spec.GetSystemPrompt() == "" || spec.GetInput()[0].GetContent() == "" {
				t.Fatal("expected runtime-private prompt and typed context")
			}
			if containsAny(spec.GetSystemPrompt(), "runtime.agent.turn.request", "message_committed") {
				t.Fatalf("realm group candidate executor must not use public chat turn semantics: %q", spec.GetSystemPrompt())
			}
		},
	}
	binding := &testRealmGroupMessageCandidateBindingResolver{
		modelID:     "realm-group-routing-model",
		routePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		inspect: func(req PublicChatBindingResolutionRequest) {
			if req.ModelID != realmGroupMessageCandidateRoutingProfile {
				t.Fatalf("routing model token = %q", req.ModelID)
			}
			if req.SubjectUserID != "user-01" {
				t.Fatalf("routing subject = %q", req.SubjectUserID)
			}
		},
	}
	svc.SetRealmGroupMessageCandidateExecutor(NewAIBackedRealmGroupMessageCandidateExecutorWithBinding(ai, binding))
	req := validRealmGroupMessageCandidateRequestWithTypedRefs("idem-ai-message")
	resp, err := svc.CreateRealmGroupMessageCandidate(context.Background(), req)
	if err != nil {
		t.Fatalf("Create AI-backed candidate: %v", err)
	}
	if ai.calls != 1 {
		t.Fatalf("expected one AI execution call, got %d", ai.calls)
	}
	if binding.calls != 1 {
		t.Fatalf("expected one routing resolver call, got %d", binding.calls)
	}
	candidate := resp.GetCandidate()
	if candidate.GetRuntimeTraceRef() != "trace-rgmc-1" {
		t.Fatalf("runtime trace ref = %q", candidate.GetRuntimeTraceRef())
	}
	if candidate.GetCommitDisposition() != runtimev1.RealmGroupMessageCandidateCommitDisposition_REALM_GROUP_MESSAGE_CANDIDATE_COMMIT_DISPOSITION_MESSAGE_CANDIDATE {
		t.Fatalf("unexpected disposition: %v", candidate.GetCommitDisposition())
	}
	evidenceResp, err := svc.GetRealmGroupMessageCandidateEvidence(context.Background(), &runtimev1.GetRealmGroupMessageCandidateEvidenceRequest{
		Context:                       req.GetContext(),
		CandidateId:                   candidate.GetCandidateId(),
		CandidateKind:                 candidate.GetCandidateKind(),
		CandidateEvidenceRef:          candidate.GetCandidateEvidenceRef(),
		EvidenceHash:                  candidate.GetEvidenceHash(),
		RuntimeTraceRef:               candidate.GetRuntimeTraceRef(),
		ExpectedRealmGroupAgentSlotId: req.GetRealmGroupAgentSlotId(),
		ExpectedLocalAgentRef:         req.GetLocalAgentRef(),
		TriggerRef:                    req.GetTriggerRef(),
		TargetRealmGroupThreadId:      req.GetRealmGroupThreadId(),
	})
	if err != nil {
		t.Fatalf("Get AI-backed evidence: %v", err)
	}
	if got := evidenceResp.GetEvidence().GetBody(); got != "Hello from the group agent." {
		t.Fatalf("body = %q", got)
	}
	evidence := evidenceResp.GetEvidence()
	if evidence.GetMemoryReadVerdict() != realmGroupCandidateVerdictAllow {
		t.Fatalf("memory read verdict = %q", evidence.GetMemoryReadVerdict())
	}
	if evidence.GetMemoryWriteVerdict() != realmGroupCandidateVerdictDeny {
		t.Fatalf("memory write verdict = %q", evidence.GetMemoryWriteVerdict())
	}
	if evidence.GetCapabilityScopeVerdict() != realmGroupCandidateVerdictAllow {
		t.Fatalf("capability scope verdict = %q", evidence.GetCapabilityScopeVerdict())
	}
	auditEvents, err := svc.auditStore.ListEvents(&runtimev1.ListAuditEventsRequest{
		Domain:   realmGroupMessageCandidateAuditDomain,
		PageSize: 10,
	})
	if err != nil {
		t.Fatalf("ListEvents: %v", err)
	}
	if len(auditEvents.GetEvents()) != 1 {
		t.Fatalf("audit event count = %d", len(auditEvents.GetEvents()))
	}
	if auditEvents.GetEvents()[0].GetAuditId() != evidence.GetAuditId() {
		t.Fatalf("audit id mismatch: event=%q evidence=%q", auditEvents.GetEvents()[0].GetAuditId(), evidence.GetAuditId())
	}
}

func TestAIBackedRealmGroupMessageCandidateExecutorCreatesRefusalEvidence(t *testing.T) {
	svc := newRealmGroupMessageCandidateTestService(t)
	svc.SetRealmGroupMessageCandidateExecutor(NewAIBackedRealmGroupMessageCandidateExecutorWithBinding(&testRealmGroupMessageCandidateAI{
		t:       t,
		output:  `<realm-group-message-candidate><refusal code="insufficient_context">Realm context refs are insufficient.</refusal></realm-group-message-candidate>`,
		traceID: "trace-rgmc-refusal",
	}, &testRealmGroupMessageCandidateBindingResolver{modelID: "realm-group-routing-model", routePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL}))
	req := validRealmGroupMessageCandidateRequestWithTypedRefs("idem-ai-refusal")
	resp, err := svc.CreateRealmGroupMessageCandidate(context.Background(), req)
	if err != nil {
		t.Fatalf("Create AI-backed refusal: %v", err)
	}
	candidate := resp.GetCandidate()
	if candidate.GetCommitDisposition() != runtimev1.RealmGroupMessageCandidateCommitDisposition_REALM_GROUP_MESSAGE_CANDIDATE_COMMIT_DISPOSITION_REFUSAL_CANDIDATE {
		t.Fatalf("unexpected disposition: %v", candidate.GetCommitDisposition())
	}
	evidenceResp, err := svc.GetRealmGroupMessageCandidateEvidence(context.Background(), &runtimev1.GetRealmGroupMessageCandidateEvidenceRequest{
		Context:                       req.GetContext(),
		CandidateId:                   candidate.GetCandidateId(),
		CandidateKind:                 candidate.GetCandidateKind(),
		CandidateEvidenceRef:          candidate.GetCandidateEvidenceRef(),
		EvidenceHash:                  candidate.GetEvidenceHash(),
		RuntimeTraceRef:               candidate.GetRuntimeTraceRef(),
		ExpectedRealmGroupAgentSlotId: req.GetRealmGroupAgentSlotId(),
		ExpectedLocalAgentRef:         req.GetLocalAgentRef(),
		TriggerRef:                    req.GetTriggerRef(),
		TargetRealmGroupThreadId:      req.GetRealmGroupThreadId(),
	})
	if err != nil {
		t.Fatalf("Get AI-backed refusal evidence: %v", err)
	}
	if evidenceResp.GetEvidence().GetRefusalCode() != "insufficient_context" {
		t.Fatalf("refusal code = %q", evidenceResp.GetEvidence().GetRefusalCode())
	}
	if evidenceResp.GetEvidence().GetRefusalHash() != sha256Hex("Realm context refs are insufficient.") {
		t.Fatalf("refusal hash = %q", evidenceResp.GetEvidence().GetRefusalHash())
	}
}

func TestAIBackedRealmGroupMessageCandidateExecutorFailsClosed(t *testing.T) {
	svc := newRealmGroupMessageCandidateTestService(t)
	svc.SetRealmGroupMessageCandidateExecutor(NewAIBackedRealmGroupMessageCandidateExecutorWithBinding(&testRealmGroupMessageCandidateAI{
		t:      t,
		output: `<realm-group-message-candidate><message>hello</message></realm-group-message-candidate>`,
	}, &testRealmGroupMessageCandidateBindingResolver{modelID: "realm-group-routing-model", routePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL}))
	missingTypedRefsReq := validRealmGroupMessageCandidateRequest("idem-ai-missing-refs")
	missingTypedRefsReq.ContextRefs = nil
	if _, err := svc.CreateRealmGroupMessageCandidate(context.Background(), missingTypedRefsReq); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument for missing typed refs, got %v", err)
	}

	svc.SetRealmGroupMessageCandidateExecutor(NewAIBackedRealmGroupMessageCandidateExecutorWithBinding(&testRealmGroupMessageCandidateAI{
		t:       t,
		output:  `plain text is not admitted`,
		traceID: "trace-rgmc-invalid-output",
	}, &testRealmGroupMessageCandidateBindingResolver{modelID: "realm-group-routing-model", routePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL}))
	if _, err := svc.CreateRealmGroupMessageCandidate(context.Background(), validRealmGroupMessageCandidateRequestWithTypedRefs("idem-ai-invalid-output")); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument for invalid APML output, got %v", err)
	}

	svc.SetRealmGroupMessageCandidateExecutor(NewAIBackedRealmGroupMessageCandidateExecutorWithBinding(&testRealmGroupMessageCandidateAI{
		t:      t,
		output: `<realm-group-message-candidate><message>hello</message></realm-group-message-candidate>`,
	}, &testRealmGroupMessageCandidateBindingResolver{modelID: "realm-group-routing-model", routePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL}))
	if _, err := svc.CreateRealmGroupMessageCandidate(context.Background(), validRealmGroupMessageCandidateRequestWithTypedRefs("idem-ai-missing-trace")); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument for missing runtime trace, got %v", err)
	}

	rawContextReq := validRealmGroupMessageCandidateRequestWithTypedRefs("idem-ai-raw-context-ref")
	rawContextReq.ContextRefs[realmGroupCandidateContextRecentMessages] = `<message>caller owned transcript</message>`
	if _, err := svc.CreateRealmGroupMessageCandidate(context.Background(), rawContextReq); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument for raw context ref content, got %v", err)
	}

	rawTopLevelRefReq := validRealmGroupMessageCandidateRequestWithTypedRefs("idem-ai-raw-trigger-ref")
	rawTopLevelRefReq.TriggerRef = "please answer this group message"
	if _, err := svc.CreateRealmGroupMessageCandidate(context.Background(), rawTopLevelRefReq); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument for raw top-level ref content, got %v", err)
	}

	realmOwnedOrchestrationReq := validRealmGroupMessageCandidateRequestWithTypedRefs("idem-ai-realm-owned-orchestration")
	realmOwnedOrchestrationReq.RoomOrchestrationRef = "realm://group-chats/chat-01/orchestration/current"
	if _, err := svc.CreateRealmGroupMessageCandidate(context.Background(), realmOwnedOrchestrationReq); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument for realm-owned room orchestration ref, got %v", err)
	}

	rawLocalAgentRefReq := validRealmGroupMessageCandidateRequestWithTypedRefs("idem-ai-raw-local-agent-ref")
	rawLocalAgentRefReq.Context.SubjectUserId = "user-01<message>"
	rawLocalAgentRefReq.OwnerUserId = "user-01<message>"
	rawLocalAgentRefReq.LocalAgentRef = "local-agent:user-01<message>:agent-01"
	if _, err := svc.CreateRealmGroupMessageCandidate(context.Background(), rawLocalAgentRefReq); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument for raw local agent ref content, got %v", err)
	}

	oversizedLocalAgentRefReq := validRealmGroupMessageCandidateRequestWithTypedRefs("idem-ai-oversized-local-agent-ref")
	oversizedOwnerID := strings.Repeat("u", realmGroupMessageCandidateRefMaxBytes)
	oversizedLocalAgentRefReq.Context.SubjectUserId = oversizedOwnerID
	oversizedLocalAgentRefReq.OwnerUserId = oversizedOwnerID
	oversizedLocalAgentRefReq.LocalAgentRef = "local-agent:" + oversizedOwnerID + ":agent-01"
	if _, err := svc.CreateRealmGroupMessageCandidate(context.Background(), oversizedLocalAgentRefReq); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument for oversized local agent ref, got %v", err)
	}

	svc.SetRealmGroupMessageCandidateExecutor(NewAIBackedRealmGroupMessageCandidateExecutor(&testRealmGroupMessageCandidateAI{
		t:       t,
		output:  `<realm-group-message-candidate><message>hello</message></realm-group-message-candidate>`,
		traceID: "trace-rgmc-no-routing",
	}))
	if _, err := svc.CreateRealmGroupMessageCandidate(context.Background(), validRealmGroupMessageCandidateRequestWithTypedRefs("idem-ai-no-routing-resolver")); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected FailedPrecondition without routing resolver, got %v", err)
	}
}

func TestRealmGroupMessageCandidateRefusalHashMatchesRealm(t *testing.T) {
	svc := newRealmGroupMessageCandidateTestService(t)
	svc.SetRealmGroupMessageCandidateExecutor(&testRealmGroupMessageCandidateExecutor{
		output: RealmGroupMessageCandidateExecutionOutput{
			CommitDisposition: runtimev1.RealmGroupMessageCandidateCommitDisposition_REALM_GROUP_MESSAGE_CANDIDATE_COMMIT_DISPOSITION_REFUSAL_CANDIDATE,
			RefusalCode:       "policy_refusal",
			RefusalReason:     "policy denied this response",
		},
	})
	req := validRealmGroupMessageCandidateRequest("idem-refusal")
	resp, err := svc.CreateRealmGroupMessageCandidate(context.Background(), req)
	if err != nil {
		t.Fatalf("Create refusal: %v", err)
	}
	evidenceResp, err := svc.GetRealmGroupMessageCandidateEvidence(context.Background(), &runtimev1.GetRealmGroupMessageCandidateEvidenceRequest{
		Context:                       req.GetContext(),
		CandidateId:                   resp.GetCandidate().GetCandidateId(),
		CandidateKind:                 resp.GetCandidate().GetCandidateKind(),
		CandidateEvidenceRef:          resp.GetCandidate().GetCandidateEvidenceRef(),
		EvidenceHash:                  resp.GetCandidate().GetEvidenceHash(),
		RuntimeTraceRef:               resp.GetCandidate().GetRuntimeTraceRef(),
		ExpectedRealmGroupAgentSlotId: req.GetRealmGroupAgentSlotId(),
		ExpectedLocalAgentRef:         req.GetLocalAgentRef(),
		TriggerRef:                    req.GetTriggerRef(),
		TargetRealmGroupThreadId:      req.GetRealmGroupThreadId(),
	})
	if err != nil {
		t.Fatalf("Get refusal evidence: %v", err)
	}
	if got := evidenceResp.GetEvidence().GetRefusalHash(); got != sha256Hex("policy denied this response") {
		t.Fatalf("refusal hash = %q", got)
	}
}

func TestRealmGroupMessageCandidateFailsClosed(t *testing.T) {
	svc := newRealmGroupMessageCandidateTestService(t)
	if _, err := svc.CreateRealmGroupMessageCandidate(context.Background(), validRealmGroupMessageCandidateRequest("idem-missing-executor")); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected FailedPrecondition without executor, got %v", err)
	}

	noAuditSvc := newRuntimeAgentServiceForPublicChatTest(t)
	noAuditExecutor := &testRealmGroupMessageCandidateExecutor{
		output: RealmGroupMessageCandidateExecutionOutput{
			CommitDisposition: runtimev1.RealmGroupMessageCandidateCommitDisposition_REALM_GROUP_MESSAGE_CANDIDATE_COMMIT_DISPOSITION_MESSAGE_CANDIDATE,
			MessageType:       "TEXT",
			Body:              "must not execute",
		},
	}
	noAuditSvc.SetRealmGroupMessageCandidateExecutor(noAuditExecutor)
	if _, err := noAuditSvc.CreateRealmGroupMessageCandidate(context.Background(), validRealmGroupMessageCandidateRequest("idem-missing-audit-store")); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected FailedPrecondition without audit store, got %v", err)
	}
	if noAuditExecutor.calls != 0 {
		t.Fatalf("executor called without audit store: %d", noAuditExecutor.calls)
	}

	svc.SetRealmGroupMessageCandidateExecutor(&testRealmGroupMessageCandidateExecutor{
		output: RealmGroupMessageCandidateExecutionOutput{
			CommitDisposition: runtimev1.RealmGroupMessageCandidateCommitDisposition_REALM_GROUP_MESSAGE_CANDIDATE_COMMIT_DISPOSITION_MESSAGE_CANDIDATE,
			MessageType:       "TEXT",
			Body:              "hello",
			ExpiresAt:         time.Now().UTC().Add(time.Minute),
		},
	})
	req := validRealmGroupMessageCandidateRequest("idem-mismatch")
	resp, err := svc.CreateRealmGroupMessageCandidate(context.Background(), req)
	if err != nil {
		t.Fatalf("Create candidate: %v", err)
	}
	_, err = svc.GetRealmGroupMessageCandidateEvidence(context.Background(), &runtimev1.GetRealmGroupMessageCandidateEvidenceRequest{
		Context:                       req.GetContext(),
		CandidateId:                   resp.GetCandidate().GetCandidateId(),
		CandidateKind:                 resp.GetCandidate().GetCandidateKind(),
		CandidateEvidenceRef:          resp.GetCandidate().GetCandidateEvidenceRef(),
		EvidenceHash:                  resp.GetCandidate().GetEvidenceHash(),
		RuntimeTraceRef:               resp.GetCandidate().GetRuntimeTraceRef(),
		ExpectedRealmGroupAgentSlotId: req.GetRealmGroupAgentSlotId(),
		ExpectedLocalAgentRef:         "local-agent:user-other:agent-01",
		TriggerRef:                    req.GetTriggerRef(),
		TargetRealmGroupThreadId:      req.GetRealmGroupThreadId(),
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument for local agent mismatch, got %v", err)
	}

	wrongContext := &runtimev1.AgentRequestContext{AppId: "realm", SubjectUserId: "user-other"}
	_, err = svc.GetRealmGroupMessageCandidateEvidence(context.Background(), &runtimev1.GetRealmGroupMessageCandidateEvidenceRequest{
		Context:                       wrongContext,
		CandidateId:                   resp.GetCandidate().GetCandidateId(),
		CandidateKind:                 resp.GetCandidate().GetCandidateKind(),
		CandidateEvidenceRef:          resp.GetCandidate().GetCandidateEvidenceRef(),
		EvidenceHash:                  resp.GetCandidate().GetEvidenceHash(),
		RuntimeTraceRef:               resp.GetCandidate().GetRuntimeTraceRef(),
		ExpectedRealmGroupAgentSlotId: req.GetRealmGroupAgentSlotId(),
		ExpectedLocalAgentRef:         req.GetLocalAgentRef(),
		TriggerRef:                    req.GetTriggerRef(),
		TargetRealmGroupThreadId:      req.GetRealmGroupThreadId(),
	})
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("expected PermissionDenied for mismatched evidence context, got %v", err)
	}
}

func TestRealmGroupMessageCandidateRejectsBoundedRefsWithoutAuthorityEvidenceClass(t *testing.T) {
	svc := newRealmGroupMessageCandidateTestService(t)
	executor := &testRealmGroupMessageCandidateExecutor{
		output: RealmGroupMessageCandidateExecutionOutput{
			CommitDisposition: runtimev1.RealmGroupMessageCandidateCommitDisposition_REALM_GROUP_MESSAGE_CANDIDATE_COMMIT_DISPOSITION_MESSAGE_CANDIDATE,
			MessageType:       "TEXT",
			Body:              "must not execute",
		},
	}
	svc.SetRealmGroupMessageCandidateExecutor(executor)

	cases := []struct {
		name   string
		mutate func(*runtimev1.CreateRealmGroupMessageCandidateRequest)
	}{
		{
			name: "trigger_ref_without_admitted_trigger_class",
			mutate: func(req *runtimev1.CreateRealmGroupMessageCandidateRequest) {
				req.TriggerRef = "realm://group-chats/chat-01/triggers/message-01"
			},
		},
		{
			name: "membership_snapshot_ref_without_membership_snapshot_class",
			mutate: func(req *runtimev1.CreateRealmGroupMessageCandidateRequest) {
				req.MembershipSnapshotRef = "runtime-context://realm-group/chat-01/context/current"
			},
		},
		{
			name: "read_cursor_ref_without_read_cursor_class",
			mutate: func(req *runtimev1.CreateRealmGroupMessageCandidateRequest) {
				req.ReadCursorRef = "runtime-context://realm-group/chat-01/context/user-01"
			},
		},
		{
			name: "context_ref_without_typed_evidence_class",
			mutate: func(req *runtimev1.CreateRealmGroupMessageCandidateRequest) {
				req.ContextRefs[realmGroupCandidateContextRecentMessages] = "runtime-context://realm-group/chat-01/context/current"
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := validRealmGroupMessageCandidateRequestWithTypedRefs("idem-" + tc.name)
			tc.mutate(req)
			if _, err := svc.CreateRealmGroupMessageCandidate(context.Background(), req); status.Code(err) != codes.InvalidArgument {
				t.Fatalf("expected InvalidArgument, got %v", err)
			}
		})
	}
	if executor.calls != 0 {
		t.Fatalf("authority evidence rejection must happen before executor dispatch, calls=%d", executor.calls)
	}
}

func validRealmGroupMessageCandidateRequestWithTypedRefs(idempotencyKey string) *runtimev1.CreateRealmGroupMessageCandidateRequest {
	req := validRealmGroupMessageCandidateRequest(idempotencyKey)
	return req
}

func containsAny(value string, needles ...string) bool {
	for _, needle := range needles {
		if strings.Contains(value, needle) {
			return true
		}
	}
	return false
}

func validRealmGroupMessageCandidateRequest(idempotencyKey string) *runtimev1.CreateRealmGroupMessageCandidateRequest {
	return &runtimev1.CreateRealmGroupMessageCandidateRequest{
		Context: &runtimev1.AgentRequestContext{
			AppId:         "realm",
			SubjectUserId: "user-01",
		},
		RealmGroupThreadId:    "chat-01",
		RealmGroupAgentSlotId: "slot-01",
		OwnerUserId:           "user-01",
		RealmAgentId:          "agent-01",
		LocalAgentRef:         "local-agent:user-01:agent-01",
		TriggerRef:            "runtime://room-orchestration/realm-group/chat-01/trigger-event/canonical_user_turn/message-01",
		MembershipSnapshotRef: "runtime-context://realm-group/chat-01/membership-snapshots/current",
		ReadCursorRef:         "runtime-context://realm-group/chat-01/read-cursors/user-01",
		RoomOrchestrationRef:  "runtime://realm-group/chat-01/orchestration/current",
		IdempotencyKey:        idempotencyKey,
		ContextRefs: map[string]string{
			realmGroupCandidateContextThreadSnapshot: "runtime-context://realm-group/chat-01/thread",
			realmGroupCandidateContextSlotSnapshot:   "runtime-context://realm-group/chat-01/slot-01",
			realmGroupCandidateContextRecentMessages: "runtime-context://realm-group/chat-01/recent-messages",
			realmGroupCandidateContextPolicy:         "runtime-context://realm-group/chat-01/policy",
		},
	}
}

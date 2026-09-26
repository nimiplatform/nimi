package runtimeagent

import (
	"context"
	"errors"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	localAppWorkExecutionTimeout = 30 * time.Minute
	localAppWorkToolTimeout      = 5 * time.Minute
	localAppWorkResultRetention  = 15 * time.Minute
	localAppWorkMaxRetained      = 256
	localAppWorkMaxEvents        = 512
	localAppWorkMaxEventBytes    = 512 * 1024
)

type localAppWorkExecution struct {
	input       *runtimev1.LocalAppAgentWorkInput
	owner       localAppAgentIdentity
	ingress     context.Context
	ctx         context.Context
	cancel      context.CancelFunc
	agentHandle string
	requestID   string
	prompt      string
	tools       []*runtimev1.ToolSpec
	rounds      int
	// Mutable execution projection, pending call, and events use chatSurfaceMu.
	snapshot   *runtimev1.LocalAppAgentWorkExecution
	pending    *localAppWorkCall
	events     []*runtimev1.LocalAppAgentWorkEvent
	eventBytes int
	changed    chan struct{}
	terminalAt time.Time
}

type localAppWorkCall struct {
	call      *runtimev1.LocalAppAgentWorkToolCall
	modelCall *runtimev1.ToolCall
	result    chan *runtimev1.ToolResult
	submitted bool
}

func sameLocalAppWorkOwner(a, b localAppAgentIdentity) bool {
	return a.decision.AccountID == b.decision.AccountID && a.decision.RegisteredAppSubject == b.decision.RegisteredAppSubject && a.decision.SessionID == b.decision.SessionID && a.identity.LocalAgentRef == b.identity.LocalAgentRef
}

// @nimi-authority: rule.nimi.runtime.agent-participation.app-work
func (s *Service) ListLocalAppAgentWorkReferences(ctx context.Context, _ *runtimev1.ListLocalAppAgentWorkReferencesRequest) (*runtimev1.ListLocalAppAgentWorkReferencesResponse, error) {
	decision, ok := authorizedLocalAppAgentDecision(ctx, localappop.OperationAgentWorkReferenceList)
	if !ok {
		return nil, localAppAgentAccessDenied()
	}
	inventory, err := s.ListOwnedActiveLocalAgents(ctx, decision.AccountID)
	if err != nil {
		return nil, localAppConversationOwnerUnavailable()
	}
	references, ok := projectLocalAppAgentReferencesForOperation(decision, inventory, localappop.OperationAgentWorkReferenceList)
	if !ok {
		return nil, localAppConversationOwnerUnavailable()
	}
	out := &runtimev1.ListLocalAppAgentWorkReferencesResponse{}
	for _, ref := range references {
		out.References = append(out.References, &runtimev1.LocalAppAgentWorkReference{AgentHandle: ref.AgentHandle, AgentBinding: ref.AgentBinding, DisplayName: ref.DisplayName, AvatarUrl: ref.AvatarUrl, ActivityAgentRef: ref.ActivityAgentRef})
	}
	return out, nil
}

// @nimi-authority: rule.nimi.runtime.agent-participation.shared-execution-admission
// Both admission paths use the same mutex; no Conversation state is created
// merely to claim an Agent for App business work.
func (s *Service) localAgentExecutionBusyLocked(agentID string) bool {
	if id := s.chatActiveByAgent[agentID]; id != "" {
		if s.chatTurns[id] != nil {
			return true
		}
		delete(s.chatActiveByAgent, agentID)
	}
	return s.localAppWorkActiveByAgent[agentID] != ""
}

func (s *Service) StartLocalAppAgentWork(ctx context.Context, req *runtimev1.StartLocalAppAgentWorkRequest) (*runtimev1.StartLocalAppAgentWorkResponse, error) {
	if req == nil || len(req.ProtoReflect().GetUnknown()) != 0 || !validLocalAppConversationText(req.GetRequestId(), 256, false) || !validLocalAppConversationText(req.GetPrompt(), 16384, true) {
		return nil, localAppConversationInvalid("App work request is invalid")
	}
	payload, err := protojson.Marshal(req)
	if err != nil || len(payload) > 65536 {
		return nil, localAppConversationInvalid("App work exceeds 64 KiB")
	}
	owner, ownerCtx, err := s.resolveLocalAppAgent(ctx, localappop.OperationAgentWorkStart, req.GetAgentHandle())
	if err != nil {
		return nil, err
	}
	if s.isClosed() || s.localAppIngressRevalidator == nil || !s.HasPublicChatTurnExecutor() || !s.HasPublicChatBindingResolver() {
		return nil, localAppConversationOwnerUnavailable()
	}
	work, err := admitLocalAppWork(ctx, owner, req.GetWork())
	if err != nil {
		return nil, err
	}
	work.agentHandle, work.requestID, work.prompt = req.GetAgentHandle(), req.GetRequestId(), req.GetPrompt()
	s.chatSurfaceMu.Lock()
	busy := s.localAgentExecutionBusyLocked(owner.identity.LocalAgentRef)
	s.chatSurfaceMu.Unlock()
	if busy {
		return nil, grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_AGENT_BUSY)
	}
	// Resolve captured model policy through the same owner as canonical chat.
	// Work does not inherit the optional image action or chat projection state.
	bindings, _, release, err := s.resolveExecutionBindingsFromConfig(ownerCtx, owner.identity.LocalAgentRef, owner.decision.AccountID, publicChatTurnRequestPayload{Messages: []publicChatMessagePayload{{Role: "user", Content: req.GetPrompt()}}, MaxOutputTokens: 4096})
	if err != nil {
		return nil, err
	}
	claimed := false
	defer func() {
		if !claimed && release != nil {
			release()
		}
	}()
	executionCtx, cancel := context.WithTimeout(context.WithoutCancel(ownerCtx), localAppWorkExecutionTimeout)
	work.ctx, work.cancel, work.ingress = executionCtx, cancel, executionCtx
	s.chatSurfaceMu.Lock()
	s.pruneLocalAppWorkLocked()
	if s.isClosed() || s.agentTerminationFencedLocked(owner.identity.LocalAgentRef) {
		s.chatSurfaceMu.Unlock()
		cancel()
		return nil, localAppConversationOwnerUnavailable()
	}
	if s.localAgentExecutionBusyLocked(owner.identity.LocalAgentRef) {
		s.chatSurfaceMu.Unlock()
		cancel()
		return nil, grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_AGENT_BUSY)
	}
	if len(s.localAppWorkExecutions) >= localAppWorkMaxRetained {
		s.chatSurfaceMu.Unlock()
		cancel()
		return nil, grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_LOCAL_APP_OWNER_UNAVAILABLE)
	}
	if s.localAppWorkExecutions == nil {
		s.localAppWorkExecutions = map[string]*localAppWorkExecution{}
	}
	if s.localAppWorkActiveByAgent == nil {
		s.localAppWorkActiveByAgent = map[string]string{}
	}
	id := "agent_work_" + ulid.Make().String()
	work.snapshot = &runtimev1.LocalAppAgentWorkExecution{ExecutionId: id, WorkId: work.input.GetWorkId(), State: runtimev1.LocalAppAgentWorkState_LOCAL_APP_AGENT_WORK_STATE_RUNNING}
	work.changed = make(chan struct{})
	s.localAppWorkExecutions[id] = work
	s.localAppWorkActiveByAgent[owner.identity.LocalAgentRef] = id
	s.publishLocalAppWorkSnapshotLocked(work)
	s.chatSurfaceMu.Unlock()
	if !s.startPublicChatAsync(func() { s.runLocalAppWork(work, bindings[runtimeAgentAIConfigCapabilityTextGenerate], release) }) {
		s.chatSurfaceMu.Lock()
		delete(s.localAppWorkExecutions, id)
		delete(s.localAppWorkActiveByAgent, owner.identity.LocalAgentRef)
		s.chatSurfaceMu.Unlock()
		cancel()
		return nil, localAppConversationOwnerUnavailable()
	}
	claimed = true
	return &runtimev1.StartLocalAppAgentWorkResponse{ExecutionId: id}, nil
}

func (s *Service) GetLocalAppAgentWork(ctx context.Context, req *runtimev1.GetLocalAppAgentWorkRequest) (*runtimev1.GetLocalAppAgentWorkResponse, error) {
	owner, err := s.authorizeLocalAppWork(ctx, localappop.OperationAgentWorkGet, req.GetAgentHandle(), req.GetExecutionId())
	if err != nil {
		return nil, err
	}
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	work, err := s.localAppWorkForOwnerLocked(owner, req.GetExecutionId())
	if err != nil {
		return nil, err
	}
	return &runtimev1.GetLocalAppAgentWorkResponse{Execution: cloneLocalAppWorkSnapshot(work)}, nil
}

func (s *Service) GetLocalAppAgentWorkStatus(ctx context.Context, req *runtimev1.GetLocalAppAgentWorkStatusRequest) (*runtimev1.GetLocalAppAgentWorkStatusResponse, error) {
	owner, _, err := s.resolveLocalAppAgent(ctx, localappop.OperationAgentWorkStatusGet, req.GetAgentHandle())
	if err != nil {
		return nil, err
	}
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	if s.agentTerminationFencedLocked(owner.identity.LocalAgentRef) {
		return nil, localAppConversationOwnerUnavailable()
	}
	out := &runtimev1.GetLocalAppAgentWorkStatusResponse{Busy: s.localAgentExecutionBusyLocked(owner.identity.LocalAgentRef)}
	if id := s.localAppWorkActiveByAgent[owner.identity.LocalAgentRef]; id != "" {
		if work := s.localAppWorkExecutions[id]; work != nil && sameLocalAppWorkOwner(work.owner, owner) {
			out.OwnExecutionId = &id
		}
	}
	return out, nil
}

func (s *Service) ListLocalAppAgentWorkToolCalls(ctx context.Context, req *runtimev1.ListLocalAppAgentWorkToolCallsRequest) (*runtimev1.ListLocalAppAgentWorkToolCallsResponse, error) {
	owner, err := s.authorizeLocalAppWork(ctx, localappop.OperationAgentWorkToolCallsList, req.GetAgentHandle(), req.GetExecutionId())
	if err != nil {
		return nil, err
	}
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	work, err := s.localAppWorkForOwnerLocked(owner, req.GetExecutionId())
	if err != nil {
		return nil, err
	}
	out := &runtimev1.ListLocalAppAgentWorkToolCallsResponse{}
	if work.ctx.Err() == nil && !localAppWorkTerminal(work.snapshot.State) && work.pending != nil && !work.pending.submitted {
		out.Calls = append(out.Calls, proto.Clone(work.pending.call).(*runtimev1.LocalAppAgentWorkToolCall))
	}
	return out, nil
}

func (s *Service) SubmitLocalAppAgentWorkToolResult(ctx context.Context, req *runtimev1.SubmitLocalAppAgentWorkToolResultRequest) (*runtimev1.SubmitLocalAppAgentWorkToolResultResponse, error) {
	if req == nil || !validLocalAppConversationSelector(req.GetCallId()) || len(req.GetResultJson()) > 32768 {
		return nil, localAppConversationInvalid("App tool result is invalid")
	}
	value := &structpb.Value{}
	if err := protojson.Unmarshal([]byte(req.GetResultJson()), value); err != nil {
		return nil, localAppConversationInvalid("App tool result must contain one JSON value")
	}
	owner, err := s.authorizeLocalAppWork(ctx, localappop.OperationAgentWorkToolResultSubmit, req.GetAgentHandle(), req.GetExecutionId())
	if err != nil {
		return nil, err
	}
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	work, err := s.localAppWorkForOwnerLocked(owner, req.GetExecutionId())
	if err != nil {
		return nil, err
	}
	pending := work.pending
	if work.ctx.Err() != nil || localAppWorkTerminal(work.snapshot.State) || pending == nil || pending.submitted || pending.call.GetCallId() != req.GetCallId() {
		return nil, localAppAgentAccessDenied()
	}
	pending.submitted = true
	pending.result <- &runtimev1.ToolResult{ToolCallId: pending.modelCall.GetId(), ToolName: pending.modelCall.GetName(), Result: value, IsError: req.GetIsError()}
	return &runtimev1.SubmitLocalAppAgentWorkToolResultResponse{CallId: req.GetCallId()}, nil
}

func (s *Service) CancelLocalAppAgentWork(ctx context.Context, req *runtimev1.CancelLocalAppAgentWorkRequest) (*runtimev1.CancelLocalAppAgentWorkResponse, error) {
	owner, err := s.authorizeLocalAppWork(ctx, localappop.OperationAgentWorkCancel, req.GetAgentHandle(), req.GetExecutionId())
	if err != nil {
		return nil, err
	}
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	work, err := s.localAppWorkForOwnerLocked(owner, req.GetExecutionId())
	if err != nil {
		return nil, err
	}
	if !localAppWorkTerminal(work.snapshot.State) {
		s.terminalizeLocalAppWorkLocked(work, runtimev1.LocalAppAgentWorkState_LOCAL_APP_AGENT_WORK_STATE_CANCELLED, "", runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED)
		work.cancel()
	}
	return &runtimev1.CancelLocalAppAgentWorkResponse{Execution: cloneLocalAppWorkSnapshot(work)}, nil
}

func (s *Service) SubscribeLocalAppAgentWorkEvents(req *runtimev1.SubscribeLocalAppAgentWorkEventsRequest, stream grpc.ServerStreamingServer[runtimev1.LocalAppAgentWorkEvent]) error {
	ctx := stream.Context()
	owner, err := s.authorizeLocalAppWork(ctx, localappop.OperationAgentWorkEventsSubscribe, req.GetAgentHandle(), req.GetExecutionId())
	if err != nil {
		return err
	}
	sequence := req.GetAfterSequence()
	ticker := time.NewTicker(localAppConversationRevalidationInterval)
	defer ticker.Stop()
	for {
		s.chatSurfaceMu.Lock()
		work, err := s.localAppWorkForOwnerLocked(owner, req.GetExecutionId())
		if err != nil {
			s.chatSurfaceMu.Unlock()
			return err
		}
		if sequence > work.snapshot.Sequence {
			s.chatSurfaceMu.Unlock()
			return localAppConversationInvalid("App work event cursor is invalid")
		}
		var events []*runtimev1.LocalAppAgentWorkEvent
		if len(work.events) > 0 && sequence+1 < work.events[0].GetSequence() {
			s.chatSurfaceMu.Unlock()
			return grpcerr.WithReasonCode(codes.OutOfRange, runtimev1.ReasonCode_LOCAL_APP_RECORD_NOT_FOUND)
		}
		for _, event := range work.events {
			if event.Sequence > sequence {
				events = append(events, proto.Clone(event).(*runtimev1.LocalAppAgentWorkEvent))
			}
		}
		done, changed := localAppWorkTerminal(work.snapshot.State), work.changed
		s.chatSurfaceMu.Unlock()
		for _, event := range events {
			if err := s.revalidateLocalAppWorkSubscriber(ctx, owner, req.GetAgentHandle()); err != nil {
				return err
			}
			if err := stream.Send(event); err != nil {
				return err
			}
			sequence = event.Sequence
		}
		if done {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-owner.decision.SessionInvalidated:
			return localAppAgentAccessDenied()
		case <-changed:
		case <-ticker.C:
			if err := s.revalidateLocalAppWorkSubscriber(ctx, owner, req.GetAgentHandle()); err != nil {
				return err
			}
		}
	}
}

func (s *Service) authorizeLocalAppWork(ctx context.Context, operation localappop.Operation, handle, id string) (localAppAgentIdentity, error) {
	if !validLocalAppConversationSelector(id) {
		return localAppAgentIdentity{}, localAppConversationInvalid("App execution reference is invalid")
	}
	owner, _, err := s.resolveLocalAppAgent(ctx, operation, handle)
	return owner, err
}

func (s *Service) localAppWorkForOwnerLocked(owner localAppAgentIdentity, id string) (*localAppWorkExecution, error) {
	s.pruneLocalAppWorkLocked()
	work := s.localAppWorkExecutions[id]
	if work == nil || !sameLocalAppWorkOwner(work.owner, owner) || s.agentTerminationFencedLocked(owner.identity.LocalAgentRef) {
		return nil, localAppAgentAccessDenied()
	}
	select {
	case <-owner.decision.SessionInvalidated:
		return nil, localAppAgentAccessDenied()
	default:
	}
	return work, nil
}

func (s *Service) revalidateLocalAppWorkSubscriber(ctx context.Context, owner localAppAgentIdentity, handle string) error {
	if s.localAppIngressRevalidator == nil {
		return localAppConversationOwnerUnavailable()
	}
	current, err := s.localAppIngressRevalidator.AuthorizeLocalAppIngress(ctx, localappop.IngressAgentWorkEventsSubscribe)
	if err != nil {
		return err
	}
	resolved, _, err := s.resolveLocalAppAgent(current, localappop.OperationAgentWorkEventsSubscribe, handle)
	if err != nil {
		return err
	}
	if !sameLocalAppWorkOwner(owner, resolved) {
		return localAppAgentAccessDenied()
	}
	return nil
}

func (s *Service) revalidateLocalAppWork(work *localAppWorkExecution) error {
	if err := work.ctx.Err(); err != nil {
		return err
	}
	select {
	case <-work.owner.decision.SessionInvalidated:
		return localAppAgentAccessDenied()
	default:
	}
	current, err := s.localAppIngressRevalidator.AuthorizeLocalAppIngress(work.ingress, localappop.IngressAgentWorkStart)
	if err != nil {
		return err
	}
	owner, _, err := s.resolveLocalAppAgent(current, localappop.OperationAgentWorkStart, work.agentHandle)
	if err != nil {
		return err
	}
	if !sameLocalAppWorkOwner(owner, work.owner) {
		return localAppAgentAccessDenied()
	}
	s.chatSurfaceMu.Lock()
	valid := !s.agentTerminationFencedLocked(owner.identity.LocalAgentRef) && !localAppWorkTerminal(work.snapshot.State)
	s.chatSurfaceMu.Unlock()
	if !valid {
		return localAppAgentAccessDenied()
	}
	return nil
}

func cloneLocalAppWorkSnapshot(work *localAppWorkExecution) *runtimev1.LocalAppAgentWorkExecution {
	return proto.Clone(work.snapshot).(*runtimev1.LocalAppAgentWorkExecution)
}
func localAppWorkTerminal(state runtimev1.LocalAppAgentWorkState) bool {
	return state == runtimev1.LocalAppAgentWorkState_LOCAL_APP_AGENT_WORK_STATE_SUCCEEDED || state == runtimev1.LocalAppAgentWorkState_LOCAL_APP_AGENT_WORK_STATE_FAILED || state == runtimev1.LocalAppAgentWorkState_LOCAL_APP_AGENT_WORK_STATE_CANCELLED
}
func (s *Service) publishLocalAppWorkSnapshotLocked(work *localAppWorkExecution) {
	snapshot := cloneLocalAppWorkSnapshot(work)
	snapshot.Sequence = work.snapshot.Sequence + 1
	s.publishLocalAppWorkEventLocked(work, &runtimev1.LocalAppAgentWorkEvent{Event: &runtimev1.LocalAppAgentWorkEvent_Snapshot{Snapshot: snapshot}})
}
func (s *Service) publishLocalAppWorkEventLocked(work *localAppWorkExecution, event *runtimev1.LocalAppAgentWorkEvent) {
	work.snapshot.Sequence++
	event.ExecutionId, event.Sequence = work.snapshot.ExecutionId, work.snapshot.Sequence
	work.events = append(work.events, event)
	work.eventBytes += proto.Size(event)
	for len(work.events) > 1 && (len(work.events) > localAppWorkMaxEvents || work.eventBytes > localAppWorkMaxEventBytes) {
		work.eventBytes -= proto.Size(work.events[0])
		work.events[0] = nil
		work.events = work.events[1:]
	}
	close(work.changed)
	work.changed = make(chan struct{})
}
func (s *Service) terminalizeLocalAppWorkLocked(work *localAppWorkExecution, state runtimev1.LocalAppAgentWorkState, text string, reason runtimev1.ReasonCode) {
	if localAppWorkTerminal(work.snapshot.State) {
		return
	}
	work.snapshot.State, work.snapshot.OutputText, work.snapshot.ReasonCode = state, text, reason
	work.pending = nil
	work.terminalAt = time.Now()
	s.publishLocalAppWorkSnapshotLocked(work)
}
func (s *Service) pruneLocalAppWorkLocked() {
	for id, work := range s.localAppWorkExecutions {
		if !work.terminalAt.IsZero() && time.Since(work.terminalAt) > localAppWorkResultRetention && s.localAppWorkActiveByAgent[work.owner.identity.LocalAgentRef] != id {
			delete(s.localAppWorkExecutions, id)
		}
	}
}

func (s *Service) runLocalAppWork(work *localAppWorkExecution, binding publicChatExecutionBinding, release func()) {
	stopLifetime := context.AfterFunc(s.publicChatAsyncLifetime(), work.cancel)
	defer stopLifetime()
	defer work.cancel()
	defer func() {
		if release != nil {
			release()
		}
		s.chatSurfaceMu.Lock()
		work.input, work.tools, work.prompt = nil, nil, ""
		work.requestID = ""
		if s.localAppWorkActiveByAgent[work.owner.identity.LocalAgentRef] == work.snapshot.ExecutionId {
			delete(s.localAppWorkActiveByAgent, work.owner.identity.LocalAgentRef)
		}
		s.chatSurfaceMu.Unlock()
	}()
	// Renewing this exact live session preserves the channel; real invalidation
	// closes it and immediately fences pending callbacks and later model steps.
	watchDone := make(chan struct{})
	go func() {
		defer close(watchDone)
		ticker := time.NewTicker(localAppConversationRevalidationInterval)
		defer ticker.Stop()
		for {
			select {
			case <-work.ctx.Done():
				return
			case <-work.owner.decision.SessionInvalidated:
				work.cancel()
				return
			case <-ticker.C:
				if s.revalidateLocalAppWork(work) != nil {
					work.cancel()
					return
				}
			}
		}
	}()
	defer func() { work.cancel(); <-watchDone }()
	text, err := s.executeLocalAppWork(work, binding)
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	if localAppWorkTerminal(work.snapshot.State) {
		return
	}
	if err != nil {
		reason, ok := grpcerr.ExtractReasonCode(err)
		if !ok || reason == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
			reason = runtimev1.ReasonCode_AI_STREAM_BROKEN
		}
		state := runtimev1.LocalAppAgentWorkState_LOCAL_APP_AGENT_WORK_STATE_FAILED
		if errors.Is(err, context.Canceled) {
			state = runtimev1.LocalAppAgentWorkState_LOCAL_APP_AGENT_WORK_STATE_CANCELLED
			reason = runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED
		}
		if errors.Is(err, context.DeadlineExceeded) {
			reason = runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT
		}
		s.terminalizeLocalAppWorkLocked(work, state, "", reason)
		return
	}
	invalidated := false
	select {
	case <-work.owner.decision.SessionInvalidated:
		invalidated = true
	default:
	}
	if work.ctx.Err() != nil || invalidated || s.agentTerminationFencedLocked(work.owner.identity.LocalAgentRef) {
		s.terminalizeLocalAppWorkLocked(work, runtimev1.LocalAppAgentWorkState_LOCAL_APP_AGENT_WORK_STATE_CANCELLED, "", runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED)
		return
	}
	s.terminalizeLocalAppWorkLocked(work, runtimev1.LocalAppAgentWorkState_LOCAL_APP_AGENT_WORK_STATE_SUCCEEDED, text, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED)
}

func (s *Service) executeLocalAppWorkCall(work *localAppWorkExecution, call *runtimev1.ToolCall) (*runtimev1.ToolResult, error) {
	if err := s.revalidateLocalAppWork(work); err != nil {
		return nil, err
	}
	pending := &localAppWorkCall{call: &runtimev1.LocalAppAgentWorkToolCall{CallId: "app_call_" + ulid.Make().String(), ExecutionId: work.snapshot.ExecutionId, Name: call.GetName(), ArgumentsJson: call.GetArgumentsJson()}, modelCall: call, result: make(chan *runtimev1.ToolResult, 1)}
	s.chatSurfaceMu.Lock()
	if work.ctx.Err() != nil || localAppWorkTerminal(work.snapshot.State) {
		s.chatSurfaceMu.Unlock()
		return nil, context.Canceled
	}
	work.pending = pending
	work.snapshot.State = runtimev1.LocalAppAgentWorkState_LOCAL_APP_AGENT_WORK_STATE_WAITING_TOOL
	s.publishLocalAppWorkSnapshotLocked(work)
	s.publishLocalAppWorkEventLocked(work, &runtimev1.LocalAppAgentWorkEvent{Event: &runtimev1.LocalAppAgentWorkEvent_ToolCall{ToolCall: proto.Clone(pending.call).(*runtimev1.LocalAppAgentWorkToolCall)}})
	s.chatSurfaceMu.Unlock()
	timer := time.NewTimer(localAppWorkToolTimeout)
	defer timer.Stop()
	select {
	case result := <-pending.result:
		if err := s.revalidateLocalAppWork(work); err != nil {
			return nil, err
		}
		s.chatSurfaceMu.Lock()
		if work.ctx.Err() != nil || localAppWorkTerminal(work.snapshot.State) {
			s.chatSurfaceMu.Unlock()
			return nil, context.Canceled
		}
		work.pending = nil
		work.snapshot.State = runtimev1.LocalAppAgentWorkState_LOCAL_APP_AGENT_WORK_STATE_RUNNING
		s.publishLocalAppWorkSnapshotLocked(work)
		s.chatSurfaceMu.Unlock()
		return result, nil
	case <-work.ctx.Done():
		return nil, work.ctx.Err()
	case <-timer.C:
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_LOCAL_APP_OWNER_UNAVAILABLE)
	}
}

// Kept private: no raw provider failure detail, reasoning, route, or model
// identity is projected to App work events.
func localAppWorkOutputText(batch *appWorkModelBatch) (string, error) {
	if batch.finish != runtimev1.FinishReason_FINISH_REASON_STOP {
		return "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	var text strings.Builder
	for _, item := range batch.output {
		if value := item.GetText(); value != nil {
			text.WriteString(value.GetText())
		}
	}
	output := text.String()
	if !validLocalAppConversationText(output, 65536, true) {
		return "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	return output, nil
}

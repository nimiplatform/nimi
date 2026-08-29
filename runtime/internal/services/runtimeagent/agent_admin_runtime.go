package runtimeagent

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type agentAdminRuntime struct {
	svc *Service
}

func (s *Service) agentAdminRuntime() agentAdminRuntime {
	return agentAdminRuntime{svc: s}
}

// terminate is the K-AGCORE-141 atomic LocalAgent hard-delete lifecycle.
// Runtime first establishes the durable Memory termination fence, then deletes
// Source Cognition and the Memory bank through the retryable owner phases before
// atomically deleting Runtime-owned Agent, chat, and projection rows. Runtime
// holds its Agent and chat locks across these phases, so late work cannot commit
// between them. Stable operation identity resumes any partial deletion. No
// TERMINATED tombstone is retained; later materialization mints a new opaque ref.
// @nimi-authority: rule.nimi.runtime.agent-service.r054
func (r agentAdminRuntime) terminate(ctx context.Context, req *runtimev1.TerminateAgentRequest) (*runtimev1.TerminateAgentResponse, error) {
	identity, err := localAgentIdentityFromContext(req.GetContext())
	if err != nil {
		return nil, err
	}
	return r.terminateOwned(ctx, identity, "cmterm_"+identity.LocalAgentRef, memoryv1.DeleteReasonAgentTermination, firstNonEmpty(strings.TrimSpace(req.GetReason()), "agent terminated"))
}

// terminateOwned is the singular internal LocalAgent owner chain. Public Agent
// termination reaches it only after AgentRequestContext validation; Realm
// Account fan-out reaches it only with a durable, exact-owner child operation.
// @nimi-authority: rule.nimi.runtime.memory-world.r024
// @nimi-authority: rule.nimi.cognition.runtime-bridge.r023
func (r agentAdminRuntime) terminateOwned(ctx context.Context, identity localAgentIdentity, memoryOperationID string, deleteReason memoryv1.DeleteReason, reason string) (*runtimev1.TerminateAgentResponse, error) {
	if _, err := validateLocalAgentIdentity(identity.OwnerUserID, identity.RuntimeSourceRef, identity.LocalAgentRef); err != nil || strings.TrimSpace(memoryOperationID) == "" || (deleteReason != memoryv1.DeleteReasonAgentTermination && deleteReason != memoryv1.DeleteReasonAccountTermination) {
		if err != nil {
			return nil, err
		}
		return nil, status.Error(codes.InvalidArgument, "invalid trusted Agent termination operation")
	}
	localAgentRef := identity.LocalAgentRef
	// Validate before touching transient sessions. The Runtime lock is released
	// while the exact Agent Realtime generations are fenced so an in-flight
	// event projection can finish without a lifecycle/event lock inversion.
	r.svc.mu.RLock()
	current := r.svc.agents[localAgentRef]
	if current == nil {
		// With a single atomic delete boundary there can be no legitimate
		// memory/snapshot remainder to clean after the Agent row disappears.
		// Treat an absent ref as an idempotent no-op instead of allowing an
		// unbound caller to purge banks by guessing another Agent's ref.
		r.svc.mu.RUnlock()
		r.svc.setAgentDurableTerminationFence(localAgentRef, false)
		return &runtimev1.TerminateAgentResponse{Ack: okAck()}, nil
	}
	if err := validateLocalAgentRecordIdentity(current.Agent, identity); err != nil {
		r.svc.mu.RUnlock()
		return nil, err
	}
	r.svc.mu.RUnlock()
	r.svc.beginAgentTerminationFence(localAgentRef)
	defer r.svc.endAgentTerminationFence(localAgentRef)
	realtimeExecutor, realtimeFences := r.svc.fenceAgentRealtimeSessions(localAgentRef)
	r.svc.closeFencedAgentRealtimeSessions(realtimeExecutor, realtimeFences)

	// Revalidate after the transient fence, then serialize owner Ensure/Bind
	// through the durable Memory fence. Once that fence commits, later Memory
	// lifecycle ingress fails closed and owner deletion can proceed independently.
	r.svc.cognitionMemoryOwnerLifecycleMu.Lock()
	ownerLifecycleLocked := true
	defer func() {
		if ownerLifecycleLocked {
			r.svc.cognitionMemoryOwnerLifecycleMu.Unlock()
		}
	}()
	r.svc.mu.Lock()
	current = r.svc.agents[localAgentRef]
	if current == nil {
		r.svc.mu.Unlock()
		r.svc.setAgentDurableTerminationFence(localAgentRef, false)
		return &runtimev1.TerminateAgentResponse{Ack: okAck()}, nil
	}
	if err := validateLocalAgentRecordIdentity(current.Agent, identity); err != nil {
		r.svc.mu.Unlock()
		return nil, err
	}
	now := time.Now().UTC()
	reason = firstNonEmpty(strings.TrimSpace(reason), "agent terminated")
	executionCancels, summaryJobs := r.svc.fenceAgentChatExecutionForTerminationLocked(localAgentRef)
	for _, cancel := range executionCancels {
		cancel()
	}
	for _, job := range summaryJobs {
		if job != nil && job.Cancel != nil {
			job.Cancel()
		}
	}
	for _, job := range summaryJobs {
		if job != nil && job.Done != nil {
			<-job.Done
		}
	}
	if r.svc.sourceCognitionBridge == nil {
		r.svc.mu.Unlock()
		return nil, grpcerr.WrapWithReasonCode(codes.Unavailable, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, fmt.Errorf("source Cognition bridge is unavailable"), grpcerr.ReasonOptions{Message: "source Cognition deletion is unavailable"})
	}
	snapshot, found, snapshotErr := r.svc.realmSourceSnapshotStoreV2.sourceSnapshot(ctx, localAgentRef)
	if snapshotErr != nil || !found {
		r.svc.mu.Unlock()
		if snapshotErr == nil {
			snapshotErr = fmt.Errorf("LocalAgent source snapshot is absent")
		}
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, snapshotErr, grpcerr.ReasonOptions{Message: "source Cognition deletion binding is unavailable"})
	}
	scopeID := sourceCognitionScopeID(localAgentRef)
	if r.svc.cognitionMemoryTermination == nil {
		r.svc.mu.Unlock()
		return nil, grpcerr.WrapWithReasonCode(codes.Unavailable, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, fmt.Errorf("Cognition Memory termination is unavailable"), grpcerr.ReasonOptions{Message: "Cognition Memory deletion is unavailable"})
	}
	memoryFence, fenceErr := r.svc.cognitionMemoryTermination.PrepareAgentTermination(
		ctx,
		localAgentRef,
		memoryOperationID,
		deleteReason,
	)
	if fenceErr != nil || (memoryFence.Phase != "fenced" && memoryFence.Phase != "completed") {
		r.svc.mu.Unlock()
		if fenceErr == nil {
			fenceErr = fmt.Errorf("Cognition Memory termination fence returned outcome %q at phase %q", memoryFence.Outcome, memoryFence.Phase)
		}
		return nil, grpcerr.WrapWithReasonCode(codes.Unavailable, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, fenceErr, grpcerr.ReasonOptions{Message: "Cognition Memory termination fence did not commit"})
	}
	r.svc.setAgentDurableTerminationFence(localAgentRef, true)
	r.svc.cognitionMemoryOwnerLifecycleMu.Unlock()
	ownerLifecycleLocked = false
	deleteOutcome, deleteErr := r.svc.sourceCognitionBridge.DeleteAgentSource(ctx, current.Agent.GetOwnerUserId(), scopeID, snapshot.SnapshotHash)
	if deleteErr != nil {
		r.svc.mu.Unlock()
		return nil, grpcerr.WrapWithReasonCode(codes.Unavailable, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, deleteErr, grpcerr.ReasonOptions{Message: "source Cognition deletion failed"})
	}
	if bindingErr := validateSourceCognitionOutcomeBinding(deleteOutcome, scopeID, snapshot.SnapshotHash); bindingErr != nil || (deleteOutcome.Status != "deleted" && deleteOutcome.Status != "already_absent") {
		r.svc.mu.Unlock()
		if bindingErr == nil {
			bindingErr = fmt.Errorf("source Cognition deletion returned non-terminal status %q", deleteOutcome.Status)
		}
		return nil, grpcerr.WrapWithReasonCode(codes.Unavailable, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, bindingErr, grpcerr.ReasonOptions{Message: "source Cognition deletion did not commit"})
	}
	memoryTermination, terminationErr := r.svc.cognitionMemoryTermination.TerminateAgentMemory(
		ctx,
		localAgentRef,
		memoryOperationID,
		deleteReason,
	)
	if terminationErr != nil || memoryTermination.Phase != "completed" || (memoryTermination.Outcome != memoryv1.OutcomeDeleted && memoryTermination.Outcome != memoryv1.OutcomeAlreadyAbsent) {
		r.svc.mu.Unlock()
		if terminationErr == nil {
			terminationErr = fmt.Errorf("Cognition Memory termination returned outcome %q at phase %q", memoryTermination.Outcome, memoryTermination.Phase)
		}
		return nil, grpcerr.WrapWithReasonCode(codes.Unavailable, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, terminationErr, grpcerr.ReasonOptions{Message: "Cognition Memory deletion did not complete"})
	}

	entry := cloneAgentEntry(current)
	previousStatus := entry.Agent.GetLifecycleStatus()

	// Move the working copy to TERMINATED before cancelling hooks so the
	// life-track teardown resolves the agent's execution state to SUSPENDED.
	// This mutation drives the cancellation/teardown projection only; the
	// entry is hard-deleted below and never persisted as a TERMINATED row.
	entry.Agent.LifecycleStatus = runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_TERMINATED
	entry.Agent.UpdatedAt = timestamppb.New(now)

	// Cancel active hooks and in-flight chat/follow-up execution before the
	// projection row is removed so deletion does not strand live runtime work.
	liveEvents := []*runtimev1.AgentEvent{
		r.svc.newEventForIdentity(identity, runtimev1.AgentEventType_AGENT_EVENT_TYPE_LIFECYCLE, &runtimev1.AgentEvent_Lifecycle{
			Lifecycle: &runtimev1.AgentLifecycleEventDetail{
				PreviousStatus: previousStatus,
				CurrentStatus:  runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_TERMINATED,
			},
		}),
	}
	liveEvents = append(liveEvents, r.svc.cancelActiveHooks(entry, "runtime", reason, now)...)
	previousEvents := append([]*runtimev1.AgentEvent(nil), r.svc.events...)
	previousSequence := r.svc.sequence
	delete(r.svc.agents, localAgentRef)
	retainedEvents := make([]*runtimev1.AgentEvent, 0, len(previousEvents))
	for _, event := range previousEvents {
		if event.GetLocalAgentRef() != localAgentRef {
			retainedEvents = append(retainedEvents, event)
		}
	}
	r.svc.events = retainedEvents
	persistedAgentState, err := r.svc.stateRepo.snapshotStateLocked(r.svc)
	if err != nil {
		r.svc.agents[localAgentRef] = current
		r.svc.events = previousEvents
		r.svc.sequence = previousSequence
		r.svc.mu.Unlock()
		return nil, grpcerr.WrapWithReasonCode(
			codes.Internal,
			runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
			err,
			grpcerr.ReasonOptions{Message: "atomic agent deletion state could not be captured"},
		)
	}

	r.svc.chatSurfaceMu.Lock()
	chatSnapshot, removedAnchorIDs, cancels, chatRollback, err := r.svc.prepareAgentScopedChatSurfaceDeletionLocked(localAgentRef)
	if err != nil {
		r.svc.agents[localAgentRef] = current
		r.svc.events = previousEvents
		r.svc.sequence = previousSequence
		r.svc.chatSurfaceMu.Unlock()
		r.svc.mu.Unlock()
		return nil, grpcerr.WrapWithReasonCode(
			codes.Internal,
			runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
			err,
			grpcerr.ReasonOptions{Message: "atomic chat deletion state could not be captured"},
		)
	}
	projectionHook, err := agentAtomicProjectionDeletionHook(r.svc, localAgentRef, chatSnapshot, removedAnchorIDs)
	if err == nil {
		err = r.svc.stateRepo.persistSnapshot(persistedAgentState, projectionHook)
	}
	if err != nil {
		r.svc.restoreAgentChatSurfaceDeletionLocked(chatRollback)
		r.svc.agents[localAgentRef] = current
		r.svc.events = previousEvents
		r.svc.sequence = previousSequence
		r.svc.chatSurfaceMu.Unlock()
		r.svc.mu.Unlock()
		if status.Code(err) != codes.Unknown {
			return nil, err
		}
		return nil, grpcerr.WrapWithReasonCode(
			codes.Internal,
			runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
			err,
			grpcerr.ReasonOptions{Message: "atomic agent deletion failed"},
		)
	}
	delete(r.svc.turnSourceViews, localAgentRef)
	summaryJobs = r.svc.detachAgentPublicChatConversationSummaryJobsLocked(localAgentRef)

	// Cancel in-flight chat work only after the shared transaction commits.
	// Agent/chat locks are still held here, so canceled workers cannot race a
	// deleted projection back into memory or persistence; a failed delete has
	// no irreversible cancellation side effect to roll back.
	for _, cancel := range cancels {
		cancel()
	}
	for _, job := range summaryJobs {
		if job != nil && job.Cancel != nil {
			job.Cancel()
		}
	}
	targetsByEvent := r.svc.eventStreamRuntime().matchingSubscribersLocked(liveEvents)
	delete(r.svc.chatDurableTerminatingAgents, localAgentRef)
	r.svc.chatSurfaceMu.Unlock()
	r.svc.mu.Unlock()
	for _, job := range summaryJobs {
		if job != nil && job.Done != nil {
			<-job.Done
		}
	}
	r.svc.eventStreamRuntime().broadcast(liveEvents, targetsByEvent)
	return &runtimev1.TerminateAgentResponse{Ack: okAck()}, nil
}

func (r agentAdminRuntime) get(req *runtimev1.GetAgentRequest) (*runtimev1.GetAgentResponse, error) {
	identity, err := localAgentIdentityFromContext(req.GetContext())
	if err != nil {
		return nil, err
	}
	entry, err := r.svc.agentByID(identity.LocalAgentRef)
	if err != nil {
		return nil, err
	}
	if err := validateLocalAgentRecordIdentity(entry.Agent, identity); err != nil {
		return nil, err
	}
	return &runtimev1.GetAgentResponse{Agent: cloneLocalAgentRecord(entry.Agent)}, nil
}

func (r agentAdminRuntime) setPresentationProfile(ctx context.Context, req *runtimev1.SetAgentPresentationProfileRequest) (*runtimev1.SetAgentPresentationProfileResponse, error) {
	if req == nil || req.ExpectedRevision == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	identity, err := localAgentIdentityFromContext(req.GetContext())
	if err != nil {
		return nil, err
	}
	mutation := agentPresentationMutation{importedAssets: req.GetImportedAssets()}
	switch input := req.GetMutation().(type) {
	case *runtimev1.SetAgentPresentationProfileRequest_Profile:
		mutation.profile = input.Profile
	case *runtimev1.SetAgentPresentationProfileRequest_Clear:
		mutation.clear = true
	case *runtimev1.SetAgentPresentationProfileRequest_Patch:
		mutation.patch = input.Patch
	default:
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	profile, previous, _, committedRevision, err := r.svc.commitAgentPresentation(
		ctx, identity, req.GetContext().GetAppId(), req.GetExpectedRevision(), mutation,
	)
	if err != nil {
		return nil, err
	}
	return &runtimev1.SetAgentPresentationProfileResponse{
		Profile: profile, PreviousProfile: previous, CommittedRevision: committedRevision,
	}, nil
}

func (r agentAdminRuntime) list(req *runtimev1.ListAgentsRequest, ownerUserID string) (*runtimev1.ListAgentsResponse, error) {
	r.svc.mu.RLock()
	items := make([]*runtimev1.LocalAgentRecord, 0, len(r.svc.agents))
	for _, entry := range r.svc.agents {
		if ownerUserID != "" && strings.TrimSpace(entry.Agent.GetOwnerUserId()) != ownerUserID {
			continue
		}
		if req.GetLifecycleFilter() != runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_UNSPECIFIED &&
			entry.Agent.GetLifecycleStatus() != req.GetLifecycleFilter() {
			continue
		}
		if req.AutonomyEnabled != nil && entry.Agent.GetAutonomy().GetEnabled() != req.GetAutonomyEnabled() {
			continue
		}
		agent := cloneLocalAgentRecord(entry.Agent)
		if err := validatePersistedAgentPresentationProfile(agent); err != nil {
			r.svc.mu.RUnlock()
			return nil, err
		}
		items = append(items, agent)
	}
	r.svc.mu.RUnlock()
	sort.Slice(items, func(i, j int) bool {
		left := items[i].GetCreatedAt().AsTime()
		right := items[j].GetCreatedAt().AsTime()
		if left.Equal(right) {
			return items[i].GetLocalAgentRef() < items[j].GetLocalAgentRef()
		}
		return left.After(right)
	})
	start, end, next, err := pageBounds(req.GetPageToken(), req.GetPageSize(), defaultAgentPageSize, maxAgentPageSize, len(items))
	if err != nil {
		return nil, err
	}
	return &runtimev1.ListAgentsResponse{Agents: items[start:end], NextPageToken: next}, nil
}

func (r agentAdminRuntime) getState(req *runtimev1.GetAgentStateRequest) (*runtimev1.GetAgentStateResponse, error) {
	identity, err := localAgentIdentityFromContext(req.GetContext())
	if err != nil {
		return nil, err
	}
	entry, err := r.svc.agentByID(identity.LocalAgentRef)
	if err != nil {
		return nil, err
	}
	if err := validateLocalAgentRecordIdentity(entry.Agent, identity); err != nil {
		return nil, err
	}
	return &runtimev1.GetAgentStateResponse{State: cloneAgentState(entry.State)}, nil
}

func (r agentAdminRuntime) updateState(req *runtimev1.UpdateAgentStateRequest) (*runtimev1.UpdateAgentStateResponse, error) {
	if len(req.GetMutations()) == 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	identity, err := localAgentIdentityFromContext(req.GetContext())
	if err != nil {
		return nil, err
	}
	entry, err := r.svc.agentByID(identity.LocalAgentRef)
	if err != nil {
		return nil, err
	}
	if err := validateLocalAgentRecordIdentity(entry.Agent, identity); err != nil {
		return nil, err
	}
	nextState := cloneAgentState(entry.State)
	if nextState.Attributes == nil {
		nextState.Attributes = map[string]string{}
	}
	// K-AGCORE-037 state_envelope: admin mutations have no continuity origin.
	// Runtime MUST NOT fabricate anchor/turn/stream linkage.
	adminOrigin := stateEventOrigin{}
	previousStatusText := strings.TrimSpace(entry.State.GetStatusText())
	hadPreviousStatusText := previousStatusText != ""
	for _, mutation := range req.GetMutations() {
		switch item := mutation.GetMutation().(type) {
		case *runtimev1.AgentStateMutation_SetStatusText:
			nextState.StatusText = strings.TrimSpace(item.SetStatusText.GetStatusText())
		case *runtimev1.AgentStateMutation_SetWorldContext:
			nextState.ActiveWorldId = strings.TrimSpace(item.SetWorldContext.GetWorldId())
		case *runtimev1.AgentStateMutation_ClearWorldContext:
			nextState.ActiveWorldId = ""
		case *runtimev1.AgentStateMutation_SetDyadicContext:
			nextState.ActiveUserId = strings.TrimSpace(item.SetDyadicContext.GetUserId())
		case *runtimev1.AgentStateMutation_ClearDyadicContext:
			nextState.ActiveUserId = ""
		case *runtimev1.AgentStateMutation_PutAttribute:
			key := strings.TrimSpace(item.PutAttribute.GetKey())
			if key == "" {
				return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
			}
			nextState.Attributes[key] = item.PutAttribute.GetValue()
		case *runtimev1.AgentStateMutation_RemoveAttribute:
			delete(nextState.Attributes, strings.TrimSpace(item.RemoveAttribute.GetKey()))
		default:
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
	}
	now := time.Now().UTC()
	nextState.UpdatedAt = timestamppb.New(now)
	entry.State = nextState
	events := make([]*runtimev1.AgentEvent, 0, 1)
	newStatusText := strings.TrimSpace(nextState.GetStatusText())
	if newStatusText != previousStatusText {
		events = append(events, r.svc.stateStatusTextChangedEvent(
			entry.Agent.GetLocalAgentRef(),
			newStatusText,
			previousStatusText,
			hadPreviousStatusText,
			adminOrigin,
			now,
		))
	}
	if err := r.svc.updateAgent(entry, events...); err != nil {
		return nil, err
	}
	return &runtimev1.UpdateAgentStateResponse{State: cloneAgentState(nextState)}, nil
}

func (r agentAdminRuntime) enableAutonomy(req *runtimev1.EnableAutonomyRequest) (*runtimev1.EnableAutonomyResponse, error) {
	identity, entry, err := r.svc.agentEntryForIdentityContext(req.GetContext())
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	if entry.Agent.Autonomy == nil {
		entry.Agent.Autonomy = buildInitialAutonomyState(nil, now)
	}
	if autonomyMode(entry.Agent.Autonomy.GetConfig()) == runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_OFF {
		return &runtimev1.EnableAutonomyResponse{Autonomy: cloneAutonomy(entry.Agent.GetAutonomy())}, nil
	}
	entry.Agent.Autonomy.Enabled = true
	if err := advanceAutonomyRevision(entry.Agent.Autonomy); err != nil {
		return nil, err
	}
	if entry.Agent.Autonomy.WindowStartedAt == nil {
		entry.Agent.Autonomy.WindowStartedAt = timestamppb.New(now)
	}
	entry.Agent.UpdatedAt = timestamppb.New(now)
	event := r.svc.newEventForIdentity(identity, runtimev1.AgentEventType_AGENT_EVENT_TYPE_BUDGET, &runtimev1.AgentEvent_Budget{
		Budget: &runtimev1.AgentBudgetEventDetail{
			BudgetExhausted: entry.Agent.GetAutonomy().GetBudgetExhausted(),
			RemainingTokens: remainingTokens(entry.Agent.GetAutonomy()),
			WindowStartedAt: cloneTimestamp(entry.Agent.GetAutonomy().GetWindowStartedAt()),
		},
	})
	if err := r.svc.updateAgent(entry, event); err != nil {
		return nil, err
	}
	return &runtimev1.EnableAutonomyResponse{Autonomy: cloneAutonomy(entry.Agent.GetAutonomy())}, nil
}

func (r agentAdminRuntime) disableAutonomy(req *runtimev1.DisableAutonomyRequest) (*runtimev1.DisableAutonomyResponse, error) {
	identity, entry, err := r.svc.agentEntryForIdentityContext(req.GetContext())
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	if entry.Agent.Autonomy == nil {
		entry.Agent.Autonomy = buildInitialAutonomyState(nil, now)
	}
	entry.Agent.Autonomy.Enabled = false
	entry.Agent.Autonomy.BudgetExhausted = false
	if err := advanceAutonomyRevision(entry.Agent.Autonomy); err != nil {
		return nil, err
	}
	entry.Agent.UpdatedAt = timestamppb.New(now)
	event := r.svc.newEventForIdentity(identity, runtimev1.AgentEventType_AGENT_EVENT_TYPE_BUDGET, &runtimev1.AgentEvent_Budget{
		Budget: &runtimev1.AgentBudgetEventDetail{
			BudgetExhausted: false,
			RemainingTokens: remainingTokens(entry.Agent.GetAutonomy()),
			WindowStartedAt: cloneTimestamp(entry.Agent.GetAutonomy().GetWindowStartedAt()),
		},
	})
	if err := r.svc.updateAgent(entry, event); err != nil {
		return nil, err
	}
	return &runtimev1.DisableAutonomyResponse{Autonomy: cloneAutonomy(entry.Agent.GetAutonomy())}, nil
}

func (r agentAdminRuntime) setAutonomyConfig(req *runtimev1.SetAutonomyConfigRequest) (*runtimev1.SetAutonomyConfigResponse, error) {
	if req.GetConfig() == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	identity, entry, err := r.svc.agentEntryForIdentityContext(req.GetContext())
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	config := normalizeAutonomyConfig(req.GetConfig())
	if entry.Agent.Autonomy == nil {
		entry.Agent.Autonomy = buildInitialAutonomyState(config, now)
	} else {
		entry.Agent.Autonomy.Config = config
	}
	entry.Agent.Autonomy.SuspendedUntil = cloneTimestamp(config.GetSuspendUntil())
	if err := advanceAutonomyRevision(entry.Agent.Autonomy); err != nil {
		return nil, err
	}
	if autonomyMode(config) == runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_OFF {
		entry.Agent.Autonomy.Enabled = false
		entry.Agent.Autonomy.BudgetExhausted = false
	} else {
		entry.Agent.Autonomy.BudgetExhausted = entry.Agent.Autonomy.GetConfig().GetDailyTokenBudget() > 0 &&
			entry.Agent.Autonomy.GetUsedTokensInWindow() >= entry.Agent.Autonomy.GetConfig().GetDailyTokenBudget()
	}
	entry.Agent.UpdatedAt = timestamppb.New(now)
	event := r.svc.newEventForIdentity(identity, runtimev1.AgentEventType_AGENT_EVENT_TYPE_BUDGET, &runtimev1.AgentEvent_Budget{
		Budget: &runtimev1.AgentBudgetEventDetail{
			BudgetExhausted: entry.Agent.GetAutonomy().GetBudgetExhausted(),
			RemainingTokens: remainingTokens(entry.Agent.GetAutonomy()),
			WindowStartedAt: cloneTimestamp(entry.Agent.GetAutonomy().GetWindowStartedAt()),
		},
	})
	if err := r.svc.updateAgent(entry, event); err != nil {
		return nil, err
	}
	return &runtimev1.SetAutonomyConfigResponse{Autonomy: cloneAutonomy(entry.Agent.GetAutonomy())}, nil
}

func advanceAutonomyRevision(state *runtimev1.AgentAutonomyState) error {
	if state == nil || state.GetRevision() == ^uint64(0) {
		return status.Error(codes.FailedPrecondition, "agent autonomy revision exhausted")
	}
	if state.GetRevision() == 0 {
		state.Revision = 1
	} else {
		state.Revision++
	}
	return nil
}

func (r agentAdminRuntime) listPendingHooks(req *runtimev1.ListPendingHooksRequest) (*runtimev1.ListPendingHooksResponse, error) {
	_, entry, err := r.svc.agentEntryForIdentityContext(req.GetContext())
	if err != nil {
		return nil, err
	}
	items := make([]*runtimev1.PendingHook, 0, len(entry.Hooks))
	for _, hook := range entry.Hooks {
		state := hookAdmissionState(hook)
		if req.GetAdmissionStateFilter() == runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_UNSPECIFIED && !isCancelableAdmissionState(state) {
			continue
		}
		if req.GetTriggerFamilyFilter() != runtimev1.HookTriggerFamily_HOOK_TRIGGER_FAMILY_UNSPECIFIED &&
			hook.GetIntent().GetTriggerFamily() != req.GetTriggerFamilyFilter() {
			continue
		}
		if req.GetAdmissionStateFilter() != runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_UNSPECIFIED &&
			state != req.GetAdmissionStateFilter() {
			continue
		}
		items = append(items, clonePendingHook(hook))
	}
	sort.Slice(items, func(i, j int) bool {
		left := items[i].GetScheduledFor().AsTime()
		right := items[j].GetScheduledFor().AsTime()
		if left.Equal(right) {
			return hookIntentID(items[i]) < hookIntentID(items[j])
		}
		return left.Before(right)
	})
	start, end, next, err := pageBounds(req.GetPageToken(), req.GetPageSize(), defaultHookPageSize, maxHookPageSize, len(items))
	if err != nil {
		return nil, err
	}
	return &runtimev1.ListPendingHooksResponse{Hooks: items[start:end], NextPageToken: next}, nil
}

func (r agentAdminRuntime) cancelHook(req *runtimev1.CancelHookRequest) (*runtimev1.CancelHookResponse, error) {
	identity, _, err := r.svc.agentEntryForIdentityContext(req.GetContext())
	if err != nil {
		return nil, err
	}
	outcome, err := r.svc.cancelHook(identity.LocalAgentRef, strings.TrimSpace(req.GetIntentId()), "app", req.GetReason())
	if err != nil {
		return nil, err
	}
	return &runtimev1.CancelHookResponse{Outcome: outcome}, nil
}

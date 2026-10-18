package runtimeagent

import (
	"context"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// @nimi-authority: rule.nimi.runtime.agent-participation.proactive-controls
func (s *Service) localAppConversationStateLocked(anchor *publicChatAnchorState) *runtimev1.LocalAppConversationState {
	result := &runtimev1.LocalAppConversationState{FollowUpEnabled: anchor.FollowUpEnabled, FollowUpPolicyRevision: anchor.FollowUpPolicyRevision, MaxFollowUpTurns: publicChatMaxFollowUpTurns}
	if anchor.ActiveTurnID != "" {
		id := anchor.ActiveTurnID
		result.TextTurnId = &id
	}
	if pending := s.chatFollowUps[anchor.PendingFollowUpID]; pending != nil {
		result.PendingFollowUp = &runtimev1.LocalAppConversationFollowUp{TaskId: pending.FollowUpID, Revision: pending.Revision, ScheduledFor: timestamppb.New(pending.ScheduledFor), SourceTurnId: pending.SourceTurnID}
	}
	return result
}

// This is the same anchor/sequence commit boundary used by the Conversation
// publisher, with no turn invented for a policy or pending-task update.
func (s *Service) commitConversationControl(ctx context.Context, resolved localAppAgentIdentity, ingress localappop.Ingress, anchorID string, mutate func(*publicChatAnchorState) (func(), error)) (*runtimev1.LocalAppConversationState, error) {
	s.localAppConversationPublishMu.Lock()
	defer s.localAppConversationPublishMu.Unlock()
	s.chatSurfaceMu.Lock()
	anchor := s.chatAnchors[anchorID]
	if anchor == nil || anchor.Status == runtimev1.ConversationAnchorStatus_CONVERSATION_ANCHOR_STATUS_CLOSED || s.agentTerminationFencedLocked(anchor.LocalAgentRef) {
		s.chatSurfaceMu.Unlock()
		return nil, localAppConversationOwnerUnavailable()
	}
	before := *anchor
	oldPending := s.chatFollowUps[anchor.PendingFollowUpID]
	version := s.chatSurfaceVersion
	post, err := mutate(anchor)
	if err != nil {
		s.chatSurfaceMu.Unlock()
		return nil, err
	}
	anchor.LocalAppSequence++
	if anchor.LocalAppSequence == 0 {
		err = localAppConversationOwnerUnavailable()
	} else {
		err = s.persistLocalAppConversationCommitLocked(ctx, ingress, resolved.decision, anchorID)
	}
	if err != nil {
		delete(s.chatFollowUps, anchor.PendingFollowUpID)
		*anchor = before
		if oldPending != nil {
			s.chatFollowUps[before.PendingFollowUpID] = oldPending
		}
		s.chatSurfaceVersion = version
		s.chatSurfaceMu.Unlock()
		return nil, proactiveControlOwnerFailure(err)
	}
	state := s.localAppConversationStateLocked(anchor)
	event := &runtimev1.LocalAppConversationEvent{ConversationAnchorId: anchorID, Sequence: anchor.LocalAppSequence, Event: &runtimev1.LocalAppConversationEvent_StateChanged{StateChanged: state}}
	accountID := anchor.SubjectUserID
	s.chatSurfaceMu.Unlock()
	s.broadcastLocalAppConversationEvents(accountID, anchorID, []*runtimev1.LocalAppConversationEvent{event})
	if post != nil {
		post()
	}
	return state, nil
}

func (s *Service) UpdateLocalAppConversationFollowUpPolicy(ctx context.Context, req *runtimev1.UpdateLocalAppConversationFollowUpPolicyRequest) (*runtimev1.UpdateLocalAppConversationFollowUpPolicyResponse, error) {
	if req == nil || len(req.ProtoReflect().GetUnknown()) != 0 {
		return nil, localAppConversationInvalid("invalid follow-up policy request")
	}
	resolved, _, err := s.resolveLocalAppAgent(ctx, accountservice.LocalAppOperationConversationFollowUpPolicyUpdate, req.AgentHandle)
	if err != nil {
		return nil, err
	}
	anchorID := strings.TrimSpace(req.ConversationAnchorId)
	if err := s.validateLocalAppConversationResource(resolved, anchorID); err != nil {
		return nil, err
	}
	state, err := s.commitConversationControl(ctx, resolved, localappop.IngressConversationFollowUpPolicyUpdate, anchorID, func(anchor *publicChatAnchorState) (func(), error) {
		if anchor.FollowUpPolicyRevision != req.ExpectedRevision || anchor.FollowUpPolicyRevision == ^uint64(0) {
			return nil, grpcerr.WithReasonCodeOptions(codes.Aborted, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE, grpcerr.ReasonOptions{Message: "Follow-up policy changed; refresh before editing.", ActionHint: "refresh_conversation_follow_up"})
		}
		anchor.FollowUpEnabled = req.Enabled
		anchor.FollowUpPolicyRevision++
		pending := s.chatFollowUps[anchor.PendingFollowUpID]
		if !req.Enabled {
			delete(s.chatFollowUps, anchor.PendingFollowUpID)
			anchor.PendingFollowUpID = ""
		}
		return func() {
			if !req.Enabled && pending != nil && pending.Cancel != nil {
				pending.Cancel()
			}
		}, nil
	})
	if err != nil {
		return nil, err
	}
	if req.Enabled {
		s.wakeDuePublicChatFollowUp(anchorID)
	}
	return &runtimev1.UpdateLocalAppConversationFollowUpPolicyResponse{State: state}, nil
}

func validateScheduledTaskEdit(action runtimev1.LocalAppScheduledTaskAction, due *timestamppb.Timestamp) error {
	switch action {
	case runtimev1.LocalAppScheduledTaskAction_LOCAL_APP_SCHEDULED_TASK_ACTION_CANCEL:
		if due != nil {
			return localAppConversationInvalid("cancel does not accept a due time")
		}
	case runtimev1.LocalAppScheduledTaskAction_LOCAL_APP_SCHEDULED_TASK_ACTION_RESCHEDULE:
		if due == nil || due.CheckValid() != nil || !due.AsTime().After(time.Now().UTC()) {
			return localAppConversationInvalid("choose a future time")
		}
	default:
		return localAppConversationInvalid("unsupported pending-task operation")
	}
	return nil
}

func (s *Service) UpdateLocalAppConversationFollowUp(ctx context.Context, req *runtimev1.UpdateLocalAppConversationFollowUpRequest) (*runtimev1.UpdateLocalAppConversationFollowUpResponse, error) {
	if req == nil || len(req.ProtoReflect().GetUnknown()) != 0 {
		return nil, localAppConversationInvalid("invalid follow-up request")
	}
	if err := validateScheduledTaskEdit(req.Action, req.ScheduledFor); err != nil {
		return nil, err
	}
	resolved, _, err := s.resolveLocalAppAgent(ctx, accountservice.LocalAppOperationConversationFollowUpUpdate, req.AgentHandle)
	if err != nil {
		return nil, err
	}
	anchorID := strings.TrimSpace(req.ConversationAnchorId)
	if err := s.validateLocalAppConversationResource(resolved, anchorID); err != nil {
		return nil, err
	}
	var next *publicChatFollowUpState
	state, err := s.commitConversationControl(ctx, resolved, localappop.IngressConversationFollowUpUpdate, anchorID, func(anchor *publicChatAnchorState) (func(), error) {
		old := s.chatFollowUps[anchor.PendingFollowUpID]
		if old == nil || old.FollowUpID != req.TaskId {
			return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE, grpcerr.ReasonOptions{Message: "The follow-up is no longer pending; it was not changed.", ActionHint: "refresh_conversation_follow_up"})
		}
		if old.Revision != req.ExpectedRevision || old.Revision == ^uint64(0) {
			return nil, grpcerr.WithReasonCodeOptions(codes.Aborted, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE, grpcerr.ReasonOptions{Message: "The follow-up changed; refresh before editing.", ActionHint: "refresh_conversation_follow_up"})
		}
		if req.Action == runtimev1.LocalAppScheduledTaskAction_LOCAL_APP_SCHEDULED_TASK_ACTION_CANCEL {
			delete(s.chatFollowUps, old.FollowUpID)
			anchor.PendingFollowUpID = ""
		} else {
			copy := *old
			copy.Revision++
			copy.ScheduledFor = req.ScheduledFor.AsTime().UTC()
			copy.Context = nil
			copy.Cancel = nil
			copy.Armed = false
			next = &copy
			s.chatFollowUps[copy.FollowUpID] = next
		}
		return func() {
			if old.Cancel != nil {
				old.Cancel()
			}
		}, nil
	})
	if err != nil {
		return nil, err
	}
	if next != nil {
		s.armPublicChatFollowUp(next)
	}
	return &runtimev1.UpdateLocalAppConversationFollowUpResponse{State: state}, nil
}

func projectLocalAppPendingHook(hook *runtimev1.PendingHook) *runtimev1.LocalAppAgentPendingHook {
	return &runtimev1.LocalAppAgentPendingHook{TaskId: hookIntentID(hook), Revision: hook.GetRevision(), ScheduledFor: cloneTimestamp(hook.GetScheduledFor()), SystemCadence: hook.GetRuntimeCadence(), Status: hookAdmissionState(hook), CanModify: hook.GetRevision() > 0 && hookAdmissionState(hook) == runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PENDING && !hook.GetRuntimeCadence() && hook.GetIntent().GetTriggerFamily() == runtimev1.HookTriggerFamily_HOOK_TRIGGER_FAMILY_TIME}
}

func (s *Service) ListLocalAppAgentPendingHooks(ctx context.Context, req *runtimev1.ListLocalAppAgentPendingHooksRequest) (*runtimev1.ListLocalAppAgentPendingHooksResponse, error) {
	if req == nil || len(req.ProtoReflect().GetUnknown()) != 0 {
		return nil, localAppConversationInvalid("invalid activity-plan request")
	}
	resolved, _, err := s.resolveLocalAppAgent(ctx, accountservice.LocalAppOperationAgentPendingHooksList, req.AgentHandle)
	if err != nil {
		return nil, err
	}
	entry, err := s.agentByID(resolved.identity.LocalAgentRef)
	if err != nil {
		return nil, err
	}
	response := &runtimev1.ListLocalAppAgentPendingHooksResponse{}
	for _, hook := range clonePendingHooksSorted(entry.Hooks) {
		state := hookAdmissionState(hook)
		if state != runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PENDING && state != runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_RUNNING {
			continue
		}
		if len(response.Hooks) == 100 {
			response.Truncated = true
			break
		}
		response.Hooks = append(response.Hooks, projectLocalAppPendingHook(hook))
	}
	return response, nil
}

func (s *Service) UpdateLocalAppAgentPendingHook(ctx context.Context, req *runtimev1.UpdateLocalAppAgentPendingHookRequest) (*runtimev1.UpdateLocalAppAgentPendingHookResponse, error) {
	if req == nil || len(req.ProtoReflect().GetUnknown()) != 0 {
		return nil, localAppConversationInvalid("invalid activity-plan update")
	}
	if err := validateScheduledTaskEdit(req.Action, req.ScheduledFor); err != nil {
		return nil, proactiveControlOwnerFailure(err)
	}
	resolved, _, err := s.resolveLocalAppAgent(ctx, accountservice.LocalAppOperationAgentPendingHookUpdate, req.AgentHandle)
	if err != nil {
		return nil, proactiveControlOwnerFailure(err)
	}
	var result *runtimev1.LocalAppAgentPendingHook
	triggerMemory := false
	err = s.mutateAgentWithPersistence(resolved.identity.LocalAgentRef, func(entry *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
		hook := entry.Hooks[strings.TrimSpace(req.TaskId)]
		if hook == nil || !projectLocalAppPendingHook(hook).CanModify {
			return nil, nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE, grpcerr.ReasonOptions{Message: "Only pending non-system TIME activities can be changed.", ActionHint: "refresh_agent_pending_hooks"})
		}
		if hook.Revision != req.ExpectedRevision || hook.Revision == ^uint64(0) {
			return nil, nil, grpcerr.WithReasonCodeOptions(codes.Aborted, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE, grpcerr.ReasonOptions{Message: "Activity changed; refresh before editing.", ActionHint: "refresh_agent_pending_hooks"})
		}
		now := time.Now().UTC()
		if req.Action == runtimev1.LocalAppScheduledTaskAction_LOCAL_APP_SCHEDULED_TASK_ACTION_CANCEL {
			hook.Intent.AdmissionState = runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_CANCELED
		} else {
			hook.ScheduledFor = cloneTimestamp(req.ScheduledFor)
			hook.Intent.NotBefore = cloneTimestamp(req.ScheduledFor)
			hook.Intent.TriggerDetail = timeTriggerDetail(req.ScheduledFor.AsTime().Sub(now))
		}
		result = projectLocalAppPendingHook(hook)
		result.Revision = hook.Revision + 1
		outcome := &runtimev1.HookExecutionOutcome{Intent: cloneHookIntent(hook.Intent), ObservedAt: timestamppb.New(now), Reason: "user activity-plan control"}
		events := []*runtimev1.AgentEvent{hookEventAt(entry.Agent.GetLocalAgentRef(), outcome, now)}
		if changed := s.refreshLifeTrackExecutionState(entry, stateEventOriginFromPendingHook(hook), now); changed != nil {
			events = append(events, changed)
		}
		txHook, trigger, err := s.cognitionMemoryActivityTerminalTxHook(entry, outcome, now)
		triggerMemory = trigger
		return events, txHook, err
	}, func(entry *agentEntry, events []*runtimev1.AgentEvent, sequence uint64, hook runtimeAgentStateTxHook) error {
		return s.commitLocalAppOwnerMutation(ctx, localappop.IngressAgentPendingHookUpdate, resolved.decision, func(current context.Context) error {
			return s.stateRepo.persistAgentDeltaContext(current, entry, events, sequence, hook)
		})
	})
	if err != nil {
		return nil, proactiveControlOwnerFailure(err)
	}
	if triggerMemory {
		s.triggerCognitionMemory(resolved.identity.LocalAgentRef)
	}
	return &runtimev1.UpdateLocalAppAgentPendingHookResponse{Hook: result}, nil
}

func proactiveControlOwnerFailure(err error) error {
	if err == nil {
		return nil
	}
	if _, classified := grpcerr.ExtractReasonCode(err); classified {
		return err
	}
	return grpcerr.WrapWithReasonCode(codes.Unavailable, runtimev1.ReasonCode_LOCAL_APP_OWNER_UNAVAILABLE, err, grpcerr.ReasonOptions{Message: "The activity control could not be saved. Its prior state is kept.", ActionHint: "retry_activity_control_after_owner_recovery"})
}

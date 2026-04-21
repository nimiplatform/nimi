package runtimeagent

import (
	"context"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type chatTrackRuntime struct {
	svc *Service
}

func (s *Service) chatTrackRuntime() chatTrackRuntime {
	return chatTrackRuntime{svc: s}
}

func (c chatTrackRuntime) hasSidecarExecutor() bool {
	executor := c.currentSidecarExecutor()
	_, rejecting := executor.(rejectingChatTrackSidecarExecutor)
	return !rejecting
}

func (c chatTrackRuntime) currentSidecarExecutor() ChatTrackSidecarExecutor {
	if c.svc == nil {
		return rejectingChatTrackSidecarExecutor{}
	}
	return c.svc.currentChatTrackSidecarExecutor()
}

func (c chatTrackRuntime) consumeSidecarAppMessage(ctx context.Context, event *runtimev1.AppMessageEvent) error {
	if event == nil {
		return status.Error(codes.InvalidArgument, "chat track sidecar app message is required")
	}
	if strings.TrimSpace(event.GetToAppId()) != chatTrackSidecarExecutorAppID {
		return status.Error(codes.InvalidArgument, "chat track sidecar app message target invalid")
	}
	if strings.TrimSpace(event.GetMessageType()) != chatTrackSidecarIngressType {
		return status.Error(codes.InvalidArgument, "chat track sidecar app message type invalid")
	}
	req, err := decodeChatTrackSidecarIngressPayload(event.GetPayload())
	if err != nil {
		return err
	}
	return c.executeSidecar(ctx, req)
}

func (c chatTrackRuntime) executeSidecar(ctx context.Context, req ChatTrackSidecarExecutionRequest) error {
	_, err := c.runSidecarExecution(ctx, req)
	return err
}

func (c chatTrackRuntime) runSidecarExecution(ctx context.Context, req ChatTrackSidecarExecutionRequest) (*ChatTrackSidecarApplySummary, error) {
	entry, err := c.svc.agentByID(strings.TrimSpace(req.AgentID))
	if err != nil {
		return nil, err
	}
	result, err := c.currentSidecarExecutor().ExecuteChatTrackSidecar(ctx, &ChatTrackSidecarExecutorRequest{
		Agent:         cloneAgentRecord(entry.Agent),
		State:         cloneAgentState(entry.State),
		SourceEventID: strings.TrimSpace(req.SourceEventID),
		Messages:      cloneChatMessages(req.Messages),
		PendingHooks:  clonePendingHooksSorted(entry.Hooks),
	})
	if err != nil {
		return nil, err
	}
	if result == nil {
		result = &ChatTrackSidecarResult{}
	}
	return c.applySidecar(ctx, entry.Agent.GetAgentId(), req.SourceEventID, *result)
}

func (c chatTrackRuntime) applySidecarResult(ctx context.Context, agentID string, sourceEventID string, result ChatTrackSidecarResult) error {
	_, err := c.applySidecar(ctx, agentID, sourceEventID, result)
	return err
}

func (c chatTrackRuntime) applySidecar(ctx context.Context, agentID string, sourceEventID string, result ChatTrackSidecarResult) (*ChatTrackSidecarApplySummary, error) {
	entry, err := c.svc.agentByID(strings.TrimSpace(agentID))
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()

	var posture *BehavioralPosture
	if result.PosturePatch != nil {
		normalized, err := normalizeBehavioralPosturePatch(entry.Agent.GetAgentId(), *result.PosturePatch)
		if err != nil {
			return nil, status.Error(codes.InvalidArgument, err.Error())
		}
		normalized.UpdatedAt = now.Format(time.RFC3339Nano)
		posture = &normalized
	}

	cancelHookIDs, err := validateChatTrackSidecarCancelHookIDs(entry, result.CancelPendingHookIDs)
	if err != nil {
		return nil, err
	}
	if result.NextHookIntent != nil {
		if err := validateNextHookIntent(result.NextHookIntent); err != nil {
			return nil, err
		}
	}
	candidates, err := normalizeChatTrackSidecarCandidates(entry, result.CanonicalMemoryCandidates, sourceEventID, now)
	if err != nil {
		return nil, err
	}
	if err := validateCanonicalMemoryCandidateBatch(candidates); err != nil {
		return nil, status.Error(codes.InvalidArgument, err.Error())
	}

	accepted := make([]*runtimev1.CanonicalMemoryView, 0, len(candidates))
	for _, candidate := range candidates {
		view, rejection := c.svc.writeCandidate(ctx, entry, candidate)
		if rejection != nil {
			return nil, status.Error(codes.InvalidArgument, strings.TrimSpace(rejection.GetMessage()))
		}
		if view != nil {
			accepted = append(accepted, view)
		}
	}
	if posture != nil {
		if err := c.svc.PutBehavioralPosture(ctx, *posture); err != nil {
			return nil, err
		}
		entry.State.StatusText = posture.StatusText
		entry.State.UpdatedAt = timestamppb.New(now)
	}

	events := make([]*runtimev1.AgentEvent, 0, len(cancelHookIDs)+2)
	scheduledHookID := ""
	for _, hookID := range cancelHookIDs {
		hook := entry.Hooks[hookID]
		hook.Status = runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_CANCELED
		events = append(events, hookEventAt(entry.Agent.GetAgentId(), &runtimev1.HookExecutionOutcome{
			HookId:     hookID,
			Status:     runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_CANCELED,
			Trigger:    cloneTriggerDetail(hook.GetTrigger()),
			ObservedAt: timestamppb.New(now),
			Detail: &runtimev1.HookExecutionOutcome_Canceled{
				Canceled: &runtimev1.HookCanceledDetail{
					CanceledBy: "chat_sidecar",
					Reason:     "chat sidecar",
				},
			},
		}, now))
	}
	if result.NextHookIntent != nil {
		scheduledFor, err := scheduledTimeFromIntent(result.NextHookIntent, now)
		if err != nil {
			return nil, err
		}
		followup := &runtimev1.PendingHook{
			HookId:       "hook_" + ulid.Make().String(),
			Status:       runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_PENDING,
			Trigger:      triggerDetailFromIntent(result.NextHookIntent),
			NextIntent:   cloneNextHookIntent(result.NextHookIntent),
			ScheduledFor: timestamppb.New(scheduledFor),
			AdmittedAt:   timestamppb.New(now),
		}
		entry.Hooks[followup.GetHookId()] = followup
		events = append(events, hookEventAt(entry.Agent.GetAgentId(), &runtimev1.HookExecutionOutcome{
			HookId:     followup.GetHookId(),
			Status:     runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_PENDING,
			Trigger:    cloneTriggerDetail(followup.GetTrigger()),
			ObservedAt: timestamppb.New(now),
		}, now))
		scheduledHookID = followup.GetHookId()
	}
	if len(accepted) > 0 {
		events = append(events, c.svc.newEventAt(entry.Agent.GetAgentId(), runtimev1.AgentEventType_AGENT_EVENT_TYPE_MEMORY, &runtimev1.AgentEvent_Memory{
			Memory: &runtimev1.AgentMemoryEventDetail{
				Accepted: cloneCanonicalMemoryViews(accepted),
			},
		}, now))
	}
	refreshLifeTrackState(entry, now)
	if err := c.svc.updateAgent(entry, events...); err != nil {
		return nil, err
	}
	return &ChatTrackSidecarApplySummary{
		AcceptedMemoryCount: len(accepted),
		CanceledHookIDs:     append([]string(nil), cancelHookIDs...),
		ScheduledHookID:     scheduledHookID,
		StatusText:          entry.State.GetStatusText(),
	}, nil
}

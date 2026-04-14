package agentcore

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	chatTrackSidecarSourceSystem = "runtime.agentcore.chat_sidecar"
	chatTrackSidecarPolicyReason = "chat_sidecar"
	chatTrackSidecarIngressType  = "agent.chat_track.sidecar_input.v1"
)

type chatTrackSidecarIngressPayload struct {
	AgentID       string            `json:"agent_id"`
	SourceEventID string            `json:"source_event_id"`
	ThreadID      string            `json:"thread_id"`
	Messages      []json.RawMessage `json:"messages"`
}

type ChatTrackSidecarResult struct {
	PosturePatch              *BehavioralPosturePatch
	CancelPendingHookIDs      []string
	NextHookIntent            *runtimev1.NextHookIntent
	CanonicalMemoryCandidates []*runtimev1.CanonicalMemoryCandidate
}

func (s *Service) ConsumeChatTrackSidecarAppMessage(ctx context.Context, event *runtimev1.AppMessageEvent) error {
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
	return s.ExecuteChatTrackSidecar(ctx, req)
}

func (s *Service) ApplyChatTrackSidecar(ctx context.Context, agentID string, sourceEventID string, result ChatTrackSidecarResult) error {
	entry, err := s.agentByID(strings.TrimSpace(agentID))
	if err != nil {
		return err
	}
	now := time.Now().UTC()

	var posture *BehavioralPosture
	if result.PosturePatch != nil {
		normalized, err := normalizeBehavioralPosturePatch(entry.Agent.GetAgentId(), *result.PosturePatch)
		if err != nil {
			return status.Error(codes.InvalidArgument, err.Error())
		}
		normalized.UpdatedAt = now.Format(time.RFC3339Nano)
		posture = &normalized
	}

	cancelHookIDs, err := validateChatTrackSidecarCancelHookIDs(entry, result.CancelPendingHookIDs)
	if err != nil {
		return err
	}
	if result.NextHookIntent != nil {
		if err := validateNextHookIntent(result.NextHookIntent); err != nil {
			return err
		}
	}
	candidates, err := normalizeChatTrackSidecarCandidates(entry, result.CanonicalMemoryCandidates, sourceEventID, now)
	if err != nil {
		return err
	}

	accepted := make([]*runtimev1.CanonicalMemoryView, 0, len(candidates))
	for _, candidate := range candidates {
		view, rejection := s.writeCandidate(ctx, entry, candidate)
		if rejection != nil {
			return status.Error(codes.InvalidArgument, strings.TrimSpace(rejection.GetMessage()))
		}
		if view != nil {
			accepted = append(accepted, view)
		}
	}
	if posture != nil {
		if err := s.PutBehavioralPosture(ctx, *posture); err != nil {
			return err
		}
		entry.State.StatusText = posture.StatusText
		entry.State.UpdatedAt = timestamppb.New(now)
	}

	events := make([]*runtimev1.AgentEvent, 0, len(cancelHookIDs)+2)
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
			return err
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
	}
	if len(accepted) > 0 {
		events = append(events, s.newEventAt(entry.Agent.GetAgentId(), runtimev1.AgentEventType_AGENT_EVENT_TYPE_MEMORY, &runtimev1.AgentEvent_Memory{
			Memory: &runtimev1.AgentMemoryEventDetail{
				Accepted: cloneCanonicalMemoryViews(accepted),
			},
		}, now))
	}
	refreshLifeTrackState(entry, now)
	return s.updateAgent(entry, events...)
}

func validateChatTrackSidecarCancelHookIDs(entry *agentEntry, values []string) ([]string, error) {
	if len(values) == 0 {
		return nil, nil
	}
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		hookID := strings.TrimSpace(value)
		if hookID == "" {
			return nil, status.Error(codes.InvalidArgument, "chat sidecar cancel_pending_hook_ids must not contain empty hook ids")
		}
		if _, ok := seen[hookID]; ok {
			continue
		}
		hook := entry.Hooks[hookID]
		if hook == nil {
			return nil, status.Error(codes.NotFound, "hook not found")
		}
		if !isCancelableHookStatus(hook.GetStatus()) {
			return nil, status.Error(codes.FailedPrecondition, "hook is not cancelable")
		}
		seen[hookID] = struct{}{}
		out = append(out, hookID)
	}
	return out, nil
}

func normalizeChatTrackSidecarCandidates(entry *agentEntry, values []*runtimev1.CanonicalMemoryCandidate, sourceEventID string, now time.Time) ([]*runtimev1.CanonicalMemoryCandidate, error) {
	if len(values) == 0 {
		return nil, nil
	}
	out := make([]*runtimev1.CanonicalMemoryCandidate, 0, len(values))
	defaultSourceEventID := firstNonEmpty(sourceEventID, "chat_sidecar")
	for _, value := range values {
		if value == nil {
			return nil, status.Error(codes.InvalidArgument, "chat sidecar canonical_memory_candidates must not contain null entries")
		}
		candidate := proto.Clone(value).(*runtimev1.CanonicalMemoryCandidate)
		if candidate.GetRecord() == nil || candidate.GetTargetBank() == nil {
			return nil, status.Error(codes.InvalidArgument, "chat sidecar canonical memory candidate target_bank and record are required")
		}
		if err := validateCandidateLocator(entry.Agent.GetAgentId(), candidate); err != nil {
			return nil, status.Error(codes.InvalidArgument, err.Error())
		}
		if rejection := validateWorldSharedCandidateAdmission(entry, candidate); rejection != nil {
			return nil, status.Error(codes.InvalidArgument, strings.TrimSpace(rejection.GetMessage()))
		}
		record := cloneMemoryRecordInput(candidate.GetRecord())
		if err := validateLifeTurnRecordInput(record); err != nil {
			return nil, status.Error(codes.InvalidArgument, fmt.Sprintf("chat sidecar memory candidate invalid: %v", err))
		}
		record.CanonicalClass = candidate.GetCanonicalClass()
		record.Provenance = normalizeChatTrackSidecarProvenance(record.GetProvenance(), firstNonEmpty(candidate.GetSourceEventId(), defaultSourceEventID), now)
		candidate.Record = record
		candidate.TargetBank = cloneLocator(candidate.GetTargetBank())
		candidate.PolicyReason = firstNonEmpty(candidate.GetPolicyReason(), chatTrackSidecarPolicyReason)
		candidate.SourceEventId = firstNonEmpty(candidate.GetSourceEventId(), defaultSourceEventID)
		out = append(out, candidate)
	}
	return out, nil
}

func normalizeChatTrackSidecarProvenance(input *runtimev1.MemoryProvenance, sourceEventID string, now time.Time) *runtimev1.MemoryProvenance {
	provenance := input
	if provenance == nil {
		provenance = &runtimev1.MemoryProvenance{}
	}
	if strings.TrimSpace(provenance.GetSourceSystem()) == "" {
		provenance.SourceSystem = chatTrackSidecarSourceSystem
	}
	if strings.TrimSpace(provenance.GetSourceEventId()) == "" {
		provenance.SourceEventId = strings.TrimSpace(sourceEventID)
	}
	if provenance.GetCommittedAt() == nil {
		provenance.CommittedAt = timestamppb.New(now)
	}
	return provenance
}

func decodeChatTrackSidecarIngressPayload(payload any) (ChatTrackSidecarExecutionRequest, error) {
	structPayload, ok := payload.(interface{ AsMap() map[string]any })
	if !ok || structPayload == nil {
		return ChatTrackSidecarExecutionRequest{}, status.Error(codes.InvalidArgument, "chat track sidecar payload is required")
	}
	raw, err := json.Marshal(structPayload.AsMap())
	if err != nil {
		return ChatTrackSidecarExecutionRequest{}, status.Error(codes.InvalidArgument, "chat track sidecar payload invalid")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var decoded chatTrackSidecarIngressPayload
	if err := decoder.Decode(&decoded); err != nil {
		return ChatTrackSidecarExecutionRequest{}, status.Error(codes.InvalidArgument, "chat track sidecar payload invalid")
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return ChatTrackSidecarExecutionRequest{}, status.Error(codes.InvalidArgument, "chat track sidecar payload must contain one object")
		}
		return ChatTrackSidecarExecutionRequest{}, status.Error(codes.InvalidArgument, "chat track sidecar payload invalid")
	}
	agentID := strings.TrimSpace(decoded.AgentID)
	sourceEventID := strings.TrimSpace(decoded.SourceEventID)
	threadID := strings.TrimSpace(decoded.ThreadID)
	if agentID == "" || sourceEventID == "" || threadID == "" {
		return ChatTrackSidecarExecutionRequest{}, status.Error(codes.InvalidArgument, "chat track sidecar payload fields required")
	}
	if len(decoded.Messages) == 0 {
		return ChatTrackSidecarExecutionRequest{}, status.Error(codes.InvalidArgument, "chat track sidecar messages required")
	}
	messages := make([]*runtimev1.ChatMessage, 0, len(decoded.Messages))
	unmarshal := protojson.UnmarshalOptions{DiscardUnknown: false}
	for _, item := range decoded.Messages {
		message := &runtimev1.ChatMessage{}
		if err := unmarshal.Unmarshal(item, message); err != nil {
			return ChatTrackSidecarExecutionRequest{}, status.Error(codes.InvalidArgument, "chat track sidecar message invalid")
		}
		if strings.TrimSpace(message.GetRole()) == "" {
			return ChatTrackSidecarExecutionRequest{}, status.Error(codes.InvalidArgument, "chat track sidecar message role required")
		}
		if strings.TrimSpace(message.GetContent()) == "" && len(message.GetParts()) == 0 {
			return ChatTrackSidecarExecutionRequest{}, status.Error(codes.InvalidArgument, "chat track sidecar message content required")
		}
		messages = append(messages, message)
	}
	return ChatTrackSidecarExecutionRequest{
		AgentID:       agentID,
		SourceEventID: sourceEventID,
		Messages:      messages,
	}, nil
}

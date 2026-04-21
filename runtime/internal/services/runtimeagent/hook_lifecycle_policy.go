package runtimeagent

import (
	"fmt"
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/durationpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	autonomyCadenceHookReason       = "runtime.autonomy.cadence_tick"
	autonomyCadenceHookCancelReason = "runtime autonomy cadence reconciliation"
)

type resolvedCadencePolicy struct {
	mode       runtimev1.AgentAutonomyMode
	baseTick   time.Duration
	minSpacing time.Duration
}

func normalizePendingHook(input *runtimev1.PendingHook, now time.Time) (*runtimev1.PendingHook, error) {
	if input == nil || strings.TrimSpace(input.GetHookId()) == "" || input.GetTrigger() == nil || input.GetNextIntent() == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if err := validateHookTriggerDetail(input.GetTrigger()); err != nil {
		return nil, err
	}
	if err := validateNextHookIntent(input.GetNextIntent()); err != nil {
		return nil, err
	}
	if input.GetTrigger().GetTriggerKind() != input.GetNextIntent().GetTriggerKind() {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	scheduledFor, err := resolveScheduledFor(input, now)
	if err != nil {
		return nil, err
	}
	hook := clonePendingHook(input)
	hook.Status = runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_PENDING
	hook.Trigger = cloneTriggerDetail(input.GetTrigger())
	hook.NextIntent = cloneNextHookIntent(input.GetNextIntent())
	hook.ScheduledFor = timestamppb.New(scheduledFor)
	if input.GetAdmittedAt() == nil {
		hook.AdmittedAt = timestamppb.New(now)
	} else {
		hook.AdmittedAt = cloneTimestamp(input.GetAdmittedAt())
	}
	return hook, nil
}

func resolveScheduledFor(hook *runtimev1.PendingHook, now time.Time) (time.Time, error) {
	_ = now
	intent := hook.GetNextIntent()
	if intent == nil {
		return time.Time{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	var scheduled time.Time
	switch intent.GetTriggerKind() {
	case runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_SCHEDULED_TIME:
		detail := intent.GetScheduledTime()
		if detail == nil || detail.GetScheduledFor() == nil {
			return time.Time{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		scheduled = detail.GetScheduledFor().AsTime()
	default:
		switch {
		case intent.GetNotBefore() != nil:
			scheduled = intent.GetNotBefore().AsTime()
		case hook.GetScheduledFor() != nil && !hook.GetScheduledFor().AsTime().IsZero():
			scheduled = hook.GetScheduledFor().AsTime()
		default:
			return time.Time{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
	}
	if hook.GetScheduledFor() != nil && !hook.GetScheduledFor().AsTime().IsZero() && !hook.GetScheduledFor().AsTime().Equal(scheduled) {
		return time.Time{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	return scheduled.UTC(), nil
}

func scheduledTimeFromIntent(intent *runtimev1.NextHookIntent, now time.Time) (time.Time, error) {
	return resolveScheduledFor(&runtimev1.PendingHook{
		HookId:     "hook_preview",
		Trigger:    triggerDetailFromIntent(intent),
		NextIntent: cloneNextHookIntent(intent),
	}, now)
}

func validateHookTriggerDetail(detail *runtimev1.HookTriggerDetail) error {
	if detail == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	switch detail.GetTriggerKind() {
	case runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_TURN_COMPLETED:
		if detail.GetTurnCompleted() == nil {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
	case runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_SCHEDULED_TIME:
		if detail.GetScheduledTime() == nil || detail.GetScheduledTime().GetScheduledFor() == nil {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
	case runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_USER_IDLE:
		if detail.GetUserIdle() == nil {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
	case runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_CHAT_ENDED:
		if detail.GetChatEnded() == nil {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
	case runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_STATE_CONDITION:
		if detail.GetStateCondition() == nil {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
	case runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_WORLD_EVENT:
		if detail.GetWorldEvent() == nil {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
	case runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_COMPOUND:
		compound := detail.GetCompound()
		if compound == nil || len(compound.GetTriggers()) == 0 {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		for _, nested := range compound.GetTriggers() {
			if err := validateHookTriggerDetail(nested); err != nil {
				return err
			}
		}
	default:
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	return nil
}

func validateNextHookIntent(intent *runtimev1.NextHookIntent) error {
	if intent == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if intent.GetNotBefore() != nil && intent.GetExpiresAt() != nil &&
		intent.GetExpiresAt().AsTime().Before(intent.GetNotBefore().AsTime()) {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	switch intent.GetCadenceInteraction() {
	case runtimev1.HookCadenceInteraction_HOOK_CADENCE_INTERACTION_UNSPECIFIED,
		runtimev1.HookCadenceInteraction_HOOK_CADENCE_INTERACTION_NORMAL,
		runtimev1.HookCadenceInteraction_HOOK_CADENCE_INTERACTION_SUPPRESS_BASE_TICK_UNTIL_FIRED:
	case runtimev1.HookCadenceInteraction_HOOK_CADENCE_INTERACTION_SUPPRESS_BASE_TICK_UNTIL_EXPIRED:
		if intent.GetExpiresAt() == nil || intent.GetExpiresAt().AsTime().IsZero() {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
	default:
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	switch intent.GetTriggerKind() {
	case runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_TURN_COMPLETED:
		if intent.GetTurnCompleted() == nil {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
	case runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_SCHEDULED_TIME:
		if intent.GetScheduledTime() == nil || intent.GetScheduledTime().GetScheduledFor() == nil {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
	case runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_USER_IDLE:
		if intent.GetUserIdle() == nil {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
	case runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_CHAT_ENDED:
		if intent.GetChatEnded() == nil {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
	case runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_STATE_CONDITION:
		if intent.GetStateCondition() == nil {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
	case runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_WORLD_EVENT:
		if intent.GetWorldEvent() == nil {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
	case runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_COMPOUND:
		compound := intent.GetCompound()
		if compound == nil || len(compound.GetIntents()) == 0 {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		for _, nested := range compound.GetIntents() {
			if err := validateNextHookIntent(nested); err != nil {
				return err
			}
		}
	default:
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	return nil
}

func refreshLifeTrackState(entry *agentEntry, now time.Time) {
	if entry == nil || entry.State == nil {
		return
	}
	next := entry.State.GetExecutionState()
	switch {
	case entry.Agent != nil && entry.Agent.GetLifecycleStatus() == runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_TERMINATED:
		next = runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_SUSPENDED
	case hasHookStatus(entry, runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_RUNNING):
		next = runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_LIFE_RUNNING
	case hasHookStatus(entry, runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_PENDING):
		next = runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_LIFE_PENDING
	case next != runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_CHAT_ACTIVE:
		next = runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_IDLE
	}
	if entry.State.GetExecutionState() != next {
		entry.State.ExecutionState = next
		entry.State.UpdatedAt = timestamppb.New(now)
	}
}

func hasHookStatus(entry *agentEntry, expected runtimev1.AgentHookStatus) bool {
	if entry == nil {
		return false
	}
	for _, hook := range entry.Hooks {
		if hook != nil && hook.GetStatus() == expected {
			return true
		}
	}
	return false
}

func isCancelableHookStatus(status runtimev1.AgentHookStatus) bool {
	return status == runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_PENDING ||
		status == runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_RUNNING
}

func cloneNextHookIntent(input *runtimev1.NextHookIntent) *runtimev1.NextHookIntent {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.NextHookIntent)
}

func worldSharedAdmissionError() error {
	return status.Error(codes.FailedPrecondition, "WORLD_SHARED canonical memory requires runtime-owned active_world_id on Agent Core")
}

func requiresExplicitWorldSharedAdmission(classes []runtimev1.MemoryCanonicalClass) bool {
	for _, class := range classes {
		if class == runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_WORLD_SHARED {
			return true
		}
	}
	return false
}

func validateWorldSharedCandidateAdmission(entry *agentEntry, candidate *runtimev1.CanonicalMemoryCandidate) *runtimev1.CanonicalMemoryRejection {
	if candidate == nil || candidate.GetCanonicalClass() != runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_WORLD_SHARED {
		return nil
	}
	if err := validateWorldSharedAgentState(entry); err != nil {
		return rejection(candidate, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err.Error())
	}
	target := candidate.GetTargetBank()
	if target == nil || target.GetWorldShared() == nil {
		return rejection(candidate, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, "WORLD_SHARED candidate requires world_shared target bank")
	}
	if strings.TrimSpace(target.GetWorldShared().GetWorldId()) != strings.TrimSpace(entry.State.GetActiveWorldId()) {
		return rejection(candidate, runtimev1.ReasonCode_AI_OUTPUT_INVALID, "WORLD_SHARED target bank must match runtime-owned active_world_id")
	}
	return nil
}

func validateWorldSharedAgentState(entry *agentEntry) error {
	if entry == nil || entry.State == nil {
		return fmt.Errorf("agent entry is required")
	}
	if strings.TrimSpace(entry.State.GetActiveWorldId()) == "" {
		return worldSharedAdmissionError()
	}
	return nil
}

func (s *Service) duePendingHooks(now time.Time) []dueHookRef {
	s.mu.RLock()
	items := make([]dueHookRef, 0)
	for agentID, entry := range s.agents {
		if entry == nil {
			continue
		}
		for hookID, hook := range entry.Hooks {
			if hook == nil || hook.GetStatus() != runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_PENDING {
				continue
			}
			if hook.GetScheduledFor() == nil || hook.GetScheduledFor().AsTime().IsZero() {
				continue
			}
			scheduledFor := hook.GetScheduledFor().AsTime()
			if scheduledFor.After(now) {
				continue
			}
			items = append(items, dueHookRef{agentID: agentID, hookID: hookID, scheduledFor: scheduledFor})
		}
	}
	s.mu.RUnlock()
	sort.Slice(items, func(i, j int) bool {
		if items[i].scheduledFor.Equal(items[j].scheduledFor) {
			if items[i].agentID == items[j].agentID {
				return items[i].hookID < items[j].hookID
			}
			return items[i].agentID < items[j].agentID
		}
		return items[i].scheduledFor.Before(items[j].scheduledFor)
	})
	return items
}

func gateHookExecution(entry *agentEntry, hook *runtimev1.PendingHook, now time.Time) *hookExecutionDecision {
	if entry == nil || entry.Agent == nil || entry.State == nil {
		return rejectedHookDecision(runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, "hook execution requires committed agent state")
	}
	if entry.Agent.GetLifecycleStatus() != runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE {
		return rejectedHookDecision(runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, "agent is not active")
	}
	autonomy := entry.Agent.GetAutonomy()
	if autonomy == nil || !autonomy.GetEnabled() {
		return rejectedHookDecision(runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, "agent autonomy is disabled")
	}
	if autonomyMode(autonomy.GetConfig()) == runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_OFF {
		return rejectedHookDecision(runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, "agent autonomy mode is off")
	}
	if suspendedUntil := autonomy.GetSuspendedUntil(); suspendedUntil != nil && suspendedUntil.AsTime().After(now) {
		return rescheduledHookDecision(&runtimev1.NextHookIntent{
			TriggerKind: runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_SCHEDULED_TIME,
			NotBefore:   cloneTimestamp(suspendedUntil),
			Reason:      "autonomy suspended",
			Detail: &runtimev1.NextHookIntent_ScheduledTime{
				ScheduledTime: &runtimev1.ScheduledTimeHookIntent{
					ScheduledFor: cloneTimestamp(suspendedUntil),
				},
			},
		}, 0)
	}
	if autonomy.GetBudgetExhausted() {
		resumeAt := nextAutonomyWindowStart(autonomy, now)
		return rescheduledHookDecision(&runtimev1.NextHookIntent{
			TriggerKind: runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_SCHEDULED_TIME,
			NotBefore:   timestamppb.New(resumeAt),
			Reason:      "autonomy budget exhausted",
			Detail: &runtimev1.NextHookIntent_ScheduledTime{
				ScheduledTime: &runtimev1.ScheduledTimeHookIntent{
					ScheduledFor: timestamppb.New(resumeAt),
				},
			},
		}, 0)
	}
	if policy, ok := resolveCadencePolicy(autonomy.GetConfig()); ok {
		if anchor, ok := latestLifeTurnAnchor(entry); ok {
			minAllowed := anchor.Add(policy.minSpacing)
			if now.Before(minAllowed) {
				return rescheduledHookDecision(&runtimev1.NextHookIntent{
					TriggerKind: runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_SCHEDULED_TIME,
					NotBefore:   timestamppb.New(minAllowed),
					Reason:      firstNonEmpty(hook.GetNextIntent().GetReason(), "min spacing gate"),
					Detail: &runtimev1.NextHookIntent_ScheduledTime{
						ScheduledTime: &runtimev1.ScheduledTimeHookIntent{
							ScheduledFor: timestamppb.New(minAllowed),
						},
					},
				}, 0)
			}
		}
	}
	return nil
}

func resolveCadencePolicy(config *runtimev1.AgentAutonomyConfig) (resolvedCadencePolicy, bool) {
	mode := autonomyMode(config)
	switch mode {
	case runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_LOW:
		return resolvedCadencePolicy{
			mode:       mode,
			baseTick:   120 * time.Minute,
			minSpacing: firstPositiveDuration(config.GetMinHookInterval(), 60*time.Minute),
		}, true
	case runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_MEDIUM:
		return resolvedCadencePolicy{
			mode:       mode,
			baseTick:   60 * time.Minute,
			minSpacing: firstPositiveDuration(config.GetMinHookInterval(), 30*time.Minute),
		}, true
	case runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_HIGH:
		return resolvedCadencePolicy{
			mode:       mode,
			baseTick:   30 * time.Minute,
			minSpacing: firstPositiveDuration(config.GetMinHookInterval(), 15*time.Minute),
		}, true
	default:
		return resolvedCadencePolicy{}, false
	}
}

func firstPositiveDuration(value *durationpb.Duration, fallback time.Duration) time.Duration {
	if value == nil {
		return fallback
	}
	duration := value.AsDuration()
	if duration <= 0 {
		return fallback
	}
	return duration
}

func isCadenceTickIntent(intent *runtimev1.NextHookIntent) bool {
	return intent != nil &&
		intent.GetTriggerKind() == runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_SCHEDULED_TIME &&
		strings.TrimSpace(intent.GetReason()) == autonomyCadenceHookReason
}

func isCadenceTickHook(hook *runtimev1.PendingHook) bool {
	return hook != nil && isCadenceTickIntent(hook.GetNextIntent())
}

func latestLifeTurnAnchor(entry *agentEntry) (time.Time, bool) {
	if entry == nil {
		return time.Time{}, false
	}
	var latest time.Time
	for _, hook := range entry.Hooks {
		if hook == nil {
			continue
		}
		switch hook.GetStatus() {
		case runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_COMPLETED,
			runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_FAILED,
			runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_RESCHEDULED,
			runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_REJECTED:
		default:
			continue
		}
		candidate := time.Time{}
		if hook.GetScheduledFor() != nil && !hook.GetScheduledFor().AsTime().IsZero() {
			candidate = hook.GetScheduledFor().AsTime().UTC()
		} else if hook.GetAdmittedAt() != nil && !hook.GetAdmittedAt().AsTime().IsZero() {
			candidate = hook.GetAdmittedAt().AsTime().UTC()
		}
		if candidate.IsZero() {
			continue
		}
		if latest.IsZero() || candidate.After(latest) {
			latest = candidate
		}
	}
	if latest.IsZero() {
		return time.Time{}, false
	}
	return latest, true
}

func activeCadenceSuppressionUntil(entry *agentEntry, now time.Time) (time.Time, bool) {
	if entry == nil {
		return time.Time{}, false
	}
	var suppression time.Time
	for _, hook := range entry.Hooks {
		if hook == nil || isCadenceTickHook(hook) {
			continue
		}
		if hook.GetStatus() != runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_PENDING &&
			hook.GetStatus() != runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_RUNNING {
			continue
		}
		intent := hook.GetNextIntent()
		if intent == nil {
			continue
		}
		var candidate time.Time
		switch intent.GetCadenceInteraction() {
		case runtimev1.HookCadenceInteraction_HOOK_CADENCE_INTERACTION_SUPPRESS_BASE_TICK_UNTIL_FIRED:
			if hook.GetScheduledFor() != nil && !hook.GetScheduledFor().AsTime().IsZero() {
				candidate = hook.GetScheduledFor().AsTime().UTC()
			}
		case runtimev1.HookCadenceInteraction_HOOK_CADENCE_INTERACTION_SUPPRESS_BASE_TICK_UNTIL_EXPIRED:
			if intent.GetExpiresAt() != nil && !intent.GetExpiresAt().AsTime().IsZero() {
				candidate = intent.GetExpiresAt().AsTime().UTC()
			}
		}
		if candidate.IsZero() || candidate.Before(now) {
			continue
		}
		if suppression.IsZero() || candidate.After(suppression) {
			suppression = candidate
		}
	}
	if suppression.IsZero() {
		return time.Time{}, false
	}
	return suppression, true
}

func earliestPendingNonCadenceHookAt(entry *agentEntry) (time.Time, bool) {
	if entry == nil {
		return time.Time{}, false
	}
	var earliest time.Time
	for _, hook := range entry.Hooks {
		if hook == nil || isCadenceTickHook(hook) || hook.GetStatus() != runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_PENDING {
			continue
		}
		if hook.GetScheduledFor() == nil || hook.GetScheduledFor().AsTime().IsZero() {
			continue
		}
		candidate := hook.GetScheduledFor().AsTime().UTC()
		if earliest.IsZero() || candidate.Before(earliest) {
			earliest = candidate
		}
	}
	if earliest.IsZero() {
		return time.Time{}, false
	}
	return earliest, true
}

func cadenceTickScheduledAt(entry *agentEntry, now time.Time) (time.Time, bool) {
	if entry == nil || entry.Agent == nil || entry.Agent.GetAutonomy() == nil || !entry.Agent.GetAutonomy().GetEnabled() {
		return time.Time{}, false
	}
	policy, ok := resolveCadencePolicy(entry.Agent.GetAutonomy().GetConfig())
	if !ok {
		return time.Time{}, false
	}
	anchor := now
	if latest, ok := latestLifeTurnAnchor(entry); ok {
		anchor = latest
	}
	scheduledAt := anchor.Add(policy.baseTick)
	if scheduledAt.Before(now) {
		scheduledAt = now
	}
	if suppression, ok := activeCadenceSuppressionUntil(entry, now); ok && suppression.After(scheduledAt) {
		scheduledAt = suppression
	}
	if latest, ok := latestLifeTurnAnchor(entry); ok {
		minAllowed := latest.Add(policy.minSpacing)
		if scheduledAt.Before(minAllowed) {
			scheduledAt = minAllowed
		}
	}
	return scheduledAt.UTC(), true
}

func cadenceTickIntent(scheduledAt time.Time) *runtimev1.NextHookIntent {
	return &runtimev1.NextHookIntent{
		TriggerKind:        runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_SCHEDULED_TIME,
		NotBefore:          timestamppb.New(scheduledAt),
		Reason:             autonomyCadenceHookReason,
		CadenceInteraction: runtimev1.HookCadenceInteraction_HOOK_CADENCE_INTERACTION_NORMAL,
		Detail: &runtimev1.NextHookIntent_ScheduledTime{
			ScheduledTime: &runtimev1.ScheduledTimeHookIntent{
				ScheduledFor: timestamppb.New(scheduledAt),
			},
		},
	}
}

func cadenceTickTrigger(scheduledAt time.Time) *runtimev1.HookTriggerDetail {
	return &runtimev1.HookTriggerDetail{
		TriggerKind: runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_SCHEDULED_TIME,
		Detail: &runtimev1.HookTriggerDetail_ScheduledTime{
			ScheduledTime: &runtimev1.ScheduledTimeTriggerDetail{
				ScheduledFor: timestamppb.New(scheduledAt),
			},
		},
	}
}

func (s *Service) reconcileCadenceHooks(now time.Time) error {
	s.mu.RLock()
	agentIDs := make([]string, 0, len(s.agents))
	for agentID := range s.agents {
		agentIDs = append(agentIDs, agentID)
	}
	s.mu.RUnlock()
	sort.Strings(agentIDs)
	for _, agentID := range agentIDs {
		if err := s.reconcileAgentCadenceHook(agentID, now); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) reconcileAgentCadenceHook(agentID string, now time.Time) error {
	entry, err := s.agentByID(strings.TrimSpace(agentID))
	if err != nil {
		return nil
	}

	pendingCadence := make([]*runtimev1.PendingHook, 0)
	for _, hook := range entry.Hooks {
		if hook != nil && isCadenceTickHook(hook) && hook.GetStatus() == runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_PENDING {
			pendingCadence = append(pendingCadence, hook)
		}
	}
	sort.Slice(pendingCadence, func(i, j int) bool {
		return pendingCadence[i].GetHookId() < pendingCadence[j].GetHookId()
	})

	cancelHooks := func(hooks []*runtimev1.PendingHook, reason string) error {
		if len(hooks) == 0 {
			return nil
		}
		events := make([]*runtimev1.AgentEvent, 0, len(hooks))
		for _, hook := range hooks {
			hook.Status = runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_CANCELED
			events = append(events, hookEventAt(entry.Agent.GetAgentId(), &runtimev1.HookExecutionOutcome{
				HookId:     hook.GetHookId(),
				Status:     runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_CANCELED,
				Trigger:    cloneTriggerDetail(hook.GetTrigger()),
				ObservedAt: timestamppb.New(now),
				Detail: &runtimev1.HookExecutionOutcome_Canceled{
					Canceled: &runtimev1.HookCanceledDetail{
						CanceledBy: "runtime",
						Reason:     firstNonEmpty(strings.TrimSpace(reason), autonomyCadenceHookCancelReason),
					},
				},
			}, now))
		}
		refreshLifeTrackState(entry, now)
		return s.updateAgent(entry, events...)
	}

	autonomy := entry.Agent.GetAutonomy()
	if autonomy == nil || !autonomy.GetEnabled() || autonomyMode(autonomy.GetConfig()) == runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_OFF {
		return cancelHooks(pendingCadence, "autonomy disabled or off")
	}

	scheduledAt, ok := cadenceTickScheduledAt(entry, now)
	if !ok {
		return cancelHooks(pendingCadence, "cadence mode unavailable")
	}
	if earliestOther, ok := earliestPendingNonCadenceHookAt(entry); ok && !earliestOther.After(scheduledAt) {
		return cancelHooks(pendingCadence, "earlier non-cadence hook admitted")
	}

	if len(pendingCadence) == 0 {
		hookID := "hook_tick_" + ulid.Make().String()
		entry.Hooks[hookID] = &runtimev1.PendingHook{
			HookId:       hookID,
			Status:       runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_PENDING,
			Trigger:      cadenceTickTrigger(scheduledAt),
			NextIntent:   cadenceTickIntent(scheduledAt),
			ScheduledFor: timestamppb.New(scheduledAt),
			AdmittedAt:   timestamppb.New(now),
		}
		refreshLifeTrackState(entry, now)
		return s.updateAgent(entry, hookEventAt(entry.Agent.GetAgentId(), &runtimev1.HookExecutionOutcome{
			HookId:     hookID,
			Status:     runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_PENDING,
			Trigger:    cadenceTickTrigger(scheduledAt),
			ObservedAt: timestamppb.New(now),
		}, now))
	}

	primary := pendingCadence[0]
	primary.Trigger = cadenceTickTrigger(scheduledAt)
	primary.NextIntent = cadenceTickIntent(scheduledAt)
	primary.ScheduledFor = timestamppb.New(scheduledAt)
	refreshLifeTrackState(entry, now)
	if err := s.updateAgent(entry); err != nil {
		return err
	}
	if len(pendingCadence) <= 1 {
		return nil
	}
	return cancelHooks(pendingCadence[1:], "duplicate cadence hooks")
}

func nextAutonomyWindowStart(autonomy *runtimev1.AgentAutonomyState, now time.Time) time.Time {
	if autonomy == nil || autonomy.GetWindowStartedAt() == nil {
		return now.Add(24 * time.Hour).UTC()
	}
	return autonomy.GetWindowStartedAt().AsTime().Add(24 * time.Hour).UTC()
}

func completedHookDecision(summary string, tokensUsed int64) *hookExecutionDecision {
	return &hookExecutionDecision{
		status:     runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_COMPLETED,
		summary:    strings.TrimSpace(summary),
		tokensUsed: tokensUsed,
	}
}

func failedHookDecision(reasonCode runtimev1.ReasonCode, message string, retryable bool, tokensUsed int64) *hookExecutionDecision {
	return &hookExecutionDecision{
		status:     runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_FAILED,
		reasonCode: reasonCode,
		message:    strings.TrimSpace(message),
		retryable:  retryable,
		tokensUsed: tokensUsed,
	}
}

func rescheduledHookDecision(nextIntent *runtimev1.NextHookIntent, tokensUsed int64) *hookExecutionDecision {
	return &hookExecutionDecision{
		status:     runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_RESCHEDULED,
		nextIntent: cloneNextHookIntent(nextIntent),
		tokensUsed: tokensUsed,
	}
}

func rejectedHookDecision(reasonCode runtimev1.ReasonCode, message string) *hookExecutionDecision {
	return &hookExecutionDecision{
		status:     runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_REJECTED,
		reasonCode: reasonCode,
		message:    strings.TrimSpace(message),
	}
}

func applyTokenUsage(entry *agentEntry, tokensUsed int64, now time.Time) {
	if entry == nil || entry.Agent == nil || entry.Agent.Autonomy == nil || tokensUsed <= 0 {
		return
	}
	entry.Agent.Autonomy.UsedTokensInWindow += tokensUsed
	if entry.Agent.Autonomy.WindowStartedAt == nil {
		entry.Agent.Autonomy.WindowStartedAt = timestamppb.New(now)
	}
	budget := entry.Agent.Autonomy.GetConfig().GetDailyTokenBudget()
	entry.Agent.Autonomy.BudgetExhausted = budget > 0 && entry.Agent.Autonomy.GetUsedTokensInWindow() >= budget
	entry.Agent.UpdatedAt = timestamppb.New(now)
}

type autonomySnapshot struct {
	usedTokens      int64
	remainingTokens int64
	budgetExhausted bool
	windowStartedAt time.Time
	hasWindowStart  bool
}

func snapshotAutonomy(state *runtimev1.AgentAutonomyState) autonomySnapshot {
	snapshot := autonomySnapshot{}
	if state == nil {
		return snapshot
	}
	snapshot.usedTokens = state.GetUsedTokensInWindow()
	snapshot.remainingTokens = remainingTokens(state)
	snapshot.budgetExhausted = state.GetBudgetExhausted()
	if state.GetWindowStartedAt() != nil {
		snapshot.windowStartedAt = state.GetWindowStartedAt().AsTime().UTC()
		snapshot.hasWindowStart = !snapshot.windowStartedAt.IsZero()
	}
	return snapshot
}

func budgetEventForTransition(agentID string, before autonomySnapshot, after *runtimev1.AgentAutonomyState, now time.Time) *runtimev1.AgentEvent {
	if after == nil {
		return nil
	}
	current := snapshotAutonomy(after)
	if before.usedTokens == current.usedTokens &&
		before.remainingTokens == current.remainingTokens &&
		before.budgetExhausted == current.budgetExhausted &&
		before.hasWindowStart == current.hasWindowStart &&
		(!before.hasWindowStart || before.windowStartedAt.Equal(current.windowStartedAt)) {
		return nil
	}
	return &runtimev1.AgentEvent{
		EventType: runtimev1.AgentEventType_AGENT_EVENT_TYPE_BUDGET,
		AgentId:   strings.TrimSpace(agentID),
		Timestamp: timestamppb.New(now.UTC()),
		Detail: &runtimev1.AgentEvent_Budget{
			Budget: &runtimev1.AgentBudgetEventDetail{
				BudgetExhausted: after.GetBudgetExhausted(),
				RemainingTokens: remainingTokens(after),
				WindowStartedAt: cloneTimestamp(after.GetWindowStartedAt()),
			},
		},
	}
}

func optionalEvents(events ...*runtimev1.AgentEvent) []*runtimev1.AgentEvent {
	out := make([]*runtimev1.AgentEvent, 0, len(events))
	for _, event := range events {
		if event != nil {
			out = append(out, event)
		}
	}
	return out
}

func triggerDetailFromIntent(intent *runtimev1.NextHookIntent) *runtimev1.HookTriggerDetail {
	if intent == nil {
		return nil
	}
	trigger := &runtimev1.HookTriggerDetail{
		TriggerKind: intent.GetTriggerKind(),
	}
	switch detail := intent.GetDetail().(type) {
	case *runtimev1.NextHookIntent_TurnCompleted:
		trigger.Detail = &runtimev1.HookTriggerDetail_TurnCompleted{
			TurnCompleted: &runtimev1.TurnCompletedTriggerDetail{
				TurnId: detail.TurnCompleted.GetAfterTurnId(),
				Track:  detail.TurnCompleted.GetTrack(),
			},
		}
	case *runtimev1.NextHookIntent_ScheduledTime:
		trigger.Detail = &runtimev1.HookTriggerDetail_ScheduledTime{
			ScheduledTime: &runtimev1.ScheduledTimeTriggerDetail{
				ScheduledFor: cloneTimestamp(detail.ScheduledTime.GetScheduledFor()),
			},
		}
	case *runtimev1.NextHookIntent_UserIdle:
		var idleFor *durationpb.Duration
		if detail.UserIdle != nil && detail.UserIdle.GetIdleFor() != nil {
			idleFor = durationpb.New(detail.UserIdle.GetIdleFor().AsDuration())
		}
		trigger.Detail = &runtimev1.HookTriggerDetail_UserIdle{
			UserIdle: &runtimev1.UserIdleTriggerDetail{
				IdleFor: idleFor,
			},
		}
	case *runtimev1.NextHookIntent_ChatEnded:
		trigger.Detail = &runtimev1.HookTriggerDetail_ChatEnded{
			ChatEnded: &runtimev1.ChatEndedTriggerDetail{
				ConversationId: detail.ChatEnded.GetConversationId(),
			},
		}
	case *runtimev1.NextHookIntent_StateCondition:
		trigger.Detail = &runtimev1.HookTriggerDetail_StateCondition{
			StateCondition: &runtimev1.StateConditionTriggerDetail{
				ConditionKey:   detail.StateCondition.GetConditionKey(),
				ConditionValue: detail.StateCondition.GetConditionValue(),
			},
		}
	case *runtimev1.NextHookIntent_WorldEvent:
		trigger.Detail = &runtimev1.HookTriggerDetail_WorldEvent{
			WorldEvent: &runtimev1.WorldEventTriggerDetail{
				WorldId:   detail.WorldEvent.GetWorldId(),
				EventType: detail.WorldEvent.GetEventType(),
				EventId:   detail.WorldEvent.GetEventId(),
			},
		}
	case *runtimev1.NextHookIntent_Compound:
		triggers := make([]*runtimev1.HookTriggerDetail, 0, len(detail.Compound.GetIntents()))
		for _, nested := range detail.Compound.GetIntents() {
			if converted := triggerDetailFromIntent(nested); converted != nil {
				triggers = append(triggers, converted)
			}
		}
		trigger.Detail = &runtimev1.HookTriggerDetail_Compound{
			Compound: &runtimev1.CompoundHookTriggerDetail{
				Operator: detail.Compound.GetOperator(),
				Triggers: triggers,
			},
		}
	}
	return trigger
}

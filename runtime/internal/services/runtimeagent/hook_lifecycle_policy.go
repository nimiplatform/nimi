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

// K-AGCORE-041 / K-AGCORE-043 narrow-admission vocabulary.
// Admitted trigger matrix is:
//   - time(delay)        family = TIME
//   - event(user_idle)   family = EVENT, event_user_idle detail
//   - event(chat_ended)  family = EVENT, event_chat_ended detail
// Admitted effect is: follow-up-turn.
// No absolute scheduled time, turn_completed, state_condition, world_event,
// or compound trigger is admitted. No cadence-interaction blob is admitted.

const (
	autonomyCadenceHookReason       = "runtime.autonomy.cadence_tick"
	autonomyCadenceHookCancelReason = "runtime autonomy cadence reconciliation"
)

type resolvedCadencePolicy struct {
	mode       runtimev1.AgentAutonomyMode
	baseTick   time.Duration
	minSpacing time.Duration
}

// normalizePendingHook validates and commits a fresh PendingHook carrying a
// `pending` HookIntent. Caller supplies the HookIntent; runtime stamps
// scheduled_for from the TIME trigger detail (or leaves zero for EVENT
// family, since event-driven hooks are not driven by scheduled_for).
func normalizePendingHook(input *runtimev1.PendingHook, now time.Time) (*runtimev1.PendingHook, error) {
	if input == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	intent := input.GetIntent()
	if intent == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if err := validateHookIntent(intent); err != nil {
		return nil, err
	}
	scheduledFor, err := resolveHookScheduledFor(intent, now)
	if err != nil {
		return nil, err
	}
	hook := &runtimev1.PendingHook{
		Intent:       cloneHookIntent(intent),
		ScheduledFor: timestamppb.New(scheduledFor),
	}
	hook.Intent.AdmissionState = runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PENDING
	if input.GetAdmittedAt() == nil {
		hook.AdmittedAt = timestamppb.New(now)
	} else {
		hook.AdmittedAt = cloneTimestamp(input.GetAdmittedAt())
	}
	return hook, nil
}

// resolveHookScheduledFor computes admitted scheduler truth from a HookIntent.
// TIME family: now + delay (also respecting intent.not_before if set later).
// EVENT family: returns zero time — event hooks are not driven by
// scheduled_for; they fire on the admitted event detail matching.
func resolveHookScheduledFor(intent *runtimev1.HookIntent, now time.Time) (time.Time, error) {
	if intent == nil || intent.GetTriggerDetail() == nil {
		return time.Time{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	switch intent.GetTriggerFamily() {
	case runtimev1.HookTriggerFamily_HOOK_TRIGGER_FAMILY_TIME:
		detail := intent.GetTriggerDetail().GetTime()
		if detail == nil || detail.GetDelay() == nil {
			return time.Time{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		delay := detail.GetDelay().AsDuration()
		if delay < 0 {
			return time.Time{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		scheduled := now.Add(delay)
		if intent.GetNotBefore() != nil {
			nb := intent.GetNotBefore().AsTime()
			if nb.After(scheduled) {
				scheduled = nb
			}
		}
		return scheduled.UTC(), nil
	case runtimev1.HookTriggerFamily_HOOK_TRIGGER_FAMILY_EVENT:
		// Event-driven hooks do not carry scheduled_for; they fire on
		// admitted event matching (user_idle / chat_ended). Return zero.
		return time.Time{}, nil
	default:
		return time.Time{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
}

// validateHookIntent enforces the K-AGCORE-041 narrow-admission matrix.
func validateHookIntent(intent *runtimev1.HookIntent) error {
	if intent == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if strings.TrimSpace(intent.GetIntentId()) == "" {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	// agent_id must be present once admitted; proposers (model-side) may emit
	// the field empty and runtime fills it at admission. This validator is
	// called both for proposal and admission paths; the caller sets agent_id.
	if intent.GetEffect() != runtimev1.HookEffect_HOOK_EFFECT_FOLLOW_UP_TURN {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	detail := intent.GetTriggerDetail()
	if detail == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	switch intent.GetTriggerFamily() {
	case runtimev1.HookTriggerFamily_HOOK_TRIGGER_FAMILY_TIME:
		timeDetail := detail.GetTime()
		if timeDetail == nil || timeDetail.GetDelay() == nil {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		if detail.GetEventUserIdle() != nil || detail.GetEventChatEnded() != nil {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		if timeDetail.GetDelay().AsDuration() < 0 {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
	case runtimev1.HookTriggerFamily_HOOK_TRIGGER_FAMILY_EVENT:
		hasUserIdle := detail.GetEventUserIdle() != nil
		hasChatEnded := detail.GetEventChatEnded() != nil
		if !hasUserIdle && !hasChatEnded {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		if hasUserIdle && hasChatEnded {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		if detail.GetTime() != nil {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		if hasUserIdle && detail.GetEventUserIdle().GetIdleFor() == nil {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
	default:
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if intent.GetNotBefore() != nil && intent.GetExpiresAt() != nil &&
		intent.GetExpiresAt().AsTime().Before(intent.GetNotBefore().AsTime()) {
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
	case hasAdmissionState(entry, runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_RUNNING):
		next = runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_LIFE_RUNNING
	case hasAdmissionState(entry, runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PENDING):
		next = runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_LIFE_PENDING
	case next != runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_CHAT_ACTIVE:
		next = runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_IDLE
	}
	if entry.State.GetExecutionState() != next {
		entry.State.ExecutionState = next
		entry.State.UpdatedAt = timestamppb.New(now)
	}
}

func hasAdmissionState(entry *agentEntry, expected runtimev1.HookAdmissionState) bool {
	if entry == nil {
		return false
	}
	for _, hook := range entry.Hooks {
		if hook != nil && hook.GetIntent().GetAdmissionState() == expected {
			return true
		}
	}
	return false
}

func isCancelableAdmissionState(state runtimev1.HookAdmissionState) bool {
	return state == runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PENDING ||
		state == runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_RUNNING
}

// hookAdmissionState returns the committed admission state of a PendingHook.
// This is the single canonical accessor; callers must not read from parallel
// status fields (no such field exists on the new PendingHook shape).
func hookAdmissionState(hook *runtimev1.PendingHook) runtimev1.HookAdmissionState {
	if hook == nil {
		return runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_UNSPECIFIED
	}
	return hook.GetIntent().GetAdmissionState()
}

func hookIntentID(hook *runtimev1.PendingHook) string {
	if hook == nil {
		return ""
	}
	return strings.TrimSpace(hook.GetIntent().GetIntentId())
}

func cloneHookIntent(input *runtimev1.HookIntent) *runtimev1.HookIntent {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.HookIntent)
}

func cloneHookTriggerDetail(input *runtimev1.HookTriggerDetail) *runtimev1.HookTriggerDetail {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.HookTriggerDetail)
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
		for _, hook := range entry.Hooks {
			if hook == nil || hookAdmissionState(hook) != runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PENDING {
				continue
			}
			// Only TIME-family hooks are driven by scheduled_for. EVENT-family
			// hooks fire on event matching, not on time sweep.
			if hook.GetIntent().GetTriggerFamily() != runtimev1.HookTriggerFamily_HOOK_TRIGGER_FAMILY_TIME {
				continue
			}
			if hook.GetScheduledFor() == nil || hook.GetScheduledFor().AsTime().IsZero() {
				continue
			}
			scheduledFor := hook.GetScheduledFor().AsTime()
			if scheduledFor.After(now) {
				continue
			}
			items = append(items, dueHookRef{agentID: agentID, hookID: hookIntentID(hook), scheduledFor: scheduledFor})
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
		// Reschedule as a TIME hook targeting the resumption instant.
		delay := suspendedUntil.AsTime().Sub(now)
		if delay < 0 {
			delay = 0
		}
		return rescheduledHookDecision(timeHookIntentForDelay(entry.Agent.GetAgentId(), delay, "autonomy suspended"), 0)
	}
	if autonomy.GetBudgetExhausted() {
		resumeAt := nextAutonomyWindowStart(autonomy, now)
		delay := resumeAt.Sub(now)
		if delay < 0 {
			delay = 0
		}
		return rescheduledHookDecision(timeHookIntentForDelay(entry.Agent.GetAgentId(), delay, "autonomy budget exhausted"), 0)
	}
	if policy, ok := resolveCadencePolicy(autonomy.GetConfig()); ok {
		if anchor, ok := latestLifeTurnAnchor(entry); ok {
			minAllowed := anchor.Add(policy.minSpacing)
			if now.Before(minAllowed) {
				delay := minAllowed.Sub(now)
				if delay < 0 {
					delay = 0
				}
				reason := strings.TrimSpace(hook.GetIntent().GetReason())
				if reason == "" {
					reason = "min spacing gate"
				}
				return rescheduledHookDecision(timeHookIntentForDelay(entry.Agent.GetAgentId(), delay, reason), 0)
			}
		}
	}
	return nil
}

// timeHookIntentForDelay builds a minimally-valid TIME-family HookIntent for
// reschedule flows. It carries follow-up-turn effect and proposed admission
// state; the admission transition finalizes to pending on acceptance.
func timeHookIntentForDelay(agentID string, delay time.Duration, reason string) *runtimev1.HookIntent {
	if delay < 0 {
		delay = 0
	}
	return &runtimev1.HookIntent{
		IntentId:       "hook_" + ulid.Make().String(),
		AgentId:        strings.TrimSpace(agentID),
		TriggerFamily:  runtimev1.HookTriggerFamily_HOOK_TRIGGER_FAMILY_TIME,
		TriggerDetail:  timeTriggerDetail(delay),
		Effect:         runtimev1.HookEffect_HOOK_EFFECT_FOLLOW_UP_TURN,
		AdmissionState: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PROPOSED,
		Reason:         strings.TrimSpace(reason),
	}
}

func timeTriggerDetail(delay time.Duration) *runtimev1.HookTriggerDetail {
	return &runtimev1.HookTriggerDetail{
		Detail: &runtimev1.HookTriggerDetail_Time{
			Time: &runtimev1.HookTriggerTimeDetail{Delay: durationpb.New(delay)},
		},
	}
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

func isCadenceTickIntent(intent *runtimev1.HookIntent) bool {
	return intent != nil &&
		intent.GetTriggerFamily() == runtimev1.HookTriggerFamily_HOOK_TRIGGER_FAMILY_TIME &&
		strings.TrimSpace(intent.GetReason()) == autonomyCadenceHookReason
}

func isCadenceTickHook(hook *runtimev1.PendingHook) bool {
	return hook != nil && isCadenceTickIntent(hook.GetIntent())
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
		switch hookAdmissionState(hook) {
		case runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_COMPLETED,
			runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_FAILED,
			runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_RESCHEDULED,
			runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_REJECTED:
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

func earliestPendingNonCadenceHookAt(entry *agentEntry) (time.Time, bool) {
	if entry == nil {
		return time.Time{}, false
	}
	var earliest time.Time
	for _, hook := range entry.Hooks {
		if hook == nil || isCadenceTickHook(hook) || hookAdmissionState(hook) != runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PENDING {
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
	if latest, ok := latestLifeTurnAnchor(entry); ok {
		minAllowed := latest.Add(policy.minSpacing)
		if scheduledAt.Before(minAllowed) {
			scheduledAt = minAllowed
		}
	}
	return scheduledAt.UTC(), true
}

// cadenceTickHookIntent builds the baseline autonomy cadence HookIntent as a
// TIME-family intent with a delay computed from the scheduled instant.
func cadenceTickHookIntent(agentID string, scheduledAt time.Time, now time.Time) *runtimev1.HookIntent {
	delay := scheduledAt.Sub(now)
	if delay < 0 {
		delay = 0
	}
	return &runtimev1.HookIntent{
		IntentId:       "hook_tick_" + ulid.Make().String(),
		AgentId:        strings.TrimSpace(agentID),
		TriggerFamily:  runtimev1.HookTriggerFamily_HOOK_TRIGGER_FAMILY_TIME,
		TriggerDetail:  timeTriggerDetail(delay),
		Effect:         runtimev1.HookEffect_HOOK_EFFECT_FOLLOW_UP_TURN,
		AdmissionState: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PENDING,
		NotBefore:      timestamppb.New(scheduledAt),
		Reason:         autonomyCadenceHookReason,
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
		if hook != nil && isCadenceTickHook(hook) && hookAdmissionState(hook) == runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PENDING {
			pendingCadence = append(pendingCadence, hook)
		}
	}
	sort.Slice(pendingCadence, func(i, j int) bool {
		return hookIntentID(pendingCadence[i]) < hookIntentID(pendingCadence[j])
	})

	cancelHooks := func(hooks []*runtimev1.PendingHook, reason string) error {
		if len(hooks) == 0 {
			return nil
		}
		events := make([]*runtimev1.AgentEvent, 0, len(hooks))
		for _, hook := range hooks {
			hook.Intent.AdmissionState = runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_CANCELED
			events = append(events, hookEventAt(entry.Agent.GetAgentId(), &runtimev1.HookExecutionOutcome{
				Intent:     cloneHookIntent(hook.GetIntent()),
				ObservedAt: timestamppb.New(now),
				Reason:     firstNonEmpty(strings.TrimSpace(reason), autonomyCadenceHookCancelReason),
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
		intent := cadenceTickHookIntent(entry.Agent.GetAgentId(), scheduledAt, now)
		hook := &runtimev1.PendingHook{
			Intent:       intent,
			ScheduledFor: timestamppb.New(scheduledAt),
			AdmittedAt:   timestamppb.New(now),
		}
		entry.Hooks[intent.GetIntentId()] = hook
		refreshLifeTrackState(entry, now)
		return s.updateAgent(entry, hookEventAt(entry.Agent.GetAgentId(), &runtimev1.HookExecutionOutcome{
			Intent:     cloneHookIntent(intent),
			ObservedAt: timestamppb.New(now),
		}, now))
	}

	primary := pendingCadence[0]
	delay := scheduledAt.Sub(now)
	if delay < 0 {
		delay = 0
	}
	primary.Intent.TriggerDetail = timeTriggerDetail(delay)
	primary.Intent.NotBefore = timestamppb.New(scheduledAt)
	primary.Intent.Reason = autonomyCadenceHookReason
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

// hookExecutionDecision carries the runtime-side decision tree for a
// completed life-turn attempt. Its `admissionState` field is the committed
// post-execution admission target; `nextIntent` is set on RESCHEDULED only.
type hookExecutionDecisionTerminal struct{}

func completedHookDecision(summary string, tokensUsed int64) *hookExecutionDecision {
	return &hookExecutionDecision{
		admissionState: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_COMPLETED,
		summary:        strings.TrimSpace(summary),
		tokensUsed:     tokensUsed,
	}
}

func failedHookDecision(reasonCode runtimev1.ReasonCode, message string, retryable bool, tokensUsed int64) *hookExecutionDecision {
	return &hookExecutionDecision{
		admissionState: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_FAILED,
		reasonCode:     reasonCode,
		message:        strings.TrimSpace(message),
		retryable:      retryable,
		tokensUsed:     tokensUsed,
	}
}

func rescheduledHookDecision(nextIntent *runtimev1.HookIntent, tokensUsed int64) *hookExecutionDecision {
	return &hookExecutionDecision{
		admissionState: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_RESCHEDULED,
		nextIntent:     cloneHookIntent(nextIntent),
		tokensUsed:     tokensUsed,
	}
}

func rejectedHookDecision(reasonCode runtimev1.ReasonCode, message string) *hookExecutionDecision {
	return &hookExecutionDecision{
		admissionState: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_REJECTED,
		reasonCode:     reasonCode,
		message:        strings.TrimSpace(message),
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

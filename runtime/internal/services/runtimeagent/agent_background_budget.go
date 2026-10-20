package runtimeagent

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
	"strings"
	"time"
)

type autonomySnapshot struct {
	usedTokens      int64
	remainingTokens int64
	budgetExhausted bool
	windowStartedAt time.Time
	hasWindowStart  bool
}

// @nimi-authority: rule.nimi.runtime.agent-participation.r168
// Called only on an owner mutation clone. Time advances the usage window, not
// the independently revisioned user configuration, and never rewinds it.
func advanceAutonomyWindow(entry *agentEntry, now time.Time) {
	if entry == nil || entry.Agent == nil || entry.Agent.Autonomy == nil {
		return
	}
	autonomy := entry.Agent.Autonomy
	if autonomy.WindowStartedAt == nil {
		autonomy.WindowStartedAt = timestamppb.New(now)
	} else {
		start := autonomy.WindowStartedAt.AsTime()
		// Unix seconds avoid time.Duration saturation after a long idle period.
		elapsed := now.Unix() - start.Unix()
		if now.Nanosecond() < start.Nanosecond() {
			elapsed--
		}
		if windows := elapsed / (24 * 60 * 60); windows > 0 {
			autonomy.WindowStartedAt = timestamppb.New(time.Unix(start.Unix()+windows*24*60*60, int64(start.Nanosecond())).UTC())
			autonomy.UsedTokensInWindow = 0
			entry.Agent.UpdatedAt = timestamppb.New(now)
		}
	}
	budget := autonomy.GetConfig().GetDailyTokenBudget()
	autonomy.BudgetExhausted = budget > 0 && autonomy.GetUsedTokensInWindow() >= budget
}

func applyTokenUsage(entry *agentEntry, tokensUsed int64, now time.Time) {
	advanceAutonomyWindow(entry, now)
	if entry == nil || entry.Agent == nil || entry.Agent.Autonomy == nil || tokensUsed <= 0 {
		return
	}
	entry.Agent.Autonomy.UsedTokensInWindow = addNonNegativeUsage(entry.Agent.Autonomy.UsedTokensInWindow, tokensUsed)
	budget := entry.Agent.Autonomy.GetConfig().GetDailyTokenBudget()
	entry.Agent.Autonomy.BudgetExhausted = budget > 0 && entry.Agent.Autonomy.GetUsedTokensInWindow() >= budget
	entry.Agent.UpdatedAt = timestamppb.New(now)
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

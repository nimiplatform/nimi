package runtimeagent

import (
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Life and chat share presentation truth, but activity settlement remains in
// LifeState. A live user conversation owns its current presentation cues.
func (s *Service) syncLifePresentation(entry *agentEntry, hadCurrent bool, now time.Time) *runtimev1.AgentEvent {
	if entry.State == nil || entry.State.GetExecutionState() == runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_CHAT_ACTIVE {
		return nil
	}
	next := ""
	if entry.Life.Current != nil {
		next = entry.Life.Current.Title
	} else if !hadCurrent {
		return nil
	}
	previous := entry.State.GetStatusText()
	if previous == next {
		return nil
	}
	entry.State.StatusText = next
	entry.State.UpdatedAt = timestamppb.New(now)
	return s.stateStatusTextChangedEvent(entry.Agent.GetLocalAgentRef(), next, previous, previous != "", stateEventOrigin{}, now)
}

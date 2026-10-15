package runtimeagent

import (
	"context"
	"fmt"
	"math"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/riskcontrol"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// @nimi-authority: rule.nimi.runtime.agent-participation.conversation-context-selection
// This is a user-selected input range, not an inspection ledger. Zero means
// the unchanged default for records written before a selection was made.
type publicChatConversationContextSelection struct {
	Revision                uint64 `json:"revision,omitempty"`
	FirstTurnSequence       uint64 `json:"firstTurnSequence,omitempty"`
	OmitSupplementalContext bool   `json:"omitSupplementalContext,omitempty"`
}

func conversationContextRevision(selection publicChatConversationContextSelection) uint64 {
	if selection.Revision == 0 {
		return 1
	}
	return selection.Revision
}

func validateConversationContextSelection(selection publicChatConversationContextSelection, count int) error {
	if selection.FirstTurnSequence > uint64(count) || (selection.Revision == 0 && (selection.FirstTurnSequence != 0 || selection.OmitSupplementalContext)) {
		return fmt.Errorf("conversation context selection is invalid")
	}
	return nil
}

func activeConversationSummary(anchor *publicChatAnchorState) *publicChatConversationSummaryState {
	if anchor == nil || anchor.ConversationSummary == nil {
		return nil
	}
	summary := anchor.ConversationSummary
	revision := summary.ContextRevision
	if revision == 0 {
		revision = 1
	}
	if revision != conversationContextRevision(anchor.ConversationContext) {
		return nil
	}
	if summary.LastValid != nil && summary.LastValid.CoveredSequenceStart != anchor.ConversationContext.FirstTurnSequence {
		return nil
	}
	return summary
}

func selectedCommittedTranscript(anchor *publicChatAnchorState) ([]agentTurnTranscriptPairInput, error) {
	if err := validateConversationContextSelection(anchor.ConversationContext, len(anchor.CommittedTranscript)); err != nil {
		return nil, err
	}
	all, err := publicChatEligibleCommittedTranscript(anchor.CommittedTranscript)
	if err != nil {
		return nil, err
	}
	for i, turn := range all {
		if turn.Sequence >= anchor.ConversationContext.FirstTurnSequence {
			return all[i:], nil
		}
	}
	return nil, nil
}

// Caller holds chatSurfaceMu, matching the Realtime registration lock order.
func (s *Service) conversationContextBusyLocked(anchor *publicChatAnchorState) bool {
	if anchor.ActiveTurnID != "" {
		return true
	}
	s.agentRealtimeMu.RLock()
	defer s.agentRealtimeMu.RUnlock()
	for _, session := range s.agentRealtimeSessions {
		if session != nil && session.conversationAnchorID == anchor.ConversationAnchorID {
			return true
		}
	}
	return false
}

func (s *Service) projectConversationContextLocked(anchor *publicChatAnchorState) *runtimev1.LocalAppAgentConversationContextProjection {
	if anchor == nil {
		return nil
	}
	busy := s.conversationContextBusyLocked(anchor)
	projection := &runtimev1.LocalAppAgentConversationContextProjection{
		ConversationAnchorId:    anchor.ConversationAnchorID,
		ContextRevision:         conversationContextRevision(anchor.ConversationContext),
		FirstTurnSequence:       anchor.ConversationContext.FirstTurnSequence,
		OmitSupplementalContext: anchor.ConversationContext.OmitSupplementalContext,
		CommittedTurnCount:      uint64(len(anchor.CommittedTranscript)),
		Busy:                    busy,
		CanUpdate:               !busy && s.chatStateRepo != nil && !s.isClosed(),
	}
	// A recommendation is offered only after a real refusal. Inspect the bounded
	// recent window and naturally available summary; never scan stored history.
	if anchor.LastTurnSnapshot == nil || anchor.LastTurnSnapshot.ReasonCode != runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED || anchor.LastTurnSnapshot.ActionHint != "adjust_conversation_history" {
		return projection
	}
	detector := riskcontrol.New()
	if summary := activeConversationSummary(anchor); summary != nil && summary.LastValid != nil && detector.Text(summary.LastValid.Text) != "" {
		next := summary.LastValid.CoveredSequenceEnd + 1
		projection.SuggestedFirstTurnSequence = &next
	}
	start := max(0, len(anchor.CommittedTranscript)-publicChatRecentVerbatimTurnLimit)
	for _, turn := range anchor.CommittedTranscript[start:] {
		if turn.Sequence < anchor.ConversationContext.FirstTurnSequence {
			continue
		}
		if detector.Text(publicChatCommittedTranscriptInputText(turn)) != "" || detector.Text(turn.AssistantText) != "" {
			next := turn.Sequence + 1
			projection.SuggestedFirstTurnSequence = &next
		}
	}
	return projection
}

// @nimi-authority: rule.nimi.runtime.ai-provider.content-refusal-presentation
// Only actually included compiler items can identify an input source. This
// chooses guidance after a real refusal; it is not a second admission gate.
func conversationContentRefusalAction(compilation *agentTurnContextCompilation) string {
	const unknown = "review_input_or_context"
	if compilation == nil {
		return unknown
	}
	detector := riskcontrol.New()
	actions := map[string]bool{}
	for _, lane := range compilation.PrivateLanes {
		for _, item := range lane.Items {
			if !item.Included {
				continue
			}
			matched := false
			for _, segment := range item.Segments {
				if detector.Text(segment.Content) != "" {
					matched = true
					break
				}
			}
			if !matched {
				continue
			}
			action := unknown
			switch lane.LaneID {
			case agentTurnContextLaneCurrentUserTurn:
				action = "edit_current_input"
			case agentTurnContextLaneConversationHistory, agentTurnContextLaneConversationSummary:
				action = "adjust_conversation_history"
			case agentTurnContextLaneCanonicalMemory, agentTurnContextLaneCognitionSource, agentTurnContextLanePrivateRecall:
				action = "adjust_supplemental_context"
			case agentTurnContextLaneSourceIdentity, agentTurnContextLaneSourceBehavior, agentTurnContextLaneWorldContext, agentTurnContextLaneSourceKnowledge:
				action = "review_agent_source"
			}
			actions[action] = true
		}
	}
	if len(actions) == 1 {
		for action := range actions {
			return action
		}
	}
	return unknown
}

func (s *Service) managerConversationContext(resolved localAppAgentIdentity, requested string) (*runtimev1.LocalAppAgentConversationContextProjection, error) {
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	var anchor *publicChatAnchorState
	if requested == "" {
		anchor = resolveLocalAgentConversationAnchorLocked(s.chatAnchors, resolved.identity.OwnerUserID, resolved.identity.LocalAgentRef)
	} else {
		anchor = s.chatAnchors[requested]
	}
	if anchor == nil && requested == "" {
		return nil, nil
	}
	if !conversationContextAnchorMatches(anchor, resolved) {
		return nil, status.Error(codes.NotFound, "local-app conversation resource not found")
	}
	return s.projectConversationContextLocked(anchor), nil
}

func conversationContextAnchorMatches(anchor *publicChatAnchorState, resolved localAppAgentIdentity) bool {
	return anchor != nil && conversationAnchorIsResumable(anchor.Status) &&
		anchor.LocalAgentRef == resolved.identity.LocalAgentRef && anchor.OwnerUserID == resolved.identity.OwnerUserID &&
		anchor.SubjectUserID == resolved.decision.AccountID && anchor.RuntimeSourceRef == resolved.identity.RuntimeSourceRef
}

func (s *Service) UpdateLocalAppAgentConversationContext(ctx context.Context, req *runtimev1.UpdateLocalAppAgentConversationContextRequest) (*runtimev1.UpdateLocalAppAgentConversationContextResponse, error) {
	if req == nil || req.GetExpectedContextRevision() == 0 || !validLocalAppConversationSelector(req.GetConversationAnchorId()) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	resolved, _, err := s.resolveLocalAppAgent(ctx, accountservice.LocalAppOperationUpdateConversationContext, req.GetAgentHandle())
	if err != nil {
		return nil, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	entry := s.agents[resolved.identity.LocalAgentRef]
	if !currentLocalAppManagerAgentMatches(entry, resolved) {
		return nil, localAppAgentAccessDenied()
	}
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	anchor := s.chatAnchors[strings.TrimSpace(req.GetConversationAnchorId())]
	if !conversationContextAnchorMatches(anchor, resolved) || s.agentTerminationFencedLocked(resolved.identity.LocalAgentRef) {
		return nil, localAppAgentAccessDenied()
	}
	if s.conversationContextBusyLocked(anchor) {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_BUSY)
	}
	current := conversationContextRevision(anchor.ConversationContext)
	if current != req.GetExpectedContextRevision() {
		return nil, grpcerr.WithReasonCode(codes.Aborted, runtimev1.ReasonCode_AGENT_CONVERSATION_CONTEXT_REVISION_CONFLICT)
	}
	if req.GetFirstTurnSequence() > uint64(len(anchor.CommittedTranscript)) || current == math.MaxUint64 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	previous, version := anchor.ConversationContext, s.chatSurfaceVersion
	anchor.ConversationContext = publicChatConversationContextSelection{Revision: current + 1, FirstTurnSequence: req.GetFirstTurnSequence(), OmitSupplementalContext: req.GetOmitSupplementalContext()}
	if err := s.persistPublicChatSurfaceStateLocked(anchor.ConversationAnchorID); err != nil {
		anchor.ConversationContext, s.chatSurfaceVersion = previous, version
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_LOCAL_APP_OWNER_UNAVAILABLE)
	}
	// Keep the canceled job registered until its worker finishes, so Agent
	// termination can still wait for its custody. Revision checks reject results.
	if job := s.chatConversationSummaryJobs[anchor.ConversationAnchorID]; job != nil {
		if job.Cancel != nil {
			job.Cancel()
		}
	}
	return &runtimev1.UpdateLocalAppAgentConversationContextResponse{Projection: s.projectConversationContextLocked(anchor)}, nil
}

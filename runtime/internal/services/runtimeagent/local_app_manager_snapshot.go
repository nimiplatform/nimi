package runtimeagent

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

// @nimi-authority: definition.nimi.platform.app-ecosystem.agent-manager-snapshot
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-agid-014a
// GetLocalAppAgentManagerSnapshot is the canonical bounded AgentCenter owner
// projection. The current protected session and opaque Agent handle are
// revalidated by the protected transport and resolveLocalAppAgent on every
// call; no Runtime-private identity is copied into the response.
func (s *Service) GetLocalAppAgentManagerSnapshot(
	ctx context.Context,
	req *runtimev1.GetLocalAppAgentManagerSnapshotRequest,
) (*runtimev1.GetLocalAppAgentManagerSnapshotResponse, error) {
	if req == nil || (req.ConversationAnchorId != nil && strings.TrimSpace(req.GetConversationAnchorId()) == "") {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	resolved, _, err := s.resolveLocalAppAgent(ctx, accountservice.LocalAppOperationManagerSnapshot, req.GetAgentHandle())
	if err != nil {
		return nil, err
	}
	entry, err := s.agentByID(resolved.identity.LocalAgentRef)
	if err != nil || !currentLocalAppManagerAgentMatches(entry, resolved) {
		return nil, localAppAgentAccessDenied()
	}
	if entry.State == nil || entry.State.GetExecutionState() == runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_UNSPECIFIED {
		return nil, localAppConversationOwnerUnavailable()
	}

	snapshot := &runtimev1.LocalAppAgentManagerSnapshot{
		LifecycleStatus: entry.Agent.GetLifecycleStatus(),
		ExecutionState:  entry.State.GetExecutionState(),
		StatusText:      strings.TrimSpace(entry.State.GetStatusText()),
		CurrentEmotion:  strings.TrimSpace(entry.State.GetCurrentEmotion()),
		Source:          projectLocalAppAgentManagerSource(entry.Agent.GetSourceContextStatus()),
	}
	if req.ConversationAnchorId != nil {
		summary, err := s.localAppAgentManagerContextSummary(resolved, strings.TrimSpace(req.GetConversationAnchorId()))
		if err != nil {
			return nil, err
		}
		contextProjection, err := projectLocalAppAgentManagerContext(summary)
		if err != nil {
			return nil, err
		}
		snapshot.Context = contextProjection
	}
	return &runtimev1.GetLocalAppAgentManagerSnapshotResponse{Snapshot: snapshot}, nil
}

func currentLocalAppManagerAgentMatches(entry *agentEntry, resolved localAppAgentIdentity) bool {
	return entry != nil && entry.Agent != nil &&
		entry.Agent.GetLifecycleStatus() == runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE &&
		strings.TrimSpace(entry.Agent.GetLocalAgentRef()) == resolved.identity.LocalAgentRef &&
		strings.TrimSpace(entry.Agent.GetOwnerUserId()) == resolved.identity.OwnerUserID &&
		strings.TrimSpace(entry.Agent.GetRuntimeSourceRef()) == resolved.identity.RuntimeSourceRef &&
		resolved.identity.OwnerUserID == resolved.decision.AccountID
}

func projectLocalAppAgentManagerSource(input *runtimev1.LocalAgentSourceContextStatus) *runtimev1.LocalAppAgentManagerSourceProjection {
	if input == nil {
		return &runtimev1.LocalAppAgentManagerSourceProjection{
			State:      runtimev1.AgentLocalSourceContextState_AGENT_LOCAL_SOURCE_CONTEXT_STATE_NOT_MATERIALIZED,
			ReasonCode: runtimev1.AgentContextProjectionReasonCode_AGENT_CONTEXT_PROJECTION_REASON_CODE_SOURCE_NOT_MATERIALIZED,
		}
	}
	coverage := make([]*runtimev1.LocalAgentSourceCoverageSectionStatus, 0, len(input.GetCoverageSections()))
	for _, section := range input.GetCoverageSections() {
		if section != nil {
			coverage = append(coverage, proto.Clone(section).(*runtimev1.LocalAgentSourceCoverageSectionStatus))
		}
	}
	return &runtimev1.LocalAppAgentManagerSourceProjection{
		Ready:                   input.GetReady(),
		State:                   input.GetState(),
		ReasonCode:              input.GetReasonCode(),
		CapturedAt:              cloneTimestamp(input.GetCapturedAt()),
		CoverageSections:        coverage,
		LorebookReady:           input.GetLorebookReady(),
		LorebookItemCount:       input.GetLorebookItemCount(),
		LorebookEstimatedTokens: input.GetLorebookEstimatedTokens(),
	}
}

func (s *Service) localAppAgentManagerContextSummary(
	resolved localAppAgentIdentity,
	conversationAnchorID string,
) (*runtimev1.AgentTurnContextSummary, error) {
	if !validLocalAppConversationSelector(conversationAnchorID) {
		return nil, localAppAgentAccessDenied()
	}
	s.chatSurfaceMu.Lock()
	anchor := s.chatAnchors[conversationAnchorID]
	valid := anchor != nil && conversationAnchorIsResumable(anchor.Status) &&
		anchor.AgentID == resolved.identity.LocalAgentRef &&
		anchor.LocalAgentRef == resolved.identity.LocalAgentRef &&
		anchor.OwnerUserID == resolved.identity.OwnerUserID &&
		anchor.SubjectUserID == resolved.decision.AccountID &&
		anchor.RuntimeSourceRef == resolved.identity.RuntimeSourceRef
	var summary *runtimev1.AgentTurnContextSummary
	if valid && anchor.LastTurnSnapshot != nil {
		summary = cloneAgentTurnContextSummary(anchor.LastTurnSnapshot.ContextSummary)
		if summary != nil && (strings.TrimSpace(summary.GetLocalAgentRef()) != resolved.identity.LocalAgentRef ||
			strings.TrimSpace(summary.GetConversationAnchorId()) != conversationAnchorID ||
			strings.TrimSpace(summary.GetTurnId()) != strings.TrimSpace(anchor.LastTurnSnapshot.TurnID)) {
			valid = false
		}
	}
	s.chatSurfaceMu.Unlock()
	if !valid {
		return nil, status.Error(codes.NotFound, "local-app conversation resource not found")
	}
	return summary, nil
}

func projectLocalAppAgentManagerContext(input *runtimev1.AgentTurnContextSummary) (*runtimev1.LocalAppAgentManagerContextProjection, error) {
	if input == nil {
		return &runtimev1.LocalAppAgentManagerContextProjection{
			State:                     runtimev1.AgentTurnContextState_AGENT_TURN_CONTEXT_STATE_NOT_COMPOSED,
			ReasonCode:                runtimev1.AgentContextProjectionReasonCode_AGENT_CONTEXT_PROJECTION_REASON_CODE_CONTEXT_NOT_COMPOSED,
			SourceAdapterStatus:       runtimev1.AgentSourceCognitionStatus_AGENT_SOURCE_COGNITION_STATUS_UNCONFIGURED,
			SourceSelectionStatus:     runtimev1.AgentSourceCognitionStatus_AGENT_SOURCE_COGNITION_STATUS_UNCONFIGURED,
			ConversationSummaryStatus: runtimev1.AgentConversationSummaryStatus_AGENT_CONVERSATION_SUMMARY_STATUS_ABSENT,
		}, nil
	}
	if err := validateAgentTurnContextProjection(input); err != nil ||
		input.GetState() == runtimev1.AgentTurnContextState_AGENT_TURN_CONTEXT_STATE_UNSPECIFIED ||
		input.GetState() == runtimev1.AgentTurnContextState_AGENT_TURN_CONTEXT_STATE_INVALID {
		return nil, localAppConversationOwnerUnavailable()
	}
	lanes := make([]*runtimev1.AgentTurnContextLaneSummary, 0, len(input.GetLanes()))
	for _, lane := range input.GetLanes() {
		lanes = append(lanes, proto.Clone(lane).(*runtimev1.AgentTurnContextLaneSummary))
	}
	truncation := make([]*runtimev1.AgentTurnContextTruncationSummary, 0, len(input.GetTruncation()))
	for _, item := range input.GetTruncation() {
		if item != nil {
			truncation = append(truncation, proto.Clone(item).(*runtimev1.AgentTurnContextTruncationSummary))
		}
	}
	projection := &runtimev1.LocalAppAgentManagerContextProjection{
		Ready:                     input.GetReady(),
		State:                     input.GetState(),
		ReasonCode:                input.GetReasonCode(),
		Lanes:                     lanes,
		Truncation:                truncation,
		TranscriptTurnCount:       input.GetTranscriptTurnCount(),
		MemoryItemCount:           input.GetMemoryItemCount(),
		MediaCount:                input.GetMediaCount(),
		ToolCount:                 input.GetToolCount(),
		PrivateRecallCount:        input.GetPrivateRecallCount(),
		SourceAdapterStatus:       runtimev1.AgentSourceCognitionStatus_AGENT_SOURCE_COGNITION_STATUS_UNCONFIGURED,
		SourceSelectionStatus:     runtimev1.AgentSourceCognitionStatus_AGENT_SOURCE_COGNITION_STATUS_UNCONFIGURED,
		ConversationSummaryStatus: runtimev1.AgentConversationSummaryStatus_AGENT_CONVERSATION_SUMMARY_STATUS_ABSENT,
	}
	if budget := input.GetBudget(); budget != nil {
		projection.InputBudgetTokens = budget.GetInputBudgetTokens()
		projection.UsedTokens = budget.GetUsedTokens()
		projection.RequiredInputTokens = budget.GetRequiredInputTokens()
		projection.RequiredContextWindowTokens = budget.GetRequiredContextWindowTokens()
	}
	if source := input.GetSourceCognition(); source != nil {
		projection.SourceAdapterStatus = source.GetAdapterStatus()
		projection.SourceSelectionStatus = source.GetSelectionStatus()
	}
	if summary := input.GetConversationSummary(); summary != nil {
		projection.ConversationSummaryStatus = summary.GetStatus()
	}
	return projection, nil
}

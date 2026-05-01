package runtimeagent

import (
	"context"
	"encoding/json"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/services/delegation"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

func (s *Service) ExecuteDelegatedCapability(ctx context.Context, req *runtimev1.ExecuteDelegatedCapabilityRequest) (*runtimev1.ExecuteDelegatedCapabilityResponse, error) {
	agentID, err := s.validateDelegatedControlRequest(req.GetContext(), req.GetAgentId(), "runtime.agent.delegation.write")
	if err != nil {
		return nil, err
	}
	anchorID := strings.TrimSpace(req.GetConversationAnchorId())
	if anchorID == "" {
		return nil, status.Error(codes.InvalidArgument, "conversation_anchor_id is required")
	}
	turnID := strings.TrimSpace(req.GetTurnId())
	if turnID == "" {
		return nil, status.Error(codes.InvalidArgument, "turn_id is required")
	}
	arguments, err := delegatedCapabilityArgumentsJSON(req.GetArguments())
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "delegated capability arguments invalid: %v", err)
	}
	session, err := s.delegatedExecutionSession(req.GetContext(), agentID, anchorID)
	if err != nil {
		return nil, err
	}
	turn := publicChatTurnState{
		ConversationAnchorID: anchorID,
		TurnID:               turnID,
		StreamID:             strings.TrimSpace(req.GetStreamId()),
		RequestID:            strings.TrimSpace(req.GetRequestId()),
		AgentID:              agentID,
	}
	decision, err := s.publicChatRuntime().executeDelegatedCapability(ctx, session, turn, runtimeAgentDelegatedCapabilityRequest{
		ProviderID:       strings.TrimSpace(req.GetProviderProfileId()),
		CapabilityID:     strings.TrimSpace(req.GetCapabilityId()),
		ToolName:         strings.TrimSpace(req.GetToolName()),
		Arguments:        arguments,
		DescriptorHash:   strings.TrimSpace(req.GetDescriptorHash()),
		ProtocolRevision: strings.TrimSpace(req.GetProtocolRevision()),
		OutputKind:       firstNonEmpty(strings.TrimSpace(req.GetOutputKind()), delegation.OutputKindObservation),
		RequiresApproval: req.GetRequiresApproval(),
	})
	if err != nil {
		return nil, status.Errorf(codes.FailedPrecondition, "delegated capability execution failed: %v", err)
	}
	record, err := s.findDelegatedReplayAuditRecord(agentID, decision.DecisionID, anchorID, turnID)
	if err != nil {
		return nil, err
	}
	trace, err := s.buildDelegatedReplayTrace(agentID, record)
	if err != nil {
		return nil, err
	}
	return &runtimev1.ExecuteDelegatedCapabilityResponse{
		Diagnostic:  delegatedDiagnosticFromAuditRecord(agentID, record),
		ReplayTrace: trace,
	}, nil
}

func (s *Service) delegatedExecutionSession(ctx *runtimev1.AgentRequestContext, agentID string, anchorID string) (publicChatAnchorState, error) {
	if s == nil {
		return publicChatAnchorState{}, status.Error(codes.FailedPrecondition, "runtime agent service unavailable")
	}
	callerAppID := strings.TrimSpace(ctx.GetAppId())
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	session := s.chatAnchors[anchorID]
	if session == nil {
		return publicChatAnchorState{}, status.Error(codes.NotFound, "conversation_anchor_id not found")
	}
	if strings.TrimSpace(session.AgentID) != agentID {
		return publicChatAnchorState{}, status.Error(codes.FailedPrecondition, "public chat anchor agent mismatch")
	}
	if callerAppID != "" && strings.TrimSpace(session.CallerAppID) != callerAppID {
		return publicChatAnchorState{}, status.Error(codes.PermissionDenied, "public chat anchor caller mismatch")
	}
	return *session, nil
}

func delegatedCapabilityArgumentsJSON(args *structpb.Struct) (json.RawMessage, error) {
	if args == nil {
		return json.RawMessage(`{}`), nil
	}
	raw, err := json.Marshal(args.AsMap())
	if err != nil {
		return nil, err
	}
	if len(raw) == 0 {
		return json.RawMessage(`{}`), nil
	}
	return json.RawMessage(raw), nil
}

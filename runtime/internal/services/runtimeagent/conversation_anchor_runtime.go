package runtimeagent

import (
	"context"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// OpenConversationAnchor opens a new runtime-owned ConversationAnchor per
// K-AGCORE-034. Explicit `agent_id` and `subject_user_id` are required and
// become runtime truth; runtime MUST NOT infer anchors from implicit/default
// agent or derive continuity from `agent_id` alone.
func (s *Service) OpenConversationAnchor(_ context.Context, req *runtimev1.OpenConversationAnchorRequest) (*runtimev1.OpenConversationAnchorResponse, error) {
	if s == nil || s.isClosed() {
		return nil, status.Error(codes.FailedPrecondition, "runtime agent service unavailable")
	}
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "open conversation anchor request is required")
	}
	agentID := strings.TrimSpace(req.GetAgentId())
	subjectUserID := strings.TrimSpace(req.GetSubjectUserId())
	if agentID == "" {
		return nil, status.Error(codes.InvalidArgument, "agent_id is required")
	}
	if subjectUserID == "" {
		return nil, status.Error(codes.InvalidArgument, "subject_user_id is required")
	}
	entry, err := s.agentByID(agentID)
	if err != nil {
		return nil, err
	}
	if entry.Agent.GetLifecycleStatus() != runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE {
		return nil, status.Error(codes.FailedPrecondition, "agent is not active")
	}

	callerAppID := strings.TrimSpace(req.GetContext().GetAppId())
	metadata := cloneConversationAnchorMetadata(req.GetMetadata())
	now := time.Now().UTC()
	anchorID := "agent_anchor_" + ulid.Make().String()

	anchor := &publicChatAnchorState{
		ConversationAnchorID: anchorID,
		AgentID:              agentID,
		CallerAppID:          callerAppID,
		SubjectUserID:        subjectUserID,
		Status:               runtimev1.ConversationAnchorStatus_CONVERSATION_ANCHOR_STATUS_ACTIVE,
		CreatedAt:            now,
		UpdatedAt:            now,
	}

	s.chatSurfaceMu.Lock()
	// anchor_id is a fresh ULID — collision should never happen but stay fail-closed
	if _, exists := s.chatAnchors[anchorID]; exists {
		s.chatSurfaceMu.Unlock()
		return nil, status.Error(codes.AlreadyExists, "conversation anchor already exists")
	}
	s.chatAnchors[anchorID] = anchor
	snapshotState, err := s.capturePublicChatSurfaceSnapshotLocked()
	s.chatSurfaceMu.Unlock()
	if err != nil {
		s.chatSurfaceMu.Lock()
		delete(s.chatAnchors, anchorID)
		s.chatSurfaceMu.Unlock()
		return nil, status.Errorf(codes.Unavailable, "capture conversation anchor snapshot: %v", err)
	}
	committedMetadata, err := s.chatStateRepo.persistPublicChatSurfaceStateWithAnchorMetadata(snapshotState, anchorID, metadata)
	if err != nil {
		s.chatSurfaceMu.Lock()
		delete(s.chatAnchors, anchorID)
		s.chatSurfaceMu.Unlock()
		return nil, status.Errorf(codes.Unavailable, "persist conversation anchor: %v", err)
	}

	snapshot := s.buildConversationAnchorSnapshotLocked(anchor, committedMetadata)
	return &runtimev1.OpenConversationAnchorResponse{Snapshot: snapshot}, nil
}

// GetConversationAnchorSnapshot returns the committed runtime-owned anchor
// snapshot. Late-join surfaces MUST use this path to recover continuity; they
// MUST NOT reconstruct canonical anchor truth from app-local history.
func (s *Service) GetConversationAnchorSnapshot(_ context.Context, req *runtimev1.GetConversationAnchorSnapshotRequest) (*runtimev1.GetConversationAnchorSnapshotResponse, error) {
	if s == nil || s.isClosed() {
		return nil, status.Error(codes.FailedPrecondition, "runtime agent service unavailable")
	}
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "get conversation anchor snapshot request is required")
	}
	agentID := strings.TrimSpace(req.GetAgentId())
	anchorID := strings.TrimSpace(req.GetConversationAnchorId())
	if agentID == "" {
		return nil, status.Error(codes.InvalidArgument, "agent_id is required")
	}
	if anchorID == "" {
		return nil, status.Error(codes.InvalidArgument, "conversation_anchor_id is required")
	}

	s.chatSurfaceMu.Lock()
	anchor := s.chatAnchors[anchorID]
	if anchor == nil {
		s.chatSurfaceMu.Unlock()
		return nil, status.Error(codes.NotFound, "conversation anchor not found")
	}
	if anchor.AgentID != agentID {
		s.chatSurfaceMu.Unlock()
		return nil, status.Error(codes.FailedPrecondition, "conversation anchor agent_id mismatch")
	}
	cloned := *anchor
	s.chatSurfaceMu.Unlock()

	metadata, err := s.chatStateRepo.loadConversationAnchorMetadata(anchorID)
	if err != nil {
		return nil, status.Errorf(codes.Unavailable, "load conversation anchor metadata: %v", err)
	}
	snapshot := s.buildConversationAnchorSnapshotLocked(&cloned, metadata)
	return &runtimev1.GetConversationAnchorSnapshotResponse{Snapshot: snapshot}, nil
}

func (s *Service) buildConversationAnchorSnapshotLocked(anchor *publicChatAnchorState, metadata *structpb.Struct) *runtimev1.ConversationAnchorSnapshot {
	if anchor == nil {
		return nil
	}
	activeTurnID := strings.TrimSpace(anchor.ActiveTurnID)
	activeStreamID := ""
	if activeTurnID != "" {
		s.chatSurfaceMu.Lock()
		if turn := s.chatTurns[activeTurnID]; turn != nil {
			activeStreamID = strings.TrimSpace(turn.StreamID)
		}
		s.chatSurfaceMu.Unlock()
	}
	status := anchor.Status
	if status == runtimev1.ConversationAnchorStatus_CONVERSATION_ANCHOR_STATUS_UNSPECIFIED {
		status = runtimev1.ConversationAnchorStatus_CONVERSATION_ANCHOR_STATUS_ACTIVE
	}
	record := &runtimev1.ConversationAnchor{
		ConversationAnchorId: anchor.ConversationAnchorID,
		AgentId:              anchor.AgentID,
		SubjectUserId:        anchor.SubjectUserID,
		Status:               status,
		LastTurnId:           anchor.LastTurnID,
		LastMessageId:        anchor.LastMessageID,
	}
	if !anchor.CreatedAt.IsZero() {
		record.CreatedAt = timestamppb.New(anchor.CreatedAt)
	}
	if !anchor.UpdatedAt.IsZero() {
		record.UpdatedAt = timestamppb.New(anchor.UpdatedAt)
	}
	if metadata != nil {
		record.Metadata = cloneConversationAnchorMetadata(metadata)
	}
	return &runtimev1.ConversationAnchorSnapshot{
		Anchor:         record,
		ActiveTurnId:   activeTurnID,
		ActiveStreamId: activeStreamID,
	}
}

func cloneConversationAnchorMetadata(metadata *structpb.Struct) *structpb.Struct {
	if metadata == nil {
		return nil
	}
	cloned, ok := proto.Clone(metadata).(*structpb.Struct)
	if !ok {
		return nil
	}
	return cloned
}

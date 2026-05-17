package runtimeagent

import (
	"context"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const avatarLiveInstanceBindingKeySep = "\x1f"

// RegisterAvatarLiveInstanceBinding binds an explicit Avatar window instance
// to an existing Runtime-owned ConversationAnchor. It never opens anchors and
// never consumes launch payload identity beyond the already-validated runtime
// AgentRequestContext.
func (s *Service) RegisterAvatarLiveInstanceBinding(_ context.Context, req *runtimev1.RegisterAvatarLiveInstanceBindingRequest) (*runtimev1.RegisterAvatarLiveInstanceBindingResponse, error) {
	if s == nil || s.isClosed() {
		return nil, status.Error(codes.FailedPrecondition, "runtime agent service unavailable")
	}
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "register avatar live instance binding request is required")
	}
	identity, entry, err := s.agentEntryForIdentityContext(req.GetContext())
	if err != nil {
		return nil, err
	}
	if entry.Agent.GetLifecycleStatus() != runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE {
		return nil, status.Error(codes.FailedPrecondition, "agent is not active")
	}
	avatarInstanceID := strings.TrimSpace(req.GetAvatarInstanceId())
	if avatarInstanceID == "" {
		return nil, status.Error(codes.InvalidArgument, "avatar_instance_id is required")
	}
	anchorID := strings.TrimSpace(req.GetConversationAnchorId())
	if anchorID == "" {
		return nil, status.Error(codes.InvalidArgument, "conversation_anchor_id is required")
	}
	callerAppID := strings.TrimSpace(req.GetContext().GetAppId())
	subjectUserID := strings.TrimSpace(req.GetContext().GetSubjectUserId())
	if subjectUserID == "" {
		subjectUserID = identity.OwnerUserID
	}
	now := time.Now().UTC()
	key := avatarLiveInstanceBindingKey(identity.LocalAgentRef, avatarInstanceID)

	s.chatSurfaceMu.Lock()
	anchor := s.chatAnchors[anchorID]
	if anchor == nil {
		s.chatSurfaceMu.Unlock()
		return nil, status.Error(codes.NotFound, "conversation anchor not found")
	}
	if err := validateAnchorIdentity(anchor, identity); err != nil {
		s.chatSurfaceMu.Unlock()
		return nil, err
	}
	if anchor.SubjectUserID != "" && subjectUserID != anchor.SubjectUserID {
		s.chatSurfaceMu.Unlock()
		return nil, status.Error(codes.FailedPrecondition, "avatar live instance subject_user_id mismatch")
	}
	registeredAt := now
	if current := s.avatarLiveInstanceBindings[key]; current != nil && !current.RegisteredAt.IsZero() {
		registeredAt = current.RegisteredAt
	}
	binding := &avatarLiveInstanceBindingState{
		AvatarInstanceID:     avatarInstanceID,
		ConversationAnchorID: anchorID,
		AgentID:              identity.LocalAgentRef,
		LocalAgentRef:        identity.LocalAgentRef,
		OwnerUserID:          identity.OwnerUserID,
		RealmAgentID:         identity.RealmAgentID,
		CallerAppID:          callerAppID,
		SubjectUserID:        subjectUserID,
		RegisteredAt:         registeredAt,
		UpdatedAt:            now,
	}
	s.avatarLiveInstanceBindings[key] = binding
	anchorClone := *anchor
	snapshotState, captureErr := s.capturePublicChatSurfaceSnapshotLocked()
	s.chatSurfaceMu.Unlock()
	if captureErr != nil {
		return nil, status.Errorf(codes.Unavailable, "capture avatar live instance binding snapshot: %v", captureErr)
	}
	if err := s.chatStateRepo.persistPublicChatSurfaceState(snapshotState); err != nil {
		s.chatSurfaceMu.Lock()
		delete(s.avatarLiveInstanceBindings, key)
		s.chatSurfaceMu.Unlock()
		return nil, status.Errorf(codes.Unavailable, "persist avatar live instance binding: %v", err)
	}

	metadata, err := s.chatStateRepo.loadConversationAnchorMetadata(anchorID)
	if err != nil {
		return nil, status.Errorf(codes.Unavailable, "load conversation anchor metadata: %v", err)
	}
	return &runtimev1.RegisterAvatarLiveInstanceBindingResponse{
		Binding:  runtimeAvatarLiveInstanceBinding(binding),
		Snapshot: s.buildConversationAnchorSnapshotLocked(&anchorClone, metadata),
	}, nil
}

// ResolveAvatarLiveInstanceBinding recovers the Runtime-owned anchor that
// Desktop explicitly registered for this Avatar instance. Missing bindings
// fail closed so Avatar cannot infer continuity from same-agent identity.
func (s *Service) ResolveAvatarLiveInstanceBinding(_ context.Context, req *runtimev1.ResolveAvatarLiveInstanceBindingRequest) (*runtimev1.ResolveAvatarLiveInstanceBindingResponse, error) {
	if s == nil || s.isClosed() {
		return nil, status.Error(codes.FailedPrecondition, "runtime agent service unavailable")
	}
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "resolve avatar live instance binding request is required")
	}
	identity, _, err := s.agentEntryForIdentityContext(req.GetContext())
	if err != nil {
		return nil, err
	}
	avatarInstanceID := strings.TrimSpace(req.GetAvatarInstanceId())
	if avatarInstanceID == "" {
		return nil, status.Error(codes.InvalidArgument, "avatar_instance_id is required")
	}
	key := avatarLiveInstanceBindingKey(identity.LocalAgentRef, avatarInstanceID)

	s.chatSurfaceMu.Lock()
	binding := s.avatarLiveInstanceBindings[key]
	if binding == nil {
		s.chatSurfaceMu.Unlock()
		return nil, status.Error(codes.NotFound, "avatar live instance binding not found")
	}
	if binding.OwnerUserID != identity.OwnerUserID || binding.RealmAgentID != identity.RealmAgentID || binding.LocalAgentRef != identity.LocalAgentRef {
		s.chatSurfaceMu.Unlock()
		return nil, status.Error(codes.FailedPrecondition, "avatar live instance local identity mismatch")
	}
	anchor := s.chatAnchors[binding.ConversationAnchorID]
	if anchor == nil {
		s.chatSurfaceMu.Unlock()
		return nil, status.Error(codes.NotFound, "conversation anchor not found")
	}
	if err := validateAnchorIdentity(anchor, identity); err != nil {
		s.chatSurfaceMu.Unlock()
		return nil, err
	}
	bindingClone := *binding
	anchorClone := *anchor
	s.chatSurfaceMu.Unlock()

	metadata, err := s.chatStateRepo.loadConversationAnchorMetadata(bindingClone.ConversationAnchorID)
	if err != nil {
		return nil, status.Errorf(codes.Unavailable, "load conversation anchor metadata: %v", err)
	}
	return &runtimev1.ResolveAvatarLiveInstanceBindingResponse{
		Binding:  runtimeAvatarLiveInstanceBinding(&bindingClone),
		Snapshot: s.buildConversationAnchorSnapshotLocked(&anchorClone, metadata),
	}, nil
}

func avatarLiveInstanceBindingKey(localAgentRef string, avatarInstanceID string) string {
	return strings.TrimSpace(localAgentRef) + avatarLiveInstanceBindingKeySep + strings.TrimSpace(avatarInstanceID)
}

func validateAnchorIdentity(anchor *publicChatAnchorState, identity localAgentIdentity) error {
	if anchor == nil {
		return status.Error(codes.NotFound, "conversation anchor not found")
	}
	if anchor.AgentID != identity.LocalAgentRef || anchor.LocalAgentRef != identity.LocalAgentRef {
		return status.Error(codes.FailedPrecondition, "conversation anchor local_agent_ref mismatch")
	}
	if anchor.OwnerUserID != identity.OwnerUserID || anchor.RealmAgentID != identity.RealmAgentID {
		return status.Error(codes.FailedPrecondition, "conversation anchor local identity mismatch")
	}
	return nil
}

func runtimeAvatarLiveInstanceBinding(binding *avatarLiveInstanceBindingState) *runtimev1.AvatarLiveInstanceBinding {
	if binding == nil {
		return nil
	}
	record := &runtimev1.AvatarLiveInstanceBinding{
		AvatarInstanceId:     binding.AvatarInstanceID,
		ConversationAnchorId: binding.ConversationAnchorID,
		AgentId:              binding.AgentID,
		LocalAgentRef:        binding.LocalAgentRef,
		OwnerUserId:          binding.OwnerUserID,
		RealmAgentId:         binding.RealmAgentID,
		CallerAppId:          binding.CallerAppID,
		SubjectUserId:        binding.SubjectUserID,
	}
	if !binding.RegisteredAt.IsZero() {
		record.RegisteredAt = timestamppb.New(binding.RegisteredAt)
	}
	if !binding.UpdatedAt.IsZero() {
		record.UpdatedAt = timestamppb.New(binding.UpdatedAt)
	}
	return record
}

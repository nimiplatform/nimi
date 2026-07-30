package runtimeagent

import (
	"context"
	"sort"
	"strconv"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
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
func (s *Service) OpenConversationAnchor(ctx context.Context, req *runtimev1.OpenConversationAnchorRequest) (*runtimev1.OpenConversationAnchorResponse, error) {
	if s == nil || s.isClosed() {
		return nil, status.Error(codes.FailedPrecondition, "runtime agent service unavailable")
	}
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "open conversation anchor request is required")
	}
	decision, localAppAuthorized := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
	localAppDisposition := ""
	var identity localAgentIdentity
	var entry *agentEntry
	var err error
	if localAppAuthorized {
		if decision.Operation != accountservice.LocalAppOperationOpenConversation || strings.TrimSpace(req.GetAgentId()) == "" || req.GetContext() != nil || strings.TrimSpace(req.GetSubjectUserId()) != "" || strings.TrimSpace(req.GetOwnerUserId()) != "" || strings.TrimSpace(req.GetRuntimeSourceRef()) != "" || strings.TrimSpace(req.GetLocalAgentRef()) != "" {
			return nil, status.Error(codes.PermissionDenied, "local-app conversation selector is invalid")
		}
		localAppDisposition, err = localAppConversationDisposition(req.GetMetadata())
		if err != nil {
			return nil, err
		}
		entry, err = s.agentByID(decision.LocalAgentID)
		if err == nil && entry != nil && entry.Agent != nil {
			identity, err = validateLocalAgentIdentity(entry.Agent.GetOwnerUserId(), entry.Agent.GetRuntimeSourceRef(), entry.Agent.GetLocalAgentRef())
			if err == nil && identity.OwnerUserID != decision.AccountID {
				err = status.Error(codes.PermissionDenied, "conversation Agent is not owned by the current account")
			}
		}
	} else {
		identity, err = localAgentIdentityFromOpenAnchorRequest(req)
		if err == nil {
			entry, err = s.agentByID(identity.LocalAgentRef)
		}
	}
	if err != nil {
		return nil, err
	}
	if err := s.authorizeBundledAvatarIdentity(ctx, req.GetContext(), identity, "runtime.agent.write"); err != nil {
		return nil, err
	}
	localAgentRef := identity.LocalAgentRef
	subjectUserID := strings.TrimSpace(req.GetSubjectUserId())
	if localAppAuthorized {
		subjectUserID = decision.AccountID
	}
	if subjectUserID == "" {
		return nil, status.Error(codes.InvalidArgument, "subject_user_id is required")
	}
	if subjectUserID != identity.OwnerUserID {
		return nil, status.Error(codes.FailedPrecondition, "conversation anchor owner_user_id mismatch")
	}
	if err := validateLocalAgentRecordIdentity(entry.Agent, identity); err != nil {
		return nil, err
	}
	if entry.Agent.GetLifecycleStatus() != runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE {
		return nil, status.Error(codes.FailedPrecondition, "agent is not active")
	}
	if localAppAuthorized && localAppDisposition == "create-or-resume" {
		resumed := s.resumeLocalAppConversationAnchor(decision, localAgentRef)
		if resumed != nil {
			metadata, metadataErr := s.chatStateRepo.loadConversationAnchorMetadata(resumed.ConversationAnchorID)
			if metadataErr != nil {
				return nil, grpcerr.WrapWithReasonCode(
					codes.Unavailable,
					runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
					metadataErr,
					grpcerr.ReasonOptions{Message: "conversation anchor metadata could not be loaded"},
				)
			}
			return &runtimev1.OpenConversationAnchorResponse{Snapshot: s.buildConversationAnchorSnapshotLocked(resumed, metadata)}, nil
		}
	}

	callerAppID := strings.TrimSpace(req.GetContext().GetAppId())
	if localAppAuthorized {
		callerAppID = decision.AppID
	}
	metadata := cloneConversationAnchorMetadata(req.GetMetadata())
	if localAppAuthorized {
		metadata = nil
	}
	now := time.Now().UTC()
	anchorID := "agent_anchor_" + ulid.Make().String()
	threadID := "agent_thread_" + ulid.Make().String()

	anchor := &publicChatAnchorState{
		ConversationAnchorID: anchorID,
		AgentID:              localAgentRef,
		OwnerUserID:          identity.OwnerUserID,
		RuntimeSourceRef:     identity.RuntimeSourceRef,
		LocalAgentRef:        localAgentRef,
		CallerAppID:          callerAppID,
		LocalAppPrincipalID:  decision.LocalAppPrincipalID,
		SubjectUserID:        subjectUserID,
		ThreadID:             threadID,
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
		return nil, grpcerr.WrapWithReasonCode(
			codes.Unavailable,
			runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
			err,
			grpcerr.ReasonOptions{Message: "conversation anchor snapshot could not be captured"},
		)
	}
	committedMetadata, err := s.chatStateRepo.persistPublicChatSurfaceStateWithAnchorMetadata(snapshotState, anchorID, metadata)
	if err != nil {
		s.chatSurfaceMu.Lock()
		delete(s.chatAnchors, anchorID)
		s.chatSurfaceMu.Unlock()
		return nil, grpcerr.WrapWithReasonCode(
			codes.Unavailable,
			runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
			err,
			grpcerr.ReasonOptions{Message: "conversation anchor could not be persisted"},
		)
	}

	snapshot := s.buildConversationAnchorSnapshotLocked(anchor, committedMetadata)
	return &runtimev1.OpenConversationAnchorResponse{Snapshot: snapshot}, nil
}

func localAppConversationDisposition(metadata *structpb.Struct) (string, error) {
	if metadata == nil || len(metadata.GetFields()) != 1 {
		return "", status.Error(codes.PermissionDenied, "local-app conversation disposition is invalid")
	}
	value := strings.TrimSpace(metadata.GetFields()["local_app_anchor_disposition"].GetStringValue())
	if value != "create-or-resume" && value != "create-new" {
		return "", status.Error(codes.PermissionDenied, "local-app conversation disposition is invalid")
	}
	return value, nil
}

func (s *Service) resumeLocalAppConversationAnchor(decision accountservice.LocalAppCallerDecision, localAgentRef string) *publicChatAnchorState {
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	var selected *publicChatAnchorState
	for _, anchor := range s.chatAnchors {
		if anchor == nil || anchor.Status != runtimev1.ConversationAnchorStatus_CONVERSATION_ANCHOR_STATUS_ACTIVE ||
			anchor.LocalAgentRef != localAgentRef || anchor.AgentID != localAgentRef ||
			anchor.OwnerUserID != decision.AccountID || anchor.SubjectUserID != decision.AccountID ||
			anchor.CallerAppID != decision.AppID || anchor.LocalAppPrincipalID != decision.LocalAppPrincipalID {
			continue
		}
		if selected == nil || anchor.UpdatedAt.After(selected.UpdatedAt) ||
			(anchor.UpdatedAt.Equal(selected.UpdatedAt) && anchor.ConversationAnchorID < selected.ConversationAnchorID) {
			selected = anchor
		}
	}
	if selected == nil {
		return nil
	}
	cloned := *selected
	cloned.CommittedTranscript = clonePublicChatCommittedTranscript(selected.CommittedTranscript)
	cloned.ActiveTurnSnapshot = clonePublicChatTurnProjectionState(selected.ActiveTurnSnapshot)
	cloned.LastTurnSnapshot = clonePublicChatTurnProjectionState(selected.LastTurnSnapshot)
	cloned.CompletedTurnSnapshots = clonePublicChatTurnProjectionStateMap(selected.CompletedTurnSnapshots)
	return &cloned
}

func (s *Service) ValidateLocalAppConversationScope(ctx context.Context, agentID string, anchorID string) error {
	decision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
	if !ok || strings.TrimSpace(agentID) == "" || strings.TrimSpace(anchorID) == "" {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_PERMISSION_DENIED)
	}
	s.chatSurfaceMu.Lock()
	anchor := s.chatAnchors[strings.TrimSpace(anchorID)]
	valid := anchor != nil && anchor.AgentID == strings.TrimSpace(agentID) &&
		anchor.LocalAgentRef == strings.TrimSpace(agentID) && anchor.OwnerUserID == decision.AccountID &&
		anchor.SubjectUserID == decision.AccountID && anchor.CallerAppID == decision.AppID &&
		anchor.LocalAppPrincipalID != "" && anchor.LocalAppPrincipalID == decision.LocalAppPrincipalID
	s.chatSurfaceMu.Unlock()
	if !valid {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_PERMISSION_DENIED)
	}
	return nil
}

// GetConversationAnchorSnapshot returns the committed runtime-owned anchor
// snapshot. Late-join surfaces MUST use this path to recover continuity; they
// MUST NOT reconstruct canonical anchor truth from app-local history.
func (s *Service) GetConversationAnchorSnapshot(ctx context.Context, req *runtimev1.GetConversationAnchorSnapshotRequest) (*runtimev1.GetConversationAnchorSnapshotResponse, error) {
	if s == nil || s.isClosed() {
		return nil, status.Error(codes.FailedPrecondition, "runtime agent service unavailable")
	}
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "get conversation anchor snapshot request is required")
	}
	identity, err := localAgentIdentityFromContext(req.GetContext())
	if err != nil {
		return nil, err
	}
	if err := s.authorizeBundledAvatarIdentity(ctx, req.GetContext(), identity, "runtime.agent.read"); err != nil {
		return nil, err
	}
	localAgentRef := identity.LocalAgentRef
	anchorID := strings.TrimSpace(req.GetConversationAnchorId())
	if anchorID == "" {
		return nil, status.Error(codes.InvalidArgument, "conversation_anchor_id is required")
	}

	s.chatSurfaceMu.Lock()
	anchor := s.chatAnchors[anchorID]
	if anchor == nil {
		s.chatSurfaceMu.Unlock()
		return nil, status.Error(codes.NotFound, "conversation anchor not found")
	}
	if anchor.AgentID != localAgentRef {
		s.chatSurfaceMu.Unlock()
		return nil, status.Error(codes.FailedPrecondition, "conversation anchor local_agent_ref mismatch")
	}
	if anchor.OwnerUserID != identity.OwnerUserID || anchor.RuntimeSourceRef != identity.RuntimeSourceRef || anchor.LocalAgentRef != identity.LocalAgentRef {
		s.chatSurfaceMu.Unlock()
		return nil, status.Error(codes.FailedPrecondition, "conversation anchor local identity mismatch")
	}
	cloned := *anchor
	s.chatSurfaceMu.Unlock()

	metadata, err := s.chatStateRepo.loadConversationAnchorMetadata(anchorID)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(
			codes.Unavailable,
			runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
			err,
			grpcerr.ReasonOptions{Message: "conversation anchor metadata could not be loaded"},
		)
	}
	snapshot := s.buildConversationAnchorSnapshotLocked(&cloned, metadata)
	return &runtimev1.GetConversationAnchorSnapshotResponse{Snapshot: snapshot}, nil
}

// ListAgentConversationSummaries returns read-only conversation summaries for
// Runtime-owned Agent Chat anchors. The display title is derived projection
// text; selected transcript recovery remains GetPublicChatSessionSnapshot.
func (s *Service) ListAgentConversationSummaries(ctx context.Context, req *runtimev1.ListAgentConversationSummariesRequest) (*runtimev1.ListAgentConversationSummariesResponse, error) {
	if s == nil || s.isClosed() {
		return nil, status.Error(codes.FailedPrecondition, "runtime agent service unavailable")
	}
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "list agent conversation summaries request is required")
	}
	identity, err := localAgentIdentityFromContext(req.GetContext())
	if err != nil {
		return nil, err
	}
	if err := s.authorizeBundledAvatarIdentity(ctx, req.GetContext(), identity, "runtime.agent.read"); err != nil {
		return nil, err
	}
	localAgentRef := identity.LocalAgentRef
	if requestedAgentID := strings.TrimSpace(req.GetAgentId()); requestedAgentID != "" && requestedAgentID != localAgentRef {
		return nil, status.Error(codes.FailedPrecondition, "agent_id local_agent_ref mismatch")
	}
	if strings.TrimSpace(req.GetContext().GetAppId()) == "" {
		return nil, status.Error(codes.InvalidArgument, "context.app_id is required")
	}

	statusFilter := map[runtimev1.ConversationAnchorStatus]bool{}
	for _, statusValue := range req.GetStatusFilter() {
		if statusValue != runtimev1.ConversationAnchorStatus_CONVERSATION_ANCHOR_STATUS_UNSPECIFIED {
			statusFilter[statusValue] = true
		}
	}
	pageSize := int(req.GetPageSize())
	if pageSize <= 0 {
		pageSize = 50
	}
	if pageSize > 100 {
		pageSize = 100
	}
	offset := 0
	if token := strings.TrimSpace(req.GetPageToken()); token != "" {
		parsed, parseErr := strconv.Atoi(token)
		if parseErr != nil {
			return nil, grpcerr.WrapWithReasonCode(
				codes.InvalidArgument,
				runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID,
				parseErr,
				grpcerr.ReasonOptions{Message: "page_token must be a non-negative integer offset"},
			)
		}
		if parsed < 0 {
			return nil, status.Error(codes.InvalidArgument, "page_token must be a non-negative integer offset")
		}
		offset = parsed
	}

	s.chatSurfaceMu.Lock()
	anchors := make([]*publicChatAnchorState, 0, len(s.chatAnchors))
	for _, anchor := range s.chatAnchors {
		if anchor == nil {
			continue
		}
		statusValue := anchor.Status
		if statusValue == runtimev1.ConversationAnchorStatus_CONVERSATION_ANCHOR_STATUS_UNSPECIFIED {
			statusValue = runtimev1.ConversationAnchorStatus_CONVERSATION_ANCHOR_STATUS_ACTIVE
		}
		if len(statusFilter) > 0 && !statusFilter[statusValue] {
			continue
		}
		if anchor.LocalAgentRef != identity.LocalAgentRef ||
			anchor.AgentID != localAgentRef ||
			anchor.OwnerUserID != identity.OwnerUserID ||
			anchor.RuntimeSourceRef != identity.RuntimeSourceRef {
			continue
		}
		if err := validatePublicChatCommittedTranscript(anchor.CommittedTranscript); err != nil {
			s.chatSurfaceMu.Unlock()
			return nil, status.Error(codes.DataLoss, err.Error())
		}
		cloned := *anchor
		cloned.CommittedTranscript = clonePublicChatCommittedTranscript(anchor.CommittedTranscript)
		cloned.ActiveTurnSnapshot = clonePublicChatTurnProjectionState(anchor.ActiveTurnSnapshot)
		cloned.LastTurnSnapshot = clonePublicChatTurnProjectionState(anchor.LastTurnSnapshot)
		cloned.CompletedTurnSnapshots = clonePublicChatTurnProjectionStateMap(anchor.CompletedTurnSnapshots)
		anchors = append(anchors, &cloned)
	}
	s.chatSurfaceMu.Unlock()

	sort.SliceStable(anchors, func(i, j int) bool {
		left := conversationSummaryUpdatedAt(anchors[i])
		right := conversationSummaryUpdatedAt(anchors[j])
		if !left.Equal(right) {
			return left.After(right)
		}
		return strings.TrimSpace(anchors[i].ConversationAnchorID) < strings.TrimSpace(anchors[j].ConversationAnchorID)
	})
	if offset > len(anchors) {
		offset = len(anchors)
	}
	end := offset + pageSize
	if end > len(anchors) {
		end = len(anchors)
	}
	nextPageToken := ""
	if end < len(anchors) {
		nextPageToken = strconv.Itoa(end)
	}
	summaries := make([]*runtimev1.AgentConversationSummary, 0, end-offset)
	for _, anchor := range anchors[offset:end] {
		metadata, err := s.chatStateRepo.loadConversationAnchorMetadata(anchor.ConversationAnchorID)
		if err != nil {
			return nil, grpcerr.WrapWithReasonCode(
				codes.Unavailable,
				runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
				err,
				grpcerr.ReasonOptions{Message: "conversation anchor metadata could not be loaded"},
			)
		}
		summaries = append(summaries, s.agentConversationSummary(anchor, metadata))
	}
	return &runtimev1.ListAgentConversationSummariesResponse{
		Summaries:     summaries,
		NextPageToken: nextPageToken,
	}, nil
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
		LocalAgentRef:        anchor.LocalAgentRef,
		OwnerUserId:          anchor.OwnerUserID,
		RuntimeSourceRef:     anchor.RuntimeSourceRef,
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
	snapshot := &runtimev1.ConversationAnchorSnapshot{
		Anchor:         record,
		ActiveTurnId:   activeTurnID,
		ActiveStreamId: activeStreamID,
	}
	if entry, err := s.agentByID(anchor.LocalAgentRef); err == nil && entry != nil && entry.Agent.GetSourceContextStatus() != nil {
		snapshot.SourceContextStatus = proto.Clone(entry.Agent.GetSourceContextStatus()).(*runtimev1.LocalAgentSourceContextStatus)
	}
	if anchor.LastTurnSnapshot != nil {
		snapshot.TurnContextSummary = cloneAgentTurnContextSummary(anchor.LastTurnSnapshot.ContextSummary)
	}
	return snapshot
}

func (s *Service) agentConversationSummary(anchor *publicChatAnchorState, metadata *structpb.Struct) *runtimev1.AgentConversationSummary {
	if anchor == nil {
		return nil
	}
	transcript, err := publicChatTranscriptProjection(anchor.CommittedTranscript)
	if err != nil {
		return nil
	}
	snapshot := s.buildConversationAnchorSnapshotLocked(anchor, metadata)
	summary := &runtimev1.AgentConversationSummary{
		Anchor:                 snapshot.GetAnchor(),
		Title:                  deriveAgentConversationSummaryTitle(metadata, transcript),
		LastMessageId:          strings.TrimSpace(anchor.LastMessageID),
		TranscriptMessageCount: int32(len(transcript)),
		SourceContextStatus:    snapshot.GetSourceContextStatus(),
		LastTurnContextSummary: snapshot.GetTurnContextSummary(),
	}
	if updatedAt := conversationSummaryUpdatedAt(anchor); !updatedAt.IsZero() {
		summary.UpdatedAt = timestamppb.New(updatedAt)
	}
	if last := lastAgentConversationMessage(transcript); last != nil {
		summary.LastMessageRole = strings.TrimSpace(last.GetRole())
		summary.LastMessageText = compactAgentConversationSummaryText(last.GetContent(), 280)
	}
	return summary
}

func conversationSummaryUpdatedAt(anchor *publicChatAnchorState) time.Time {
	if anchor == nil {
		return time.Time{}
	}
	if !anchor.UpdatedAt.IsZero() {
		return anchor.UpdatedAt.UTC()
	}
	if !anchor.CreatedAt.IsZero() {
		return anchor.CreatedAt.UTC()
	}
	return time.Time{}
}

func deriveAgentConversationSummaryTitle(metadata *structpb.Struct, transcript []*runtimev1.ChatMessage) string {
	if metadata != nil {
		if value := metadata.GetFields()["title"]; value != nil {
			if title := compactAgentConversationSummaryText(value.GetStringValue(), 80); title != "" {
				return title
			}
		}
	}
	for _, message := range transcript {
		if message != nil && strings.TrimSpace(message.GetRole()) == "user" {
			if title := compactAgentConversationSummaryText(message.GetContent(), 80); title != "" {
				return title
			}
		}
	}
	if last := lastAgentConversationMessage(transcript); last != nil {
		if title := compactAgentConversationSummaryText(last.GetContent(), 80); title != "" {
			return title
		}
	}
	return "Agent conversation"
}

func lastAgentConversationMessage(transcript []*runtimev1.ChatMessage) *runtimev1.ChatMessage {
	for i := len(transcript) - 1; i >= 0; i-- {
		if transcript[i] != nil && strings.TrimSpace(transcript[i].GetContent()) != "" {
			return transcript[i]
		}
	}
	return nil
}

func compactAgentConversationSummaryText(value string, maxRunes int) string {
	compact := strings.Join(strings.Fields(value), " ")
	if maxRunes <= 0 {
		return compact
	}
	runes := []rune(compact)
	if len(runes) <= maxRunes {
		return compact
	}
	if maxRunes <= 1 {
		return string(runes[:maxRunes])
	}
	return string(runes[:maxRunes-1]) + "…"
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

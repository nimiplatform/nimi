package runtimeagent

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	runtimeAgentMetaPublicChatSurfaceVersionKey = "public_chat_surface_version"
	runtimeAgentMetaPublicChatSurfaceStateKey   = "public_chat_surface_state"
	runtimeAgentMetaLocalAppSequencesKey        = "local_app_conversation_sequences"
	runtimeAgentMetaConversationAnchorMetadata  = "public_chat_anchor_metadata:"
)

// persistedPublicChatSurfaceState persists Runtime-owned LocalAgent
// conversation truth. More than one durable anchor for the same LocalAgent is
// invalid and requires the explicit offline repair tool; Runtime never mutates
// historical conversation truth during startup.
type persistedPublicChatSurfaceState struct {
	Version             uint64                               `json:"version"`
	SavedAt             string                               `json:"savedAt"`
	Anchors             []persistedPublicChatAnchor          `json:"anchors"`
	FollowUps           []persistedPublicChatFollowUp        `json:"followUps"`
	AvatarLiveInstances []persistedAvatarLiveInstanceBinding `json:"avatarLiveInstances"`
}

type persistedPublicChatAnchor struct {
	ConversationAnchorID   string                                      `json:"conversationAnchorId"`
	AgentID                string                                      `json:"agentId"`
	LocalAgentRef          string                                      `json:"localAgentRef"`
	OwnerUserID            string                                      `json:"ownerUserId"`
	RuntimeSourceRef       string                                      `json:"runtimeSourceRef"`
	CallerAppID            string                                      `json:"callerAppId"`
	RegisteredAppSubject   string                                      `json:"registeredAppSubject,omitempty"`
	SubjectUserID          string                                      `json:"subjectUserId"`
	ThreadID               string                                      `json:"threadId"`
	Binding                publicChatExecutionBinding                  `json:"binding"`
	Bindings               publicChatExecutionBindings                 `json:"bindings,omitempty"`
	ConfigRevision         uint64                                      `json:"configRevision,omitempty"`
	MaxTokens              int32                                       `json:"maxTokens"`
	Reasoning              *publicChatReasoningConfig                  `json:"reasoning,omitempty"`
	CommittedTranscript    []publicChatCommittedTranscriptTurn         `json:"committedTranscript"`
	ConversationSummary    *publicChatConversationSummaryState         `json:"conversationSummary,omitempty"`
	ActiveTurnSnapshot     *persistedPublicChatTurnSnapshot            `json:"activeTurnSnapshot,omitempty"`
	LastTurnSnapshot       *persistedPublicChatTurnSnapshot            `json:"lastTurnSnapshot,omitempty"`
	CompletedTurnSnapshots map[string]*persistedPublicChatTurnSnapshot `json:"completedTurnSnapshots,omitempty"`
	VoiceSidecars          map[string]*publicChatVoiceSidecarState     `json:"voiceSidecars,omitempty"`
	PendingFollowUpID      string                                      `json:"pendingFollowUpId,omitempty"`
	Status                 int32                                       `json:"status,omitempty"`
	LastTurnID             string                                      `json:"lastTurnId,omitempty"`
	LastMessageID          string                                      `json:"lastMessageId,omitempty"`
	LocalAppSequence       uint64                                      `json:"localAppSequence,omitempty"`
	CreatedAt              string                                      `json:"createdAt,omitempty"`
	UpdatedAt              string                                      `json:"updatedAt,omitempty"`
}

type persistedPublicChatTurnSnapshot struct {
	TurnID            string                            `json:"turnId"`
	StreamID          string                            `json:"streamId,omitempty"`
	Status            string                            `json:"status"`
	TraceID           string                            `json:"traceId,omitempty"`
	StreamSequence    uint64                            `json:"streamSequence"`
	TimelineStartedAt string                            `json:"timelineStartedAt,omitempty"`
	Origin            string                            `json:"origin,omitempty"`
	ChainID           string                            `json:"chainId,omitempty"`
	FollowUpDepth     int                               `json:"followUpDepth,omitempty"`
	MaxFollowUpTurns  int                               `json:"maxFollowUpTurns,omitempty"`
	SourceTurnID      string                            `json:"sourceTurnId,omitempty"`
	SourceActionID    string                            `json:"sourceActionId,omitempty"`
	ModelResolved     string                            `json:"modelResolved,omitempty"`
	RouteDecision     runtimev1.RoutePolicy             `json:"routeDecision,omitempty"`
	OutputObserved    bool                              `json:"outputObserved,omitempty"`
	ReasoningObserved bool                              `json:"reasoningObserved,omitempty"`
	MessageID         string                            `json:"messageId,omitempty"`
	AssistantText     string                            `json:"assistantText,omitempty"`
	Structured        *publicChatStructuredEnvelope     `json:"structured,omitempty"`
	AssistantMemory   *publicChatAssistantMemoryOutcome `json:"assistantMemory,omitempty"`
	Sidecar           *publicChatSidecarOutcome         `json:"sidecar,omitempty"`
	FollowUp          *publicChatFollowUpOutcome        `json:"followUp,omitempty"`
	ContextSummary    *persistedAgentTurnContextSummary `json:"contextSummary,omitempty"`
	FinishReason      string                            `json:"finishReason,omitempty"`
	StreamSimulated   bool                              `json:"streamSimulated,omitempty"`
	ReasonCode        runtimev1.ReasonCode              `json:"reasonCode,omitempty"`
	ReasonCodeToken   string                            `json:"reasonCodeToken,omitempty"`
	ActionHint        string                            `json:"actionHint,omitempty"`
	Message           string                            `json:"message,omitempty"`
	ActionStatus      string                            `json:"actionStatus,omitempty"`
	ActionReasonCode  runtimev1.ReasonCode              `json:"actionReasonCode,omitempty"`
	ActionMessage     string                            `json:"actionMessage,omitempty"`
	UpdatedAt         string                            `json:"updatedAt,omitempty"`
}

// persistedAgentTurnContextSummary uses strict proto JSON so persistence
// cannot silently accept unknown summary fields. Raw lanes and prompt text are
// structurally absent from the bounded protobuf.
type persistedAgentTurnContextSummary struct {
	Summary *runtimev1.AgentTurnContextSummary
}

func (p persistedAgentTurnContextSummary) MarshalJSON() ([]byte, error) {
	if p.Summary == nil {
		return []byte("null"), nil
	}
	return (protojson.MarshalOptions{UseProtoNames: true}).Marshal(p.Summary)
}

func (p *persistedAgentTurnContextSummary) UnmarshalJSON(raw []byte) error {
	if p == nil {
		return fmt.Errorf("unmarshal agent turn context summary into nil target")
	}
	if strings.TrimSpace(string(raw)) == "" || strings.TrimSpace(string(raw)) == "null" {
		p.Summary = nil
		return nil
	}
	summary := &runtimev1.AgentTurnContextSummary{}
	if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(raw, summary); err != nil {
		return fmt.Errorf("unmarshal agent turn context summary: %w", err)
	}
	p.Summary = summary
	return nil
}

func formatOptionalTime(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.UTC().Format(time.RFC3339Nano)
}

func parseOptionalTime(value string) time.Time {
	if strings.TrimSpace(value) == "" {
		return time.Time{}
	}
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return time.Time{}
	}
	return parsed.UTC()
}

type persistedPublicChatFollowUp struct {
	FollowUpID           string          `json:"followUpId"`
	ConversationAnchorID string          `json:"conversationAnchorId"`
	AgentID              string          `json:"agentId"`
	CallerAppID          string          `json:"callerAppId"`
	SubjectUserID        string          `json:"subjectUserId"`
	ThreadID             string          `json:"threadId"`
	Instruction          string          `json:"instruction"`
	ScheduledFor         string          `json:"scheduledFor"`
	ChainID              string          `json:"chainId"`
	FollowUpDepth        int             `json:"followUpDepth"`
	MaxFollowUpTurns     int             `json:"maxFollowUpTurns"`
	SourceTurnID         string          `json:"sourceTurnId"`
	SourceActionID       string          `json:"sourceActionId"`
	HookIntent           json.RawMessage `json:"hookIntent,omitempty"`
}

type persistedAvatarLiveInstanceBinding struct {
	AvatarInstanceID     string `json:"avatarInstanceId"`
	ConversationAnchorID string `json:"conversationAnchorId"`
	AgentID              string `json:"agentId"`
	LocalAgentRef        string `json:"localAgentRef"`
	OwnerUserID          string `json:"ownerUserId"`
	RuntimeSourceRef     string `json:"runtimeSourceRef"`
	CallerAppID          string `json:"callerAppId"`
	SubjectUserID        string `json:"subjectUserId"`
	RegisteredAt         string `json:"registeredAt,omitempty"`
	UpdatedAt            string `json:"updatedAt,omitempty"`
}

func (s *Service) capturePublicChatSurfaceSnapshotLocked() (persistedPublicChatSurfaceState, error) {
	s.chatSurfaceVersion++
	snapshot := persistedPublicChatSurfaceState{
		Version:             s.chatSurfaceVersion,
		SavedAt:             time.Now().UTC().Format(time.RFC3339Nano),
		Anchors:             make([]persistedPublicChatAnchor, 0, len(s.chatAnchors)),
		FollowUps:           make([]persistedPublicChatFollowUp, 0, len(s.chatFollowUps)),
		AvatarLiveInstances: make([]persistedAvatarLiveInstanceBinding, 0, len(s.avatarLiveInstanceBindings)),
	}
	marshal := protojson.MarshalOptions{UseProtoNames: true}
	for _, session := range s.chatAnchors {
		if session == nil {
			continue
		}
		if err := validatePublicChatCommittedTranscript(session.CommittedTranscript); err != nil {
			return persistedPublicChatSurfaceState{}, fmt.Errorf("capture conversation anchor %s continuity: %w", session.ConversationAnchorID, err)
		}
		if err := validatePublicChatConversationSummary(session.ConversationSummary, session.CommittedTranscript); err != nil {
			return persistedPublicChatSurfaceState{}, fmt.Errorf("capture conversation anchor %s summary: %w", session.ConversationAnchorID, err)
		}
		item := persistedPublicChatAnchor{
			ConversationAnchorID:   session.ConversationAnchorID,
			AgentID:                session.AgentID,
			LocalAgentRef:          session.LocalAgentRef,
			OwnerUserID:            session.OwnerUserID,
			RuntimeSourceRef:       session.RuntimeSourceRef,
			CallerAppID:            session.CallerAppID,
			RegisteredAppSubject:   session.RegisteredAppSubject,
			SubjectUserID:          session.SubjectUserID,
			ThreadID:               session.ThreadID,
			Binding:                session.Binding,
			Bindings:               clonePublicChatExecutionBindings(session.Bindings),
			ConfigRevision:         session.ConfigRevision,
			MaxTokens:              session.MaxTokens,
			Reasoning:              clonePublicChatReasoningConfig(session.Reasoning),
			ActiveTurnSnapshot:     toPersistedPublicChatTurnSnapshot(session.ActiveTurnSnapshot),
			LastTurnSnapshot:       toPersistedPublicChatTurnSnapshot(session.LastTurnSnapshot),
			CompletedTurnSnapshots: toPersistedPublicChatTurnSnapshotMap(session.CompletedTurnSnapshots),
			VoiceSidecars:          clonePublicChatVoiceSidecars(session.VoiceSidecars),
			PendingFollowUpID:      session.PendingFollowUpID,
			CommittedTranscript:    clonePublicChatCommittedTranscript(session.CommittedTranscript),
			ConversationSummary:    clonePublicChatConversationSummary(session.ConversationSummary),
			Status:                 int32(session.Status),
			LastTurnID:             session.LastTurnID,
			LastMessageID:          session.LastMessageID,
			LocalAppSequence:       session.LocalAppSequence,
		}
		if !session.CreatedAt.IsZero() {
			item.CreatedAt = session.CreatedAt.UTC().Format(time.RFC3339Nano)
		}
		if !session.UpdatedAt.IsZero() {
			item.UpdatedAt = session.UpdatedAt.UTC().Format(time.RFC3339Nano)
		}
		snapshot.Anchors = append(snapshot.Anchors, item)
	}
	for _, followUp := range s.chatFollowUps {
		if followUp == nil {
			continue
		}
		item := persistedPublicChatFollowUp{
			FollowUpID:           followUp.FollowUpID,
			ConversationAnchorID: followUp.ConversationAnchorID,
			AgentID:              followUp.AgentID,
			CallerAppID:          followUp.CallerAppID,
			SubjectUserID:        followUp.SubjectUserID,
			ThreadID:             followUp.ThreadID,
			Instruction:          followUp.Instruction,
			ScheduledFor:         followUp.ScheduledFor.UTC().Format(time.RFC3339Nano),
			ChainID:              followUp.ChainID,
			FollowUpDepth:        followUp.FollowUpDepth,
			MaxFollowUpTurns:     followUp.MaxFollowUpTurns,
			SourceTurnID:         followUp.SourceTurnID,
			SourceActionID:       followUp.SourceActionID,
		}
		if followUp.HookIntent != nil {
			raw, err := marshal.Marshal(followUp.HookIntent)
			if err != nil {
				return persistedPublicChatSurfaceState{}, fmt.Errorf("marshal public chat follow-up hook intent: %w", err)
			}
			item.HookIntent = append(json.RawMessage(nil), raw...)
		}
		snapshot.FollowUps = append(snapshot.FollowUps, item)
	}
	for _, binding := range s.avatarLiveInstanceBindings {
		if binding == nil {
			continue
		}
		item := persistedAvatarLiveInstanceBinding{
			AvatarInstanceID:     binding.AvatarInstanceID,
			ConversationAnchorID: binding.ConversationAnchorID,
			AgentID:              binding.AgentID,
			LocalAgentRef:        binding.LocalAgentRef,
			OwnerUserID:          binding.OwnerUserID,
			RuntimeSourceRef:     binding.RuntimeSourceRef,
			CallerAppID:          binding.CallerAppID,
			SubjectUserID:        binding.SubjectUserID,
		}
		if !binding.RegisteredAt.IsZero() {
			item.RegisteredAt = binding.RegisteredAt.UTC().Format(time.RFC3339Nano)
		}
		if !binding.UpdatedAt.IsZero() {
			item.UpdatedAt = binding.UpdatedAt.UTC().Format(time.RFC3339Nano)
		}
		snapshot.AvatarLiveInstances = append(snapshot.AvatarLiveInstances, item)
	}
	return snapshot, nil
}

func (r *publicChatSurfaceStateRepository) persistPublicChatSurfaceState(snapshot persistedPublicChatSurfaceState) error {
	if r == nil || r.backend == nil {
		return nil
	}
	raw, err := json.Marshal(snapshot)
	if err != nil {
		return fmt.Errorf("marshal public chat surface state: %w", err)
	}
	return r.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		return persistPublicChatSurfaceStateTx(tx, snapshot, string(raw))
	})
}

func (r *publicChatSurfaceStateRepository) persistLocalAppConversationSequences(sequences map[string]uint64) error {
	if r == nil || r.backend == nil {
		return fmt.Errorf("public chat surface persistence unavailable")
	}
	raw, err := json.Marshal(sequences)
	if err != nil {
		return fmt.Errorf("marshal Local App Conversation sequences: %w", err)
	}
	return r.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		_, err := tx.Exec(
			`INSERT INTO runtime_local_agent_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
			runtimeAgentMetaLocalAppSequencesKey,
			string(raw),
		)
		return err
	})
}

func (r *publicChatSurfaceStateRepository) persistPublicChatSurfaceStateWithAnchorMetadata(snapshot persistedPublicChatSurfaceState, anchorID string, metadata *structpb.Struct) (*structpb.Struct, error) {
	if r == nil || r.backend == nil {
		return nil, fmt.Errorf("public chat surface persistence unavailable")
	}
	raw, err := json.Marshal(snapshot)
	if err != nil {
		return nil, fmt.Errorf("marshal public chat surface state: %w", err)
	}
	metadataJSON, err := marshalConversationAnchorMetadata(metadata)
	if err != nil {
		return nil, err
	}
	key := runtimeAgentConversationAnchorMetadataKey(anchorID)
	if err := r.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		if err := persistPublicChatSurfaceStateTx(tx, snapshot, string(raw)); err != nil {
			return err
		}
		if key == "" {
			return nil
		}
		if strings.TrimSpace(metadataJSON) == "" {
			_, err := tx.Exec(`DELETE FROM runtime_local_agent_meta WHERE key = ?`, key)
			return err
		}
		_, err := tx.Exec(
			`INSERT INTO runtime_local_agent_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
			key,
			metadataJSON,
		)
		return err
	}); err != nil {
		return nil, err
	}
	return parseConversationAnchorMetadata(metadataJSON)
}

func persistPublicChatSurfaceStateTx(tx *sql.Tx, snapshot persistedPublicChatSurfaceState, raw string) error {
	var currentVersionRaw string
	err := tx.QueryRow(`SELECT value FROM runtime_local_agent_meta WHERE key = ?`, runtimeAgentMetaPublicChatSurfaceVersionKey).Scan(&currentVersionRaw)
	if err != nil && err != sql.ErrNoRows {
		return err
	}
	currentVersion, err := decodeSequenceValue(currentVersionRaw)
	if err != nil {
		currentVersion = 0
	}
	if currentVersion > snapshot.Version {
		return nil
	}
	if _, err := tx.Exec(
		`INSERT INTO runtime_local_agent_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
		runtimeAgentMetaPublicChatSurfaceVersionKey,
		encodeSequenceValue(snapshot.Version),
	); err != nil {
		return err
	}
	if _, err := tx.Exec(
		`INSERT INTO runtime_local_agent_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
		runtimeAgentMetaPublicChatSurfaceStateKey,
		raw,
	); err != nil {
		return err
	}
	return nil
}

func runtimeAgentConversationAnchorMetadataKey(anchorID string) string {
	trimmed := strings.TrimSpace(anchorID)
	if trimmed == "" {
		return ""
	}
	return runtimeAgentMetaConversationAnchorMetadata + trimmed
}

func marshalConversationAnchorMetadata(metadata *structpb.Struct) (string, error) {
	if metadata == nil {
		return "", nil
	}
	raw, err := protojson.Marshal(metadata)
	if err != nil {
		return "", fmt.Errorf("marshal conversation anchor metadata: %w", err)
	}
	return string(raw), nil
}

func parseConversationAnchorMetadata(raw string) (*structpb.Struct, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	metadata := &structpb.Struct{}
	if err := protojson.Unmarshal([]byte(raw), metadata); err != nil {
		return nil, fmt.Errorf("parse conversation anchor metadata: %w", err)
	}
	return metadata, nil
}

func (r *publicChatSurfaceStateRepository) loadConversationAnchorMetadata(anchorID string) (*structpb.Struct, error) {
	if r == nil || r.stateRepo == nil {
		return nil, fmt.Errorf("public chat surface persistence unavailable")
	}
	key := runtimeAgentConversationAnchorMetadataKey(anchorID)
	if key == "" {
		return nil, nil
	}
	raw, err := r.stateRepo.runtimeAgentMetaValue(key)
	if err != nil {
		return nil, err
	}
	return parseConversationAnchorMetadata(raw)
}

func (s *Service) persistCurrentPublicChatSurfaceState() {
	if s == nil || s.isClosed() || s.chatStateRepo == nil {
		return
	}
	s.chatSurfaceMu.Lock()
	snapshot, err := s.capturePublicChatSurfaceSnapshotLocked()
	s.chatSurfaceMu.Unlock()
	if err != nil {
		if s.logger != nil {
			s.logger.Warn("capture public chat surface state failed", "error", err)
		}
		return
	}
	if err := s.chatStateRepo.persistPublicChatSurfaceState(snapshot); err != nil && s.logger != nil {
		s.logger.Warn("persist public chat surface state failed", "version", snapshot.Version, "error", err)
	}
}

// persistCurrentPublicChatSurfaceStateForProjection is the fail-closed
// persistence boundary for a protected Conversation sequence range. Callers
// serialize allocation through localAppConversationPublishMu and publish no
// event until this capture and transaction succeed.
func (s *Service) persistCurrentPublicChatSurfaceStateForProjection() error {
	if s == nil || s.isClosed() || s.chatStateRepo == nil {
		return fmt.Errorf("public chat surface persistence unavailable")
	}
	s.chatSurfaceMu.Lock()
	sequences := make(map[string]uint64, len(s.chatAnchors))
	for anchorID, anchor := range s.chatAnchors {
		if anchor != nil && anchor.LocalAppSequence > 0 {
			sequences[anchorID] = anchor.LocalAppSequence
		}
	}
	s.chatSurfaceMu.Unlock()
	if err := s.chatStateRepo.persistLocalAppConversationSequences(sequences); err != nil {
		return fmt.Errorf("persist Local App Conversation sequence range: %w", err)
	}
	return nil
}

// persistPublicChatSurfaceStateLocked is the fail-closed persistence path for
// irreversible public-chat state transitions. The caller must hold
// chatSurfaceMu for the entire capture and SQLite transaction so the in-memory
// transcript cannot advance independently of its durable representation.
// Best-effort projection updates continue to use
// persistCurrentPublicChatSurfaceState; they are not commit boundaries.
func (s *Service) persistPublicChatSurfaceStateLocked() error {
	if s == nil || s.isClosed() || s.chatStateRepo == nil {
		return fmt.Errorf("public chat surface persistence unavailable")
	}
	snapshot, err := s.capturePublicChatSurfaceSnapshotLocked()
	if err != nil {
		return fmt.Errorf("capture public chat surface state: %w", err)
	}
	if err := s.chatStateRepo.persistPublicChatSurfaceState(snapshot); err != nil {
		return fmt.Errorf("persist public chat surface state version %d: %w", snapshot.Version, err)
	}
	return nil
}

func (s *Service) loadPublicChatSurfaceStateFromDB() error {
	if s == nil || s.chatStateRepo == nil {
		return nil
	}
	return s.chatStateRepo.loadPublicChatSurfaceStateFromDB(s)
}

func (r *publicChatSurfaceStateRepository) loadPublicChatSurfaceStateFromDB(s *Service) error {
	raw, err := r.stateRepo.runtimeAgentMetaValue(runtimeAgentMetaPublicChatSurfaceStateKey)
	if err != nil {
		return err
	}
	versionRaw, err := r.stateRepo.runtimeAgentMetaValue(runtimeAgentMetaPublicChatSurfaceVersionKey)
	if err != nil {
		return err
	}
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	sequenceRaw, err := r.stateRepo.runtimeAgentMetaValue(runtimeAgentMetaLocalAppSequencesKey)
	if err != nil {
		return err
	}
	sequences := make(map[string]uint64)
	if strings.TrimSpace(sequenceRaw) != "" {
		decoder := json.NewDecoder(strings.NewReader(sequenceRaw))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&sequences); err != nil {
			return fmt.Errorf("parse Local App Conversation sequences: %w", err)
		}
		if err := decoder.Decode(&struct{}{}); err != io.EOF {
			return fmt.Errorf("parse Local App Conversation sequences: trailing JSON content")
		}
	}
	var persisted persistedPublicChatSurfaceState
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&persisted); err != nil {
		return fmt.Errorf("parse public chat surface state: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return fmt.Errorf("parse public chat surface state: trailing JSON content")
	}
	if strings.TrimSpace(versionRaw) != "" {
		if version, err := decodeSequenceValue(versionRaw); err == nil && version > persisted.Version {
			persisted.Version = version
		}
	}
	if err := validatePersistedPublicChatConversationSingletons(persisted.Anchors); err != nil {
		return fmt.Errorf("public chat surface state requires explicit offline repair with runtime:repair-local-agent-chat while Runtime is stopped: %w", err)
	}
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	s.chatSurfaceVersion = persisted.Version
	for key := range s.chatAnchors {
		delete(s.chatAnchors, key)
	}
	for key := range s.chatTurns {
		delete(s.chatTurns, key)
	}
	for key := range s.chatFollowUps {
		delete(s.chatFollowUps, key)
	}
	for key := range s.avatarLiveInstanceBindings {
		delete(s.avatarLiveInstanceBindings, key)
	}
	for key := range s.chatActiveByAgent {
		delete(s.chatActiveByAgent, key)
	}
	for _, item := range persisted.Anchors {
		if _, err := validateLocalAgentIdentity(item.OwnerUserID, item.RuntimeSourceRef, item.LocalAgentRef); err != nil {
			return fmt.Errorf("persisted conversation anchor %s local identity invalid: %w", item.ConversationAnchorID, err)
		}
		if err := validatePublicChatCommittedTranscript(item.CommittedTranscript); err != nil {
			return fmt.Errorf("persisted conversation anchor %s continuity invalid: %w", item.ConversationAnchorID, err)
		}
		if err := validatePublicChatConversationSummary(item.ConversationSummary, item.CommittedTranscript); err != nil {
			return fmt.Errorf("persisted conversation anchor %s summary invalid: %w", item.ConversationAnchorID, err)
		}
		createdAt := time.Time{}
		updatedAt := time.Time{}
		if strings.TrimSpace(item.CreatedAt) != "" {
			if parsed, err := time.Parse(time.RFC3339Nano, item.CreatedAt); err == nil {
				createdAt = parsed.UTC()
			}
		}
		if strings.TrimSpace(item.UpdatedAt) != "" {
			if parsed, err := time.Parse(time.RFC3339Nano, item.UpdatedAt); err == nil {
				updatedAt = parsed.UTC()
			}
		}
		status := runtimev1.ConversationAnchorStatus(item.Status)
		switch status {
		case runtimev1.ConversationAnchorStatus_CONVERSATION_ANCHOR_STATUS_UNSPECIFIED:
			status = runtimev1.ConversationAnchorStatus_CONVERSATION_ANCHOR_STATUS_ACTIVE
		case runtimev1.ConversationAnchorStatus_CONVERSATION_ANCHOR_STATUS_ACTIVE,
			runtimev1.ConversationAnchorStatus_CONVERSATION_ANCHOR_STATUS_CLOSED:
		default:
			return fmt.Errorf("persisted conversation anchor %s status is invalid", item.ConversationAnchorID)
		}
		bindings := clonePublicChatExecutionBindings(item.Bindings)
		if len(bindings) == 0 && strings.TrimSpace(item.Binding.ModelID) != "" {
			bindings = publicChatExecutionBindings{"text.generate": item.Binding}
		}
		binding := item.Binding
		if strings.TrimSpace(binding.ModelID) == "" {
			binding = bindings["text.generate"]
		}
		localAppSequence := item.LocalAppSequence
		if persistedSequence := sequences[item.ConversationAnchorID]; persistedSequence > localAppSequence {
			localAppSequence = persistedSequence
		}
		s.chatAnchors[item.ConversationAnchorID] = &publicChatAnchorState{
			ConversationAnchorID:   item.ConversationAnchorID,
			AgentID:                item.AgentID,
			LocalAgentRef:          item.LocalAgentRef,
			OwnerUserID:            item.OwnerUserID,
			RuntimeSourceRef:       item.RuntimeSourceRef,
			CallerAppID:            item.CallerAppID,
			RegisteredAppSubject:   item.RegisteredAppSubject,
			SubjectUserID:          item.SubjectUserID,
			ThreadID:               item.ThreadID,
			Binding:                binding,
			Bindings:               bindings,
			ConfigRevision:         item.ConfigRevision,
			ActiveTurnID:           "",
			MaxTokens:              item.MaxTokens,
			Reasoning:              clonePublicChatReasoningConfig(item.Reasoning),
			CommittedTranscript:    clonePublicChatCommittedTranscript(item.CommittedTranscript),
			ConversationSummary:    clonePublicChatConversationSummary(item.ConversationSummary),
			ActiveTurnSnapshot:     fromPersistedPublicChatTurnSnapshot(item.ActiveTurnSnapshot),
			LastTurnSnapshot:       fromPersistedPublicChatTurnSnapshot(item.LastTurnSnapshot),
			CompletedTurnSnapshots: fromPersistedPublicChatTurnSnapshotMap(item.CompletedTurnSnapshots),
			VoiceSidecars:          clonePublicChatVoiceSidecars(item.VoiceSidecars),
			PendingFollowUpID:      item.PendingFollowUpID,
			Status:                 status,
			LastTurnID:             item.LastTurnID,
			LastMessageID:          item.LastMessageID,
			LocalAppSequence:       localAppSequence,
			CreatedAt:              createdAt,
			UpdatedAt:              updatedAt,
		}
		if restored := s.chatAnchors[item.ConversationAnchorID]; restored != nil && restored.ActiveTurnSnapshot != nil {
			recovered := clonePublicChatTurnProjectionState(restored.ActiveTurnSnapshot)
			recovered.Status = publicChatTurnStatusInterrupted
			recovered.ReasonCode = runtimev1.ReasonCode_AI_STREAM_BROKEN
			recovered.Message = "public chat turn interrupted by runtime restart"
			if recovered.ActionStatus == publicChatActionStatusPlanned || recovered.ActionStatus == publicChatActionStatusStarted {
				recovered.ActionStatus = publicChatActionStatusFailed
				recovered.ActionReasonCode = runtimev1.ReasonCode_AI_STREAM_BROKEN
				recovered.ActionMessage = "public chat image action interrupted by runtime restart"
			}
			recovered.UpdatedAt = time.Now().UTC()
			restored.LastTurnSnapshot = recovered
			if restored.CompletedTurnSnapshots == nil {
				restored.CompletedTurnSnapshots = make(map[string]*publicChatTurnProjectionState)
			}
			restored.CompletedTurnSnapshots[recovered.TurnID] = clonePublicChatTurnProjectionState(recovered)
			restored.ActiveTurnSnapshot = nil
			restored.ActiveTurnID = ""
		}
	}
	for _, item := range persisted.AvatarLiveInstances {
		if _, err := validateLocalAgentIdentity(item.OwnerUserID, item.RuntimeSourceRef, item.LocalAgentRef); err != nil {
			return fmt.Errorf("persisted avatar live instance %s local identity invalid: %w", item.AvatarInstanceID, err)
		}
		if strings.TrimSpace(item.AvatarInstanceID) == "" || strings.TrimSpace(item.ConversationAnchorID) == "" {
			return fmt.Errorf("persisted avatar live instance binding is incomplete")
		}
		if anchor := s.chatAnchors[item.ConversationAnchorID]; anchor == nil {
			continue
		} else if anchor.LocalAgentRef != item.LocalAgentRef || anchor.OwnerUserID != item.OwnerUserID || anchor.RuntimeSourceRef != item.RuntimeSourceRef {
			return fmt.Errorf("persisted avatar live instance %s anchor identity mismatch", item.AvatarInstanceID)
		}
		registeredAt := time.Time{}
		updatedAt := time.Time{}
		if strings.TrimSpace(item.RegisteredAt) != "" {
			if parsed, err := time.Parse(time.RFC3339Nano, item.RegisteredAt); err == nil {
				registeredAt = parsed.UTC()
			}
		}
		if strings.TrimSpace(item.UpdatedAt) != "" {
			if parsed, err := time.Parse(time.RFC3339Nano, item.UpdatedAt); err == nil {
				updatedAt = parsed.UTC()
			}
		}
		key := avatarLiveInstanceBindingKey(item.LocalAgentRef, item.AvatarInstanceID)
		s.avatarLiveInstanceBindings[key] = &avatarLiveInstanceBindingState{
			AvatarInstanceID:     item.AvatarInstanceID,
			ConversationAnchorID: item.ConversationAnchorID,
			AgentID:              item.AgentID,
			LocalAgentRef:        item.LocalAgentRef,
			OwnerUserID:          item.OwnerUserID,
			RuntimeSourceRef:     item.RuntimeSourceRef,
			CallerAppID:          item.CallerAppID,
			SubjectUserID:        item.SubjectUserID,
			RegisteredAt:         registeredAt,
			UpdatedAt:            updatedAt,
		}
	}
	for _, item := range persisted.FollowUps {
		scheduledFor, err := time.Parse(time.RFC3339Nano, item.ScheduledFor)
		if err != nil {
			return fmt.Errorf("parse public chat follow-up scheduled time: %w", err)
		}
		var hookIntent *runtimev1.HookIntent
		if len(item.HookIntent) > 0 {
			hookIntent = &runtimev1.HookIntent{}
			if err := protojson.Unmarshal(item.HookIntent, hookIntent); err != nil {
				return fmt.Errorf("unmarshal public chat follow-up hook intent: %w", err)
			}
		}
		s.chatFollowUps[item.FollowUpID] = &publicChatFollowUpState{
			FollowUpID:           item.FollowUpID,
			ConversationAnchorID: item.ConversationAnchorID,
			AgentID:              item.AgentID,
			CallerAppID:          item.CallerAppID,
			SubjectUserID:        item.SubjectUserID,
			ThreadID:             item.ThreadID,
			Instruction:          item.Instruction,
			ScheduledFor:         scheduledFor.UTC(),
			ChainID:              item.ChainID,
			FollowUpDepth:        item.FollowUpDepth,
			MaxFollowUpTurns:     item.MaxFollowUpTurns,
			SourceTurnID:         item.SourceTurnID,
			SourceActionID:       item.SourceActionID,
			HookIntent:           hookIntent,
		}
	}
	return nil
}

func validatePersistedPublicChatConversationSingletons(anchors []persistedPublicChatAnchor) error {
	anchorByOwnerAgent := make(map[string]string, len(anchors))
	for _, anchor := range anchors {
		ownerUserID := strings.TrimSpace(anchor.OwnerUserID)
		localAgentRef := strings.TrimSpace(anchor.LocalAgentRef)
		anchorID := strings.TrimSpace(anchor.ConversationAnchorID)
		if ownerUserID == "" || localAgentRef == "" || anchorID == "" {
			continue
		}
		key := ownerUserID + "\x00" + localAgentRef
		if existingAnchorID, duplicate := anchorByOwnerAgent[key]; duplicate {
			return fmt.Errorf(
				"multiple durable conversation anchors for owner_user_id %q and local_agent_ref %q: %q and %q",
				ownerUserID,
				localAgentRef,
				existingAnchorID,
				anchorID,
			)
		}
		anchorByOwnerAgent[key] = anchorID
	}
	for _, anchor := range anchors {
		if runtimev1.ConversationAnchorStatus(anchor.Status) ==
			runtimev1.ConversationAnchorStatus_CONVERSATION_ANCHOR_STATUS_CLOSED {
			return fmt.Errorf(
				"durable conversation anchor %q is closed and cannot satisfy LocalAgent singleton continuity",
				strings.TrimSpace(anchor.ConversationAnchorID),
			)
		}
	}
	return nil
}

func (s *Service) resolveCommittedChatTurnOrigin(agentID string, turnID string) stateEventOrigin {
	if s == nil {
		return stateEventOrigin{}
	}
	trimmedAgentID := strings.TrimSpace(agentID)
	trimmedTurnID := strings.TrimSpace(turnID)
	if trimmedAgentID == "" || trimmedTurnID == "" {
		return stateEventOrigin{}
	}
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()

	matches := make(map[string]stateEventOrigin)
	record := func(origin stateEventOrigin) {
		if strings.TrimSpace(origin.ConversationAnchorID) == "" || strings.TrimSpace(origin.OriginatingTurnID) == "" {
			return
		}
		key := origin.ConversationAnchorID + "|" + origin.OriginatingTurnID
		current, exists := matches[key]
		if !exists || (strings.TrimSpace(current.OriginatingStreamID) == "" && strings.TrimSpace(origin.OriginatingStreamID) != "") {
			matches[key] = origin
		}
	}

	if turn := s.chatTurns[trimmedTurnID]; turn != nil && strings.TrimSpace(turn.AgentID) == trimmedAgentID {
		record(stateEventOrigin{
			ConversationAnchorID: strings.TrimSpace(turn.ConversationAnchorID),
			OriginatingTurnID:    strings.TrimSpace(turn.TurnID),
			OriginatingStreamID:  strings.TrimSpace(turn.StreamID),
		})
	}
	for _, anchor := range s.chatAnchors {
		if anchor == nil || strings.TrimSpace(anchor.AgentID) != trimmedAgentID {
			continue
		}
		if snapshot := anchor.ActiveTurnSnapshot; snapshot != nil && strings.TrimSpace(snapshot.TurnID) == trimmedTurnID {
			record(stateEventOrigin{
				ConversationAnchorID: strings.TrimSpace(anchor.ConversationAnchorID),
				OriginatingTurnID:    trimmedTurnID,
			})
		}
		if snapshot := anchor.LastTurnSnapshot; snapshot != nil && strings.TrimSpace(snapshot.TurnID) == trimmedTurnID {
			record(stateEventOrigin{
				ConversationAnchorID: strings.TrimSpace(anchor.ConversationAnchorID),
				OriginatingTurnID:    trimmedTurnID,
			})
		}
	}
	if len(matches) != 1 {
		return stateEventOrigin{}
	}
	for _, origin := range matches {
		return origin
	}
	return stateEventOrigin{}
}

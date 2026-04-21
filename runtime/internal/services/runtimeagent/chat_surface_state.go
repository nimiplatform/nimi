package runtimeagent

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/encoding/protojson"
)

const (
	runtimeAgentMetaPublicChatSurfaceVersionKey = "public_chat_surface_version"
	runtimeAgentMetaPublicChatSurfaceStateKey   = "public_chat_surface_state"
)

type persistedPublicChatSurfaceState struct {
	Version   uint64                        `json:"version"`
	SavedAt   string                        `json:"savedAt"`
	Sessions  []persistedPublicChatSession  `json:"sessions"`
	FollowUps []persistedPublicChatFollowUp `json:"followUps"`
}

type persistedPublicChatSession struct {
	SessionID          string                           `json:"sessionId"`
	AgentID            string                           `json:"agentId"`
	CallerAppID        string                           `json:"callerAppId"`
	SubjectUserID      string                           `json:"subjectUserId"`
	ThreadID           string                           `json:"threadId"`
	Binding            publicChatExecutionBinding       `json:"binding"`
	SystemPrompt       string                           `json:"systemPrompt"`
	MaxTokens          int32                            `json:"maxTokens"`
	Reasoning          *publicChatReasoningConfig       `json:"reasoning,omitempty"`
	Transcript         []json.RawMessage                `json:"transcript"`
	ActiveTurnSnapshot *persistedPublicChatTurnSnapshot `json:"activeTurnSnapshot,omitempty"`
	LastTurnSnapshot   *persistedPublicChatTurnSnapshot `json:"lastTurnSnapshot,omitempty"`
	PendingFollowUpID  string                           `json:"pendingFollowUpId,omitempty"`
}

type persistedPublicChatTurnSnapshot struct {
	TurnID            string                            `json:"turnId"`
	Status            string                            `json:"status"`
	TraceID           string                            `json:"traceId,omitempty"`
	StreamSequence    uint64                            `json:"streamSequence"`
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
	FinishReason      string                            `json:"finishReason,omitempty"`
	StreamSimulated   bool                              `json:"streamSimulated,omitempty"`
	ReasonCode        runtimev1.ReasonCode              `json:"reasonCode,omitempty"`
	ActionHint        string                            `json:"actionHint,omitempty"`
	Message           string                            `json:"message,omitempty"`
	UpdatedAt         string                            `json:"updatedAt,omitempty"`
}

type persistedPublicChatFollowUp struct {
	FollowUpID       string `json:"followUpId"`
	SessionID        string `json:"sessionId"`
	AgentID          string `json:"agentId"`
	CallerAppID      string `json:"callerAppId"`
	SubjectUserID    string `json:"subjectUserId"`
	ThreadID         string `json:"threadId"`
	Instruction      string `json:"instruction"`
	ScheduledFor     string `json:"scheduledFor"`
	ChainID          string `json:"chainId"`
	FollowUpDepth    int    `json:"followUpDepth"`
	MaxFollowUpTurns int    `json:"maxFollowUpTurns"`
	SourceTurnID     string `json:"sourceTurnId"`
	SourceActionID   string `json:"sourceActionId"`
}

func (s *Service) capturePublicChatSurfaceSnapshotLocked() (persistedPublicChatSurfaceState, error) {
	s.chatSurfaceVersion++
	snapshot := persistedPublicChatSurfaceState{
		Version:   s.chatSurfaceVersion,
		SavedAt:   time.Now().UTC().Format(time.RFC3339Nano),
		Sessions:  make([]persistedPublicChatSession, 0, len(s.chatSessions)),
		FollowUps: make([]persistedPublicChatFollowUp, 0, len(s.chatFollowUps)),
	}
	marshal := protojson.MarshalOptions{UseProtoNames: true}
	for _, session := range s.chatSessions {
		if session == nil {
			continue
		}
		item := persistedPublicChatSession{
			SessionID:          session.SessionID,
			AgentID:            session.AgentID,
			CallerAppID:        session.CallerAppID,
			SubjectUserID:      session.SubjectUserID,
			ThreadID:           session.ThreadID,
			Binding:            session.Binding,
			SystemPrompt:       session.SystemPrompt,
			MaxTokens:          session.MaxTokens,
			Reasoning:          clonePublicChatReasoningConfig(session.Reasoning),
			ActiveTurnSnapshot: toPersistedPublicChatTurnSnapshot(session.ActiveTurnSnapshot),
			LastTurnSnapshot:   toPersistedPublicChatTurnSnapshot(session.LastTurnSnapshot),
			PendingFollowUpID:  session.PendingFollowUpID,
			Transcript:         make([]json.RawMessage, 0, len(session.Transcript)),
		}
		for _, message := range session.Transcript {
			if message == nil {
				continue
			}
			raw, err := marshal.Marshal(message)
			if err != nil {
				return persistedPublicChatSurfaceState{}, fmt.Errorf("marshal public chat transcript: %w", err)
			}
			item.Transcript = append(item.Transcript, raw)
		}
		snapshot.Sessions = append(snapshot.Sessions, item)
	}
	for _, followUp := range s.chatFollowUps {
		if followUp == nil {
			continue
		}
		snapshot.FollowUps = append(snapshot.FollowUps, persistedPublicChatFollowUp{
			FollowUpID:       followUp.FollowUpID,
			SessionID:        followUp.SessionID,
			AgentID:          followUp.AgentID,
			CallerAppID:      followUp.CallerAppID,
			SubjectUserID:    followUp.SubjectUserID,
			ThreadID:         followUp.ThreadID,
			Instruction:      followUp.Instruction,
			ScheduledFor:     followUp.ScheduledFor.UTC().Format(time.RFC3339Nano),
			ChainID:          followUp.ChainID,
			FollowUpDepth:    followUp.FollowUpDepth,
			MaxFollowUpTurns: followUp.MaxFollowUpTurns,
			SourceTurnID:     followUp.SourceTurnID,
			SourceActionID:   followUp.SourceActionID,
		})
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
		var currentVersionRaw string
		err := tx.QueryRow(`SELECT value FROM runtime_agent_meta WHERE key = ?`, runtimeAgentMetaPublicChatSurfaceVersionKey).Scan(&currentVersionRaw)
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
			`INSERT INTO runtime_agent_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
			runtimeAgentMetaPublicChatSurfaceVersionKey,
			encodeSequenceValue(snapshot.Version),
		); err != nil {
			return err
		}
		if _, err := tx.Exec(
			`INSERT INTO runtime_agent_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
			runtimeAgentMetaPublicChatSurfaceStateKey,
			string(raw),
		); err != nil {
			return err
		}
		return nil
	})
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
	var persisted persistedPublicChatSurfaceState
	if err := json.Unmarshal([]byte(raw), &persisted); err != nil {
		return fmt.Errorf("parse public chat surface state: %w", err)
	}
	if strings.TrimSpace(versionRaw) != "" {
		if version, err := decodeSequenceValue(versionRaw); err == nil && version > persisted.Version {
			persisted.Version = version
		}
	}
	unmarshal := protojson.UnmarshalOptions{DiscardUnknown: false}
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	s.chatSurfaceVersion = persisted.Version
	for key := range s.chatSessions {
		delete(s.chatSessions, key)
	}
	for key := range s.chatTurns {
		delete(s.chatTurns, key)
	}
	for key := range s.chatFollowUps {
		delete(s.chatFollowUps, key)
	}
	for key := range s.chatActiveByAgent {
		delete(s.chatActiveByAgent, key)
	}
	for _, item := range persisted.Sessions {
		transcript := make([]*runtimev1.ChatMessage, 0, len(item.Transcript))
		for _, rawMessage := range item.Transcript {
			message := &runtimev1.ChatMessage{}
			if err := unmarshal.Unmarshal(rawMessage, message); err != nil {
				return fmt.Errorf("parse public chat transcript message: %w", err)
			}
			transcript = append(transcript, message)
		}
		s.chatSessions[item.SessionID] = &publicChatSessionState{
			SessionID:          item.SessionID,
			AgentID:            item.AgentID,
			CallerAppID:        item.CallerAppID,
			SubjectUserID:      item.SubjectUserID,
			ThreadID:           item.ThreadID,
			Binding:            item.Binding,
			ActiveTurnID:       "",
			SystemPrompt:       item.SystemPrompt,
			MaxTokens:          item.MaxTokens,
			Reasoning:          clonePublicChatReasoningConfig(item.Reasoning),
			Transcript:         transcript,
			ActiveTurnSnapshot: fromPersistedPublicChatTurnSnapshot(item.ActiveTurnSnapshot),
			LastTurnSnapshot:   fromPersistedPublicChatTurnSnapshot(item.LastTurnSnapshot),
			PendingFollowUpID:  item.PendingFollowUpID,
		}
		if restored := s.chatSessions[item.SessionID]; restored != nil && restored.ActiveTurnSnapshot != nil {
			recovered := clonePublicChatTurnProjectionState(restored.ActiveTurnSnapshot)
			recovered.Status = publicChatTurnStatusInterrupted
			recovered.ReasonCode = runtimev1.ReasonCode_AI_STREAM_BROKEN
			recovered.Message = "public chat turn interrupted by runtime restart"
			recovered.UpdatedAt = time.Now().UTC()
			restored.LastTurnSnapshot = recovered
			restored.ActiveTurnSnapshot = nil
			restored.ActiveTurnID = ""
		}
	}
	for _, item := range persisted.FollowUps {
		scheduledFor, err := time.Parse(time.RFC3339Nano, item.ScheduledFor)
		if err != nil {
			return fmt.Errorf("parse public chat follow-up scheduled time: %w", err)
		}
		s.chatFollowUps[item.FollowUpID] = &publicChatFollowUpState{
			FollowUpID:       item.FollowUpID,
			SessionID:        item.SessionID,
			AgentID:          item.AgentID,
			CallerAppID:      item.CallerAppID,
			SubjectUserID:    item.SubjectUserID,
			ThreadID:         item.ThreadID,
			Instruction:      item.Instruction,
			ScheduledFor:     scheduledFor.UTC(),
			ChainID:          item.ChainID,
			FollowUpDepth:    item.FollowUpDepth,
			MaxFollowUpTurns: item.MaxFollowUpTurns,
			SourceTurnID:     item.SourceTurnID,
			SourceActionID:   item.SourceActionID,
		}
	}
	return nil
}

func toPersistedPublicChatTurnSnapshot(input *publicChatTurnProjectionState) *persistedPublicChatTurnSnapshot {
	if input == nil {
		return nil
	}
	return &persistedPublicChatTurnSnapshot{
		TurnID:            input.TurnID,
		Status:            input.Status,
		TraceID:           input.TraceID,
		StreamSequence:    input.StreamSequence,
		Origin:            input.Origin,
		ChainID:           input.ChainID,
		FollowUpDepth:     input.FollowUpDepth,
		MaxFollowUpTurns:  input.MaxFollowUpTurns,
		SourceTurnID:      input.SourceTurnID,
		SourceActionID:    input.SourceActionID,
		ModelResolved:     input.ModelResolved,
		RouteDecision:     input.RouteDecision,
		OutputObserved:    input.OutputObserved,
		ReasoningObserved: input.ReasoningObserved,
		MessageID:         input.MessageID,
		AssistantText:     input.AssistantText,
		Structured:        clonePublicChatStructuredEnvelope(input.Structured),
		AssistantMemory:   clonePublicChatAssistantMemoryOutcome(input.AssistantMemory),
		Sidecar:           clonePublicChatSidecarOutcome(input.Sidecar),
		FollowUp:          clonePublicChatFollowUpOutcome(input.FollowUp),
		FinishReason:      input.FinishReason,
		StreamSimulated:   input.StreamSimulated,
		ReasonCode:        input.ReasonCode,
		ActionHint:        input.ActionHint,
		Message:           input.Message,
		UpdatedAt:         input.UpdatedAt.UTC().Format(time.RFC3339Nano),
	}
}

func fromPersistedPublicChatTurnSnapshot(input *persistedPublicChatTurnSnapshot) *publicChatTurnProjectionState {
	if input == nil {
		return nil
	}
	updatedAt := time.Time{}
	if strings.TrimSpace(input.UpdatedAt) != "" {
		if parsed, err := time.Parse(time.RFC3339Nano, input.UpdatedAt); err == nil {
			updatedAt = parsed.UTC()
		}
	}
	return &publicChatTurnProjectionState{
		TurnID:            input.TurnID,
		Status:            input.Status,
		TraceID:           input.TraceID,
		StreamSequence:    input.StreamSequence,
		Origin:            input.Origin,
		ChainID:           input.ChainID,
		FollowUpDepth:     input.FollowUpDepth,
		MaxFollowUpTurns:  input.MaxFollowUpTurns,
		SourceTurnID:      input.SourceTurnID,
		SourceActionID:    input.SourceActionID,
		ModelResolved:     input.ModelResolved,
		RouteDecision:     input.RouteDecision,
		OutputObserved:    input.OutputObserved,
		ReasoningObserved: input.ReasoningObserved,
		MessageID:         input.MessageID,
		AssistantText:     input.AssistantText,
		Structured:        clonePublicChatStructuredEnvelope(input.Structured),
		AssistantMemory:   clonePublicChatAssistantMemoryOutcome(input.AssistantMemory),
		Sidecar:           clonePublicChatSidecarOutcome(input.Sidecar),
		FollowUp:          clonePublicChatFollowUpOutcome(input.FollowUp),
		FinishReason:      input.FinishReason,
		StreamSimulated:   input.StreamSimulated,
		ReasonCode:        input.ReasonCode,
		ActionHint:        input.ActionHint,
		Message:           input.Message,
		UpdatedAt:         updatedAt,
	}
}

package runtimeagent

import (
	"fmt"
	"strings"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const (
	publicChatTimelineChannelText    = "text"
	publicChatTimelineChannelVoice   = "voice"
	publicChatTimelineChannelAvatar  = "avatar"
	publicChatTimelineChannelState   = "state"
	publicChatTimelineChannelLipsync = "lipsync"
)

func publicChatTimelineChannelForTurnEvent(messageType string) string {
	switch strings.TrimSpace(messageType) {
	case publicChatTurnTextDeltaType,
		publicChatTurnReasoningDeltaType,
		publicChatTurnStructuredType,
		publicChatTurnMessageCommittedType:
		return publicChatTimelineChannelText
	case publicChatTurnAcceptedType,
		publicChatTurnStartedType,
		publicChatTurnPostTurnType,
		publicChatTurnCompletedType,
		publicChatTurnFailedType,
		publicChatTurnInterruptedType,
		publicChatTurnInterruptAckType:
		return publicChatTimelineChannelState
	default:
		return ""
	}
}

func publicChatValidateTimelineChannel(channel string) error {
	switch strings.TrimSpace(channel) {
	case publicChatTimelineChannelText,
		publicChatTimelineChannelVoice,
		publicChatTimelineChannelAvatar,
		publicChatTimelineChannelState,
		publicChatTimelineChannelLipsync:
		return nil
	default:
		return status.Error(codes.InvalidArgument, "runtime.agent.timeline channel invalid")
	}
}

func publicChatBuildTimelineEnvelope(turn publicChatTurnState, messageType string, sequence uint64, observedAt time.Time) (map[string]any, error) {
	channel := publicChatTimelineChannelForTurnEvent(messageType)
	if channel == "" {
		return nil, status.Error(codes.InvalidArgument, "runtime.agent.timeline event type invalid")
	}
	return publicChatBuildTimelineEnvelopeForChannel(turn, channel, sequence, observedAt)
}

func publicChatBuildTimelineEnvelopeForChannel(turn publicChatTurnState, channel string, sequence uint64, observedAt time.Time) (map[string]any, error) {
	if err := publicChatValidateTimelineChannel(channel); err != nil {
		return nil, err
	}
	if strings.TrimSpace(turn.TurnID) == "" || strings.TrimSpace(turn.StreamID) == "" {
		return nil, status.Error(codes.FailedPrecondition, "runtime.agent.timeline requires turn_id and stream_id")
	}
	if turn.TimelineStartedAt.IsZero() {
		return nil, status.Error(codes.FailedPrecondition, "runtime.agent.timeline timebase unavailable")
	}
	if sequence == 0 {
		return nil, status.Error(codes.InvalidArgument, "runtime.agent.timeline sequence must be positive")
	}
	if observedAt.IsZero() {
		observedAt = time.Now()
	}
	offset := observedAt.Sub(turn.TimelineStartedAt).Milliseconds()
	if offset < 0 {
		return nil, status.Error(codes.InvalidArgument, "runtime.agent.timeline offset_ms must be non-negative")
	}
	return map[string]any{
		"turn_id":             strings.TrimSpace(turn.TurnID),
		"stream_id":           strings.TrimSpace(turn.StreamID),
		"channel":             strings.TrimSpace(channel),
		"offset_ms":           offset,
		"sequence":            int64(sequence),
		"started_at_wall":     turn.TimelineStartedAt.UTC().Format(time.RFC3339Nano),
		"observed_at_wall":    observedAt.UTC().Format(time.RFC3339Nano),
		"timebase_owner":      "runtime",
		"projection_rule_id":  "K-AGCORE-051",
		"clock_basis":         "monotonic_with_wall_anchor",
		"provider_neutral":    true,
		"app_local_authority": false,
	}, nil
}

func publicChatValidateTimelineSequence(previousChannel string, previousSequence uint64, currentChannel string, currentSequence uint64) error {
	if err := publicChatValidateTimelineChannel(currentChannel); err != nil {
		return err
	}
	if currentSequence == 0 {
		return status.Error(codes.InvalidArgument, "runtime.agent.timeline sequence must be positive")
	}
	if strings.TrimSpace(previousChannel) == strings.TrimSpace(currentChannel) && previousSequence >= currentSequence {
		return fmt.Errorf("runtime.agent.timeline sequence must be monotonic for %s", strings.TrimSpace(currentChannel))
	}
	return nil
}

func (s *Service) publicChatTurnTimelineEnvelope(turnID string, messageType string, sequence uint64, observedAt time.Time) (map[string]any, error) {
	s.chatSurfaceMu.Lock()
	turn := s.chatTurns[strings.TrimSpace(turnID)]
	var snapshot publicChatTurnState
	if turn != nil {
		snapshot = *turn
	}
	s.chatSurfaceMu.Unlock()
	if strings.TrimSpace(snapshot.TurnID) == "" {
		return nil, status.Error(codes.FailedPrecondition, "runtime.agent.timeline turn not found")
	}
	return publicChatBuildTimelineEnvelope(snapshot, messageType, sequence, observedAt)
}

func (s *Service) publicChatTurnTimelineEnvelopeForChannel(turnID string, channel string, sequence uint64, observedAt time.Time) (map[string]any, error) {
	s.chatSurfaceMu.Lock()
	turn := s.chatTurns[strings.TrimSpace(turnID)]
	var snapshot publicChatTurnState
	if turn != nil {
		snapshot = *turn
	}
	s.chatSurfaceMu.Unlock()
	if strings.TrimSpace(snapshot.TurnID) == "" {
		return nil, status.Error(codes.FailedPrecondition, "runtime.agent.timeline turn not found")
	}
	return publicChatBuildTimelineEnvelopeForChannel(snapshot, channel, sequence, observedAt)
}

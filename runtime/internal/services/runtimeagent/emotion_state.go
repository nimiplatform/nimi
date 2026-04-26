package runtimeagent

import (
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const neutralCurrentEmotion = "neutral"

var admittedCurrentEmotions = map[string]struct{}{
	"neutral":   {},
	"joy":       {},
	"focus":     {},
	"calm":      {},
	"playful":   {},
	"concerned": {},
	"surprised": {},
}

var admittedEmotionSources = map[string]struct{}{
	"chat_status_cue": {},
	"direct_api":      {},
	"runtime":         {},
	"sidecar":         {},
	"decay":           {},
	"clear":           {},
}

func normalizeCurrentEmotion(value string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", fmt.Errorf("runtime.agent.state.emotion_changed current_emotion is required")
	}
	if _, ok := admittedCurrentEmotions[trimmed]; !ok {
		return "", fmt.Errorf("runtime.agent.state.emotion_changed current_emotion is not admitted: %s", trimmed)
	}
	return trimmed, nil
}

func normalizeEmotionSource(source string) (string, error) {
	trimmed := strings.TrimSpace(source)
	if trimmed == "" {
		return "", fmt.Errorf("runtime.agent.state.emotion_changed source is required")
	}
	if _, ok := admittedEmotionSources[trimmed]; !ok {
		return "", fmt.Errorf("runtime.agent.state.emotion_changed source is not admitted: %s", trimmed)
	}
	return trimmed, nil
}

func publicChatStatusCueMoodAdmitted(value string) bool {
	_, ok := admittedCurrentEmotions[strings.TrimSpace(value)]
	return ok
}

// applyCurrentEmotionTransition is the single Runtime-owned mutation helper for
// transient current_emotion. It replaces the previous value only after value and
// source validation, and emits emotion_changed only for real changes.
func (s *Service) applyCurrentEmotionTransition(entry *agentEntry, current string, source string, origin stateEventOrigin, observedAt time.Time) (*runtimev1.AgentEvent, error) {
	if s == nil || entry == nil || entry.Agent == nil || entry.State == nil {
		return nil, nil
	}
	nextEmotion, err := normalizeCurrentEmotion(current)
	if err != nil {
		return nil, err
	}
	emotionSource, err := normalizeEmotionSource(source)
	if err != nil {
		return nil, err
	}
	previousEmotion := strings.TrimSpace(entry.State.GetCurrentEmotion())
	if previousEmotion == nextEmotion {
		return nil, nil
	}
	if observedAt.IsZero() {
		observedAt = time.Now().UTC()
	}
	entry.State.CurrentEmotion = nextEmotion
	entry.State.UpdatedAt = timestamppb.New(observedAt.UTC())
	return s.stateEmotionChangedEvent(
		entry.Agent.GetAgentId(),
		nextEmotion,
		previousEmotion,
		emotionSource,
		origin,
		observedAt,
	), nil
}

func (s *Service) clearCurrentEmotion(entry *agentEntry, origin stateEventOrigin, observedAt time.Time) (*runtimev1.AgentEvent, error) {
	return s.applyCurrentEmotionTransition(entry, neutralCurrentEmotion, "clear", origin, observedAt)
}

func (s *Service) decayCurrentEmotion(entry *agentEntry, expectedCurrent string, origin stateEventOrigin, observedAt time.Time) (*runtimev1.AgentEvent, error) {
	expected, err := normalizeCurrentEmotion(expectedCurrent)
	if err != nil {
		return nil, err
	}
	if entry == nil || entry.State == nil || strings.TrimSpace(entry.State.GetCurrentEmotion()) != expected {
		return nil, nil
	}
	if expected == neutralCurrentEmotion {
		return nil, nil
	}
	return s.applyCurrentEmotionTransition(entry, neutralCurrentEmotion, "decay", origin, observedAt)
}

package runtimeagent

import (
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
)

func (s *Service) SetRuntimeArtifactStore(store runtimeartifact.Store) {
	if s == nil {
		return
	}
	s.runtimeArtifacts = store
}

func (s *Service) putGeneratedVoiceArtifactBytes(artifactID string, payload []byte, mimeType string, input voiceLipsyncSynthesisInput, session publicChatAnchorState, retentionScope string) error {
	if s == nil || s.runtimeArtifacts == nil {
		return fmt.Errorf("runtime artifact store is required")
	}
	artifactID = strings.TrimSpace(artifactID)
	mimeType = strings.TrimSpace(mimeType)
	if artifactID == "" {
		return fmt.Errorf("runtime voice audio artifact id is required")
	}
	if !isPlayableAudioMimeType(mimeType) {
		return fmt.Errorf("runtime voice audio artifact mime type must be audio/*")
	}
	if len(payload) == 0 {
		return fmt.Errorf("runtime voice audio artifact bytes are required")
	}
	if len(payload) > runtimeartifact.MaxInlineBytes {
		return fmt.Errorf("runtime voice audio artifact %s exceeds inline replay cap", artifactID)
	}
	scope := strings.TrimSpace(retentionScope)
	if scope == "" {
		scope = "generated_agent_voice"
	}
	if err := s.runtimeArtifacts.Put(artifactID, runtimeartifact.ArtifactRecord{
		Bytes:     payload,
		MimeType:  mimeType,
		SizeBytes: int64(len(payload)),
		GeneratedVoice: &runtimeartifact.GeneratedVoiceArtifactMetadata{
			AgentID:              firstNonEmpty(strings.TrimSpace(session.AgentID), strings.TrimSpace(input.AgentID)),
			ConversationAnchorID: strings.TrimSpace(session.ConversationAnchorID),
			TurnID:               strings.TrimSpace(input.TurnID),
			MessageID:            strings.TrimSpace(input.MessageID),
			VoiceReference:       strings.TrimSpace(input.DefaultVoiceReference),
			SpeechModelID:        strings.TrimSpace(input.SpeechModelID),
			RoutePolicy:          voiceArtifactRoutePolicy(input.SpeechRoutePolicy),
			RetentionScope:       scope,
		},
	}); err != nil {
		return fmt.Errorf("store runtime voice audio artifact %s: %w", artifactID, err)
	}
	return nil
}

func (s *Service) verifyVoiceAudioArtifact(output voiceLipsyncSynthesisOutput) error {
	if s == nil || s.runtimeArtifacts == nil {
		return fmt.Errorf("runtime artifact store is required")
	}
	artifactID := strings.TrimSpace(output.AudioArtifactID)
	mimeType := strings.TrimSpace(output.AudioMimeType)
	if artifactID == "" {
		return fmt.Errorf("runtime voice audio artifact id is required")
	}
	if !isPlayableAudioMimeType(mimeType) {
		return fmt.Errorf("runtime voice audio artifact mime type must be audio/*")
	}
	record, ok := s.runtimeArtifacts.Get(artifactID)
	if !ok {
		return fmt.Errorf("runtime voice audio artifact %s is not stored", artifactID)
	}
	recordMimeType := strings.TrimSpace(record.MimeType)
	if !isPlayableAudioMimeType(recordMimeType) {
		return fmt.Errorf("runtime voice audio artifact %s stored mime type must be audio/*", artifactID)
	}
	if !strings.EqualFold(recordMimeType, mimeType) {
		return fmt.Errorf("runtime voice audio artifact %s mime type mismatch: event=%s stored=%s", artifactID, mimeType, recordMimeType)
	}
	if len(record.Bytes) == 0 || record.SizeBytes <= 0 {
		return fmt.Errorf("runtime voice audio artifact %s has no audio bytes", artifactID)
	}
	return nil
}

func (s *Service) retainGeneratedVoiceArtifact(input voiceLipsyncSynthesisInput, output voiceLipsyncSynthesisOutput, session publicChatAnchorState) error {
	if s == nil || s.runtimeArtifacts == nil {
		return fmt.Errorf("runtime artifact store is required")
	}
	artifactID := strings.TrimSpace(output.AudioArtifactID)
	if artifactID == "" {
		return fmt.Errorf("runtime voice audio artifact id is required")
	}
	record, ok := s.runtimeArtifacts.Get(artifactID)
	if !ok {
		return fmt.Errorf("runtime voice audio artifact %s is not stored", artifactID)
	}
	speechModelID := strings.TrimSpace(input.SpeechModelID)
	if output.VoiceRouteBinding != nil && strings.TrimSpace(output.VoiceRouteBinding.ModelID) != "" {
		speechModelID = strings.TrimSpace(output.VoiceRouteBinding.ModelID)
	}
	voiceReference := strings.TrimSpace(output.DefaultVoiceReference)
	if voiceReference == "" {
		voiceReference = strings.TrimSpace(input.DefaultVoiceReference)
	}
	record.GeneratedVoice = &runtimeartifact.GeneratedVoiceArtifactMetadata{
		AgentID:              firstNonEmpty(strings.TrimSpace(session.AgentID), strings.TrimSpace(input.AgentID)),
		ConversationAnchorID: strings.TrimSpace(session.ConversationAnchorID),
		TurnID:               strings.TrimSpace(input.TurnID),
		MessageID:            strings.TrimSpace(input.MessageID),
		VoiceReference:       voiceReference,
		SpeechModelID:        speechModelID,
		RoutePolicy:          voiceArtifactRoutePolicy(input.SpeechRoutePolicy),
		RetentionScope:       "generated_agent_voice",
	}
	if err := s.runtimeArtifacts.Put(artifactID, record); err != nil {
		return fmt.Errorf("record generated voice artifact metadata %s: %w", artifactID, err)
	}
	return nil
}

func voiceArtifactRoutePolicy(policy runtimev1.RoutePolicy) string {
	switch policy {
	case runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL:
		return "local"
	case runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD:
		return "cloud"
	default:
		return ""
	}
}

func isPlayableAudioMimeType(mimeType string) bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(mimeType)), "audio/")
}

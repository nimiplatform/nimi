package runtimeagent

import (
	"fmt"
	"strings"

	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
)

func (s *Service) SetRuntimeArtifactStore(store runtimeartifact.Store) {
	if s == nil {
		return
	}
	s.runtimeArtifacts = store
}

func (s *Service) storeVoiceLipsyncArtifact(output voiceLipsyncSynthesisOutput) error {
	if s == nil || s.runtimeArtifacts == nil {
		return fmt.Errorf("runtime artifact store is required")
	}
	artifactID := strings.TrimSpace(output.AudioArtifactID)
	mimeType := strings.TrimSpace(output.AudioMimeType)
	if artifactID == "" {
		return fmt.Errorf("runtime lipsync artifact id is required")
	}
	if mimeType == "" {
		return fmt.Errorf("runtime lipsync artifact mime type is required")
	}
	payloadText := fmt.Sprintf(
		"nimi.synthetic_lipsync.v1\nartifact_id=%s\nduration_ms=%d\nframe_count=%d\n",
		artifactID,
		output.DurationMs,
		len(output.Frames),
	)
	if voiceRef := strings.TrimSpace(output.DefaultVoiceReference); voiceRef != "" {
		payloadText += fmt.Sprintf("default_voice_reference=%s\n", voiceRef)
	}
	if binding := output.VoiceRouteBinding; binding != nil {
		if value := strings.TrimSpace(binding.Capability); value != "" {
			payloadText += fmt.Sprintf("voice_route_capability=%s\n", value)
		}
		if value := strings.TrimSpace(binding.VoiceReferenceKind); value != "" {
			payloadText += fmt.Sprintf("voice_reference_kind=%s\n", value)
		}
		if value := strings.TrimSpace(binding.VoiceReferenceValue); value != "" {
			payloadText += fmt.Sprintf("voice_reference_value=%s\n", value)
		}
		if value := strings.TrimSpace(binding.ModelID); value != "" {
			payloadText += fmt.Sprintf("voice_model_id=%s\n", value)
		}
		if value := strings.TrimSpace(binding.ModelResolved); value != "" {
			payloadText += fmt.Sprintf("voice_model_resolved=%s\n", value)
		}
		if value := strings.TrimSpace(binding.ScenarioJobID); value != "" {
			payloadText += fmt.Sprintf("voice_scenario_job_id=%s\n", value)
		}
		if value := strings.TrimSpace(binding.AudioArtifactID); value != "" {
			payloadText += fmt.Sprintf("voice_bound_audio_artifact_id=%s\n", value)
		}
		if value := strings.TrimSpace(binding.AudioMimeType); value != "" {
			payloadText += fmt.Sprintf("voice_bound_audio_mime_type=%s\n", value)
		}
		if value := strings.TrimSpace(binding.SynthesisMode); value != "" {
			payloadText += fmt.Sprintf("voice_synthesis_mode=%s\n", value)
		}
		if value := strings.TrimSpace(binding.Status); value != "" {
			payloadText += fmt.Sprintf("voice_route_status=%s\n", value)
		}
		if value := strings.TrimSpace(binding.Reason); value != "" {
			payloadText += fmt.Sprintf("voice_route_reason=%s\n", value)
		}
	}
	payload := []byte(payloadText)
	return s.runtimeArtifacts.Put(artifactID, runtimeartifact.ArtifactRecord{
		Bytes:     payload,
		MimeType:  mimeType,
		SizeBytes: int64(len(payload)),
	})
}

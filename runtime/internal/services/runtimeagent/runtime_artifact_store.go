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
	payload := []byte(fmt.Sprintf(
		"nimi.synthetic_lipsync.v1\nartifact_id=%s\nduration_ms=%d\nframe_count=%d\n",
		artifactID,
		output.DurationMs,
		len(output.Frames),
	))
	return s.runtimeArtifacts.Put(artifactID, runtimeartifact.ArtifactRecord{
		Bytes:     payload,
		MimeType:  mimeType,
		SizeBytes: int64(len(payload)),
	})
}

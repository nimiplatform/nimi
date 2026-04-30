package ai

import (
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
)

func (s *Service) storeRuntimeArtifacts(artifacts []*runtimev1.ScenarioArtifact) error {
	if s == nil || s.runtimeArtifacts == nil {
		return nil
	}
	for _, artifact := range artifacts {
		if artifact == nil {
			continue
		}
		artifactID := strings.TrimSpace(artifact.GetArtifactId())
		if artifactID == "" {
			continue
		}
		payload := artifact.GetBytes()
		sizeBytes := artifact.GetSizeBytes()
		if sizeBytes == 0 {
			sizeBytes = int64(len(payload))
		}
		if len(payload) == 0 && sizeBytes > 0 {
			if s.logger != nil {
				s.logger.Warn(
					"skip runtime artifact byte store for metadata-only artifact",
					"artifact_id", artifactID,
					"size_bytes", sizeBytes,
				)
			}
			continue
		}
		if err := s.runtimeArtifacts.Put(artifactID, runtimeartifact.ArtifactRecord{
			Bytes:     payload,
			MimeType:  artifact.GetMimeType(),
			SizeBytes: sizeBytes,
		}); err != nil {
			return fmt.Errorf("store runtime artifact %s: %w", artifactID, err)
		}
	}
	return nil
}

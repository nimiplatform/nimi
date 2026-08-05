package ai

import (
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func bindRuntimeJobArtifacts(jobID string, head *runtimev1.ScenarioRequestHead, artifacts []*runtimev1.ScenarioArtifact) ([]*runtimev1.ScenarioArtifact, error) {
	jobID = strings.TrimSpace(jobID)
	if jobID == "" || head == nil || strings.TrimSpace(head.GetAppId()) == "" || strings.TrimSpace(head.GetSubjectUserId()) == "" {
		return nil, fmt.Errorf("runtime artifact producer binding is incomplete")
	}
	out := make([]*runtimev1.ScenarioArtifact, 0, len(artifacts))
	for _, artifact := range artifacts {
		if artifact == nil || strings.TrimSpace(artifact.GetArtifactId()) == "" {
			return nil, fmt.Errorf("runtime artifact identity is missing")
		}
		cloned, _ := proto.Clone(artifact).(*runtimev1.ScenarioArtifact)
		if cloned == nil {
			return nil, fmt.Errorf("clone runtime artifact")
		}
		if cloned.Metadata == nil {
			cloned.Metadata = &structpb.Struct{Fields: map[string]*structpb.Value{}}
		}
		if cloned.Metadata.Fields == nil {
			cloned.Metadata.Fields = map[string]*structpb.Value{}
		}
		cloned.Metadata.Fields["producer_job_id"] = structpb.NewStringValue(jobID)
		cloned.Metadata.Fields["artifact_custody"] = structpb.NewStringValue("runtime")
		out = append(out, cloned)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("runtime artifact custody requires at least one artifact")
	}
	return out, nil
}

func (s *Service) storeRuntimeJobArtifacts(jobID string, head *runtimev1.ScenarioRequestHead, artifacts []*runtimev1.ScenarioArtifact) error {
	if s == nil || s.runtimeArtifacts == nil || head == nil {
		return fmt.Errorf("Runtime artifact custody store is unavailable")
	}
	jobID = strings.TrimSpace(jobID)
	owner := &runtimeartifact.ArtifactOwner{
		SubjectUserID: strings.TrimSpace(head.GetSubjectUserId()),
		AppID:         strings.TrimSpace(head.GetAppId()),
	}
	for _, artifact := range artifacts {
		if artifact == nil {
			continue
		}
		artifactID := strings.TrimSpace(artifact.GetArtifactId())
		payload := artifact.GetBytes()
		if artifactID == "" {
			return fmt.Errorf("store Runtime job artifact: artifact id is missing")
		}
		if err := s.runtimeArtifacts.Put(artifactID, runtimeartifact.ArtifactRecord{
			Bytes:         payload,
			MimeType:      artifact.GetMimeType(),
			SizeBytes:     int64(len(payload)),
			ProducerJobID: jobID,
			Owner:         owner,
		}); err != nil {
			return fmt.Errorf("store Runtime job artifact %s: %w", artifactID, err)
		}
	}
	return nil
}

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

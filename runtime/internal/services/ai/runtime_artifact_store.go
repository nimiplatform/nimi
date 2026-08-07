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
	for _, artifact := range artifacts {
		if artifact == nil {
			continue
		}
		if err := s.storeRuntimeJobArtifact(jobID, head, artifact); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) storeRuntimeJobArtifact(jobID string, head *runtimev1.ScenarioRequestHead, artifact *runtimev1.ScenarioArtifact) error {
	if s == nil || s.runtimeArtifacts == nil || head == nil || artifact == nil {
		return fmt.Errorf("Runtime artifact custody store is unavailable")
	}
	jobID = strings.TrimSpace(jobID)
	artifactID := strings.TrimSpace(artifact.GetArtifactId())
	owner := runtimeArtifactOwner(head)
	if jobID == "" || artifactID == "" || owner == nil {
		return fmt.Errorf("store Runtime job artifact: producer binding is incomplete")
	}
	if _, exists := s.runtimeArtifacts.Get(artifactID); exists {
		return fmt.Errorf("store Runtime job artifact %s: artifact id already exists", artifactID)
	}
	payload := artifact.GetBytes()
	if err := s.runtimeArtifacts.Put(artifactID, runtimeartifact.ArtifactRecord{
		Bytes:         payload,
		MimeType:      artifact.GetMimeType(),
		SizeBytes:     int64(len(payload)),
		ProducerJobID: jobID,
		Owner:         owner,
	}); err != nil {
		return fmt.Errorf("store Runtime job artifact %s: %w", artifactID, err)
	}
	return nil
}

func (s *Service) storeAndAttachRuntimeJobArtifact(
	jobID string,
	head *runtimev1.ScenarioRequestHead,
	artifact *runtimev1.ScenarioArtifact,
	attach func(*runtimev1.ScenarioArtifact) bool,
) (*runtimev1.ScenarioArtifact, error) {
	bound, err := bindRuntimeJobArtifacts(jobID, head, []*runtimev1.ScenarioArtifact{artifact})
	if err != nil {
		return nil, fmt.Errorf("bind Runtime job artifact: %w", err)
	}
	candidate := bound[0]
	if err := s.storeRuntimeJobArtifact(jobID, head, candidate); err != nil {
		return nil, err
	}
	if attach == nil || !attach(candidate) {
		s.deleteRuntimeArtifactCandidate(candidate.GetArtifactId(), "job artifact attach failed")
		return nil, fmt.Errorf("attach Runtime job artifact %s", candidate.GetArtifactId())
	}
	return candidate, nil
}

func (s *Service) storeRuntimeOwnedArtifacts(head *runtimev1.ScenarioRequestHead, artifacts []*runtimev1.ScenarioArtifact) error {
	if s == nil || s.runtimeArtifacts == nil {
		return nil
	}
	owner := runtimeArtifactOwner(head)
	if owner == nil {
		return fmt.Errorf("store Runtime owned artifact: owner is incomplete")
	}
	for _, artifact := range artifacts {
		if artifact == nil {
			continue
		}
		artifactID := strings.TrimSpace(artifact.GetArtifactId())
		if artifactID == "" {
			return fmt.Errorf("store Runtime owned artifact: artifact id is missing")
		}
		payload := artifact.GetBytes()
		if err := s.runtimeArtifacts.Put(artifactID, runtimeartifact.ArtifactRecord{
			Bytes:     payload,
			MimeType:  artifact.GetMimeType(),
			SizeBytes: int64(len(payload)),
			Owner:     owner,
		}); err != nil {
			return fmt.Errorf("store Runtime owned artifact %s: %w", artifactID, err)
		}
	}
	return nil
}

func runtimeArtifactOwner(head *runtimev1.ScenarioRequestHead) *runtimeartifact.ArtifactOwner {
	if head == nil {
		return nil
	}
	owner := &runtimeartifact.ArtifactOwner{
		SubjectUserID: strings.TrimSpace(head.GetSubjectUserId()),
		AppID:         strings.TrimSpace(head.GetAppId()),
	}
	if owner.SubjectUserID == "" || owner.AppID == "" {
		return nil
	}
	return owner
}

func (s *Service) deleteRuntimeArtifactCandidate(artifactID string, reason string) {
	artifactID = strings.TrimSpace(artifactID)
	if s == nil || s.runtimeArtifacts == nil || artifactID == "" {
		return
	}
	if err := s.runtimeArtifacts.Delete(artifactID); err != nil && s.logger != nil {
		s.logger.Warn("delete Runtime artifact compensation failed", "artifact_id", artifactID, "reason", reason, "error", err)
	}
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

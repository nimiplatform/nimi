package ai

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const maxInlineVideoArtifactResponseBytes = 1 << 20

func sanitizeScenarioArtifactsForResponse(
	job *runtimev1.ScenarioJob,
	artifacts []*runtimev1.ScenarioArtifact,
) []*runtimev1.ScenarioArtifact {
	cloned := cloneScenarioArtifacts(artifacts)
	if job == nil || job.GetScenarioType() != runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE {
		return cloned
	}
	for _, artifact := range cloned {
		if artifact == nil || len(artifact.GetBytes()) == 0 {
			continue
		}
		if shouldStripInlineVideoArtifactBytes(artifact) {
			artifact.Bytes = nil
		}
	}
	return cloned
}

func sanitizeScenarioJobForResponse(job *runtimev1.ScenarioJob) *runtimev1.ScenarioJob {
	cloned := cloneScenarioJob(job)
	if cloned == nil {
		return nil
	}
	cloned.Artifacts = sanitizeScenarioArtifactsForResponse(cloned, cloned.GetArtifacts())
	return cloned
}

func sanitizeScenarioJobEventForResponse(event *runtimev1.ScenarioJobEvent) *runtimev1.ScenarioJobEvent {
	cloned := cloneScenarioJobEvent(event)
	if cloned == nil || cloned.GetJob() == nil {
		return cloned
	}
	cloned.Job = sanitizeScenarioJobForResponse(cloned.GetJob())
	return cloned
}

func shouldStripInlineVideoArtifactBytes(artifact *runtimev1.ScenarioArtifact) bool {
	if artifact == nil {
		return false
	}
	mimeType := strings.ToLower(strings.TrimSpace(artifact.GetMimeType()))
	if mimeType != "" && !strings.HasPrefix(mimeType, "video/") {
		return false
	}
	if strings.TrimSpace(artifact.GetUri()) != "" {
		return true
	}
	return len(artifact.GetBytes()) > maxInlineVideoArtifactResponseBytes
}

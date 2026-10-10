package ai

import (
	"fmt"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"

	"google.golang.org/protobuf/proto"
)

func cloneAudioSpeakerEmbedResult(result *runtimev1.AudioSpeakerEmbedResult) *runtimev1.AudioSpeakerEmbedResult {
	if result == nil {
		return nil
	}
	return proto.Clone(result).(*runtimev1.AudioSpeakerEmbedResult)
}

func validateScenarioJobSpeakerEmbeddingResult(job *runtimev1.ScenarioJob, assembly *localResolvedAssembly) error {
	completed := job.GetScenarioType() == runtimev1.ScenarioType_SCENARIO_TYPE_AUDIO_SPEAKER_EMBED && job.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED
	if !completed {
		if job.GetSpeakerEmbedding() != nil {
			return fmt.Errorf("speaker representation is inconsistent with Job state")
		}
		return nil
	}
	if assembly == nil || len(job.GetArtifacts()) != 0 {
		return fmt.Errorf("speaker Job has no immutable sole typed result")
	}
	space, err := speakerEmbeddingSpaceID(assembly)
	if err != nil {
		return err
	}
	if job.GetSpeakerEmbedding().GetSpaceId() != space {
		return fmt.Errorf("speaker representation space differs from captured semantics")
	}
	return localexecution.ValidateSpeakerEmbeddingResult(job.GetSpeakerEmbedding(), assembly.EmbeddingDimension, true)
}

func (s *Service) completeSpeakerEmbeddingScenarioJob(jobID string, result *runtimev1.AudioSpeakerEmbedResult) error {
	assembly, ok := s.scenarioJobs.resolvedAssembly(jobID)
	if !ok {
		return fmt.Errorf("speaker Job has no captured assembly")
	}
	space, err := speakerEmbeddingSpaceID(assembly)
	if err != nil {
		return err
	}
	if result.GetSpaceId() != space {
		return fmt.Errorf("speaker representation space changed")
	}
	if err := localexecution.ValidateSpeakerEmbeddingResult(result, assembly.EmbeddingDimension, true); err != nil {
		return err
	}
	for attempt := 1; attempt <= maxScenarioJobTerminalPersistenceAttempts; attempt++ {
		_, _, err = s.transitionScenarioJob(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED, func(job *runtimev1.ScenarioJob) {
			job.SpeakerEmbedding = cloneAudioSpeakerEmbedResult(result)
			job.ProgressPercent = 100
			job.ReasonCode = runtimev1.ReasonCode_ACTION_EXECUTED
			job.ReasonDetail = ""
		})
		if err == nil {
			return nil
		}
		s.logScenarioJobPersistenceFailure("SpeakerEmbedding Job result persistence failed", "job_id", jobID, "attempt", attempt, "error", err)
	}
	if !s.scenarioJobs.hasResultCandidate(jobID) {
		s.scenarioJobs.recordPersistenceIssue(jobID)
	}
	return err
}

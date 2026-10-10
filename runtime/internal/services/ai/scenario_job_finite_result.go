package ai

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// @nimi-authority: rule.nimi.runtime.service-operations.scenario-job-execution-scope
// Reuse the original row's result acquisition plan. RS results have no task
// receipt and no query operation; only their original bodies can be acquired.
func (s *Service) retainFiniteScenarioResult(ctx context.Context, jobID string, head *runtimev1.ScenarioRequestHead, slots []runtimeartifact.JobBodySlot, artifacts []*runtimev1.ScenarioArtifact, usage *runtimev1.UsageStats) error {
	if len(artifacts) != len(slots) {
		return fmt.Errorf("finite response lacks its complete required set")
	}
	store, ok := s.runtimeArtifacts.(runtimeartifact.JobBodyStore)
	if !ok {
		return fmt.Errorf("finite response body owner unavailable")
	}
	result := nimillm.CloneNativeTaskObservation(&nimillm.NativeTaskObservation{Artifacts: artifacts, Usage: usage})
	for i, artifact := range result.Artifacts {
		if artifact == nil || artifact.GetMimeType() == "" || (len(artifact.GetBytes()) == 0 && artifact.GetUri() == "") || (len(artifact.GetBytes()) > 0 && artifact.GetUri() != "") {
			return fmt.Errorf("finite response artifact is invalid")
		}
		artifact.ArtifactId = slots[i].ArtifactID
		if len(artifact.GetBytes()) > 0 {
			if err := store.StageJobBody(ctx, artifact.GetArtifactId(), runtimeartifact.ArtifactRecord{ProducerJobID: jobID, Owner: s.runtimeArtifactOwnerForJob(jobID, head), MimeType: artifact.GetMimeType(), SizeBytes: int64(len(artifact.GetBytes())), ContentSHA256: scenarioArtifactDigest(artifact)}, io.NopCloser(bytes.NewReader(artifact.GetBytes()))); err != nil {
				return err
			}
			metadata, complete := store.JobBodyStat(jobID, artifact.GetArtifactId())
			if !complete {
				return fmt.Errorf("finite inline body was not retained")
			}
			projectCommittedArtifactMetadata(artifact, metadata)
		}
	}
	return s.scenarioJobs.withJobWorkAuthority(jobID, func() error {
		s.scenarioJobs.mu.Lock()
		defer s.scenarioJobs.mu.Unlock()
		r := s.scenarioJobs.jobs[jobID]
		if r == nil || isTerminalScenarioJobStatus(r.job.GetStatus()) || r.nativeReceipt != nil || r.nativeResult != nil {
			return fmt.Errorf("finite response ownership is closed")
		}
		previousJob, previousUpdated, previousDispatch := cloneScenarioJob(r.job), r.updatedAt, r.dispatchPossible
		r.nativeResult = result
		r.dispatchPossible = proto.Bool(true)
		r.job.SubmissionOutcome = runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_ACCEPTED
		r.updatedAt = time.Now().UTC()
		r.job.UpdatedAt = timestamppb.New(r.updatedAt)
		if err := s.scenarioJobs.persistDurableJobsLocked(scenarioJobPersistenceAttempt{Operation: scenarioJobPersistTransition, JobID: jobID, Status: r.job.GetStatus()}); err != nil {
			r.nativeResult = nil
			r.job, r.updatedAt, r.dispatchPossible = previousJob, previousUpdated, previousDispatch
			return err
		}
		return nil
	})
}

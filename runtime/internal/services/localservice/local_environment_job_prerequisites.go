package localservice

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"
)

const defaultLocalEnvironmentPrerequisiteWaitTimeout = 45 * time.Minute

const localEnvironmentPrerequisiteWaitPoll = 25 * time.Millisecond

// SetLocalEnvironmentPrerequisiteWaitTimeout overrides the bounded prerequisite
// wait. It exists so tests can assert the wait-then-fail-closed behaviour for a
// genuinely absent prerequisite without a multi-minute pause.
func (s *Service) SetLocalEnvironmentPrerequisiteWaitTimeout(d time.Duration) {
	if s == nil || d <= 0 {
		return
	}
	s.mu.Lock()
	s.localEnvironmentPrerequisiteWaitTimeout = d
	s.mu.Unlock()
}

func (s *Service) prerequisiteWaitTimeout() time.Duration {
	s.mu.RLock()
	d := s.localEnvironmentPrerequisiteWaitTimeout
	s.mu.RUnlock()
	if d <= 0 {
		return defaultLocalEnvironmentPrerequisiteWaitTimeout
	}
	return d
}

// waitForSelectedSourceForFamilyAndConsumer blocks until the prerequisite
// family's selected-source record both exists and still verifies for the
// consumer (repair state clear, evidence complete, local artifacts present),
// the job ctx is cancelled, or the bounded wait elapses. A concurrent unordered
// Start from the desktop therefore converges correctly: the dependent executor
// parks here while the prerequisite job's own background goroutine drives it to
// ready_managed, but stale / repair-required records are never consumed as
// readiness.
func (s *Service) waitForSelectedSourceForFamilyAndConsumer(ctx context.Context, family string, consumer string) (localEnvironmentSelectedSourceRecordState, bool) {
	record, ok, _ := s.waitForSelectedSourceForFamilyAndConsumerDetail(ctx, family, consumer)
	return record, ok
}

func (s *Service) waitForSelectedSourceForFamilyAndConsumerDetail(ctx context.Context, family string, consumer string) (localEnvironmentSelectedSourceRecordState, bool, string) {
	if record, ok, detail := s.readySelectedSourceForFamilyAndConsumer(family, consumer); ok {
		return record, true, detail
	} else {
		if job, jobOK := s.latestLocalEnvironmentDependencyJobForFamilyAndConsumer(family, consumer); jobOK &&
			localEnvironmentDependencyJobBlocksPrerequisiteWait(job.State) {
			return localEnvironmentSelectedSourceRecordState{}, false, localEnvironmentPrerequisiteFailureDetail(family, consumer, job, detail)
		}
	}
	deadline := time.NewTimer(s.prerequisiteWaitTimeout())
	defer deadline.Stop()
	ticker := time.NewTicker(localEnvironmentPrerequisiteWaitPoll)
	defer ticker.Stop()
	lastDetail := "no selected source record for consumer"
	for {
		select {
		case <-ctx.Done():
			if err := ctx.Err(); err != nil {
				return localEnvironmentSelectedSourceRecordState{}, false, err.Error()
			}
			return localEnvironmentSelectedSourceRecordState{}, false, "prerequisite wait cancelled"
		case <-deadline.C:
			return localEnvironmentSelectedSourceRecordState{}, false, lastDetail
		case <-ticker.C:
			if record, ok, detail := s.readySelectedSourceForFamilyAndConsumer(family, consumer); ok {
				return record, true, detail
			} else {
				lastDetail = detail
			}
			if job, ok := s.latestLocalEnvironmentDependencyJobForFamilyAndConsumer(family, consumer); ok &&
				localEnvironmentDependencyJobBlocksPrerequisiteWait(job.State) {
				return localEnvironmentSelectedSourceRecordState{}, false, localEnvironmentPrerequisiteFailureDetail(family, consumer, job, lastDetail)
			}
		}
	}
}

func (s *Service) latestBlockingLocalEnvironmentDependencyJobForFamilyAndConsumer(family string, consumer string) (localEnvironmentDependencyJobState, bool) {
	job, ok := s.latestLocalEnvironmentDependencyJobForFamilyAndConsumer(family, consumer)
	if !ok || !localEnvironmentDependencyJobBlocksPrerequisiteWait(job.State) {
		return localEnvironmentDependencyJobState{}, false
	}
	return job, true
}

func (s *Service) latestLocalEnvironmentDependencyJobForFamilyAndConsumer(family string, consumer string) (localEnvironmentDependencyJobState, bool) {
	trimmedFamily := strings.TrimSpace(family)
	trimmedConsumer := strings.TrimSpace(consumer)
	if trimmedFamily == "" {
		return localEnvironmentDependencyJobState{}, false
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	var latest localEnvironmentDependencyJobState
	for _, job := range s.localEnvironmentDependencyJobs {
		if strings.TrimSpace(job.DependencyFamily) != trimmedFamily {
			continue
		}
		if trimmedConsumer != "" && !localEnvironmentDependencyJobMatchesConsumer(job, trimmedConsumer) {
			continue
		}
		if latest.JobID == "" || localEnvironmentDependencyJobNewer(job, latest) {
			latest = job
		}
	}
	return latest, latest.JobID != ""
}

func localEnvironmentDependencyJobBlocksPrerequisiteWait(state string) bool {
	switch strings.TrimSpace(state) {
	case localEnvironmentStateFailed, localEnvironmentStateCancelled, localEnvironmentStateUnsupported, localEnvironmentStateRepairRequired:
		return true
	default:
		return false
	}
}

func localEnvironmentDependencyJobMatchesConsumer(job localEnvironmentDependencyJobState, consumer string) bool {
	trimmedConsumer := strings.TrimSpace(consumer)
	if trimmedConsumer == "" {
		return true
	}
	if strings.TrimSpace(job.ConsumerScope) == trimmedConsumer {
		return true
	}
	if localEnvironmentConsumerScopeFromKey(job.EnvironmentKey) == trimmedConsumer {
		return true
	}
	return pythonMaterializerConsumerForDependency(job.DependencyID) == trimmedConsumer
}

func localEnvironmentDependencyJobNewer(candidate localEnvironmentDependencyJobState, current localEnvironmentDependencyJobState) bool {
	candidateUpdated := strings.TrimSpace(candidate.UpdatedAt)
	currentUpdated := strings.TrimSpace(current.UpdatedAt)
	if candidateUpdated != currentUpdated {
		return candidateUpdated > currentUpdated
	}
	candidateCreated := strings.TrimSpace(candidate.CreatedAt)
	currentCreated := strings.TrimSpace(current.CreatedAt)
	if candidateCreated != currentCreated {
		return candidateCreated > currentCreated
	}
	return strings.TrimSpace(candidate.JobID) > strings.TrimSpace(current.JobID)
}

func localEnvironmentPrerequisiteFailureDetail(family string, consumer string, job localEnvironmentDependencyJobState, fallback string) string {
	detail := strings.TrimSpace(job.FailureDetail)
	if detail == "" {
		detail = strings.TrimSpace(fallback)
	}
	if detail == "" {
		detail = "no selected source record for consumer"
	}
	jobID := strings.TrimSpace(job.JobID)
	if jobID == "" {
		jobID = "unknown"
	}
	consumerLabel := strings.TrimSpace(consumer)
	if consumerLabel == "" {
		consumerLabel = "unspecified"
	}
	return fmt.Sprintf("prerequisite dependency %s/%s for consumer %s is %s (job=%s): %s",
		strings.TrimSpace(family),
		strings.TrimSpace(job.DependencyID),
		consumerLabel,
		strings.TrimSpace(job.State),
		jobID,
		detail,
	)
}

func failedPrerequisiteDependencyResult(detail string) localEnvironmentDependencyJobResult {
	trimmed := strings.TrimSpace(detail)
	if trimmed == "" {
		trimmed = "required local environment prerequisite is not ready"
	}
	return localEnvironmentDependencyJobResult{
		State:           localEnvironmentStateFailed,
		SourceKind:      localEnvironmentSourceManaged,
		AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_PREREQUISITE_FAILED",
		FailureDetail:   trimmed,
	}
}

func (s *Service) readySelectedSourceForFamilyAndConsumer(family string, consumer string) (localEnvironmentSelectedSourceRecordState, bool, string) {
	candidates := s.selectedSourceCandidatesForFamilyAndConsumer(family, consumer)
	if len(candidates) == 0 {
		return localEnvironmentSelectedSourceRecordState{}, false, "no selected source record for consumer"
	}
	lastDetail := "no selected source record satisfies readiness"
	for _, record := range candidates {
		if isLocalEnvironmentRepairActive(record.RepairState) {
			lastDetail = "selected source record is under repair"
			continue
		}
		if err := validateLocalEnvironmentSelectedSourceRecord(record); err != nil {
			lastDetail = "selected source record fails verification: " + err.Error()
			continue
		}
		if err := validateLocalEnvironmentSelectedSourceLocalArtifacts(record); err != nil {
			lastDetail = "selected source record fails local artifact verification: " + err.Error()
			continue
		}
		return record, true, ""
	}
	return localEnvironmentSelectedSourceRecordState{}, false, lastDetail
}

func (s *Service) selectedSourceCandidatesForFamilyAndConsumer(family string, consumer string) []localEnvironmentSelectedSourceRecordState {
	trimmedFamily := strings.TrimSpace(family)
	trimmedConsumer := strings.TrimSpace(consumer)
	s.mu.RLock()
	candidates := make([]localEnvironmentSelectedSourceRecordState, 0)
	for _, record := range s.localEnvironmentSelectedSources {
		if record.DependencyFamily != trimmedFamily {
			continue
		}
		if trimmedConsumer != "" && !stringSliceContains(record.SelectedConsumers, trimmedConsumer) {
			continue
		}
		candidates = append(candidates, record)
	}
	s.mu.RUnlock()
	sort.SliceStable(candidates, func(left, right int) bool {
		leftVerified := strings.TrimSpace(candidates[left].LastVerifiedAt)
		rightVerified := strings.TrimSpace(candidates[right].LastVerifiedAt)
		if leftVerified != rightVerified {
			return leftVerified > rightVerified
		}
		leftSelected := strings.TrimSpace(candidates[left].SelectedAt)
		rightSelected := strings.TrimSpace(candidates[right].SelectedAt)
		if leftSelected != rightSelected {
			return leftSelected > rightSelected
		}
		return strings.TrimSpace(candidates[left].RecordID) > strings.TrimSpace(candidates[right].RecordID)
	})
	return candidates
}

// failOrphanedLocalEnvironmentDependencyJobsLocked is the crash-recovery seam.
// On daemon restart restoreState rehydrates persisted jobs but no goroutine is
// driving them, so any job persisted at a non-terminal state would otherwise be
// a permanent orphan. Fail every such job closed (retryable) with an audit
// reason so the desktop projects it as a retryable failure rather than a frozen
// in-progress job. Caller must hold s.mu.
func (s *Service) failOrphanedLocalEnvironmentDependencyJobsLocked() int {
	if len(s.localEnvironmentDependencyJobs) == 0 {
		return 0
	}
	now := nowISO()
	healed := 0
	for jobID, job := range s.localEnvironmentDependencyJobs {
		if localEnvironmentDependencyJobTerminal(job.State) {
			continue
		}
		job.State = localEnvironmentStateFailed
		job.FailureDetail = "LOCAL_ENVIRONMENT_DEPENDENCY_JOB_INTERRUPTED"
		job.Retryable = true
		job.ReasonCode = "LOCAL_ENVIRONMENT_DEPENDENCY_JOB_INTERRUPTED"
		job.RecoveryDisposition = localEnvironmentJobRecoveryAutoRetryTransient
		// A job rehydrated mid-download carries a stale byte-progress
		// projection; the failed terminal state is not transferring, so clear
		// it rather than leaving a frozen %/rate/ETA on a dead job.
		job.BytesReceived = 0
		job.BytesTotal = 0
		job.Percent = 0
		job.SpeedBytesPerSec = 0
		job.EtaSeconds = 0
		job.UpdatedAt = now
		s.localEnvironmentDependencyJobs[jobID] = job
		healed++
	}
	return healed
}

// localEnvironmentJobDownloadProgressSink is a per-job byte-progress callback an

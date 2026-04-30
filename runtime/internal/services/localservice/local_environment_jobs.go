package localservice

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/oklog/ulid/v2"
)

var errLocalEnvironmentJobCancelled = errors.New("local environment dependency job cancelled")

type localEnvironmentDependencyJobState struct {
	JobID                  string `json:"jobId"`
	EnvironmentKey         string `json:"environmentKey"`
	DependencyFamily       string `json:"dependencyFamily"`
	DependencyID           string `json:"dependencyId"`
	State                  string `json:"state"`
	SourceKind             string `json:"sourceKind"`
	CanonicalRoot          string `json:"canonicalRoot,omitempty"`
	SelectedSourceRecordID string `json:"selectedSourceRecordId,omitempty"`
	FailureDetail          string `json:"failureDetail,omitempty"`
	Retryable              bool   `json:"retryable,omitempty"`
	CreatedAt              string `json:"createdAt"`
	UpdatedAt              string `json:"updatedAt"`
}

type localEnvironmentDependencyJobRequest struct {
	EnvironmentKey   string
	DependencyFamily string
	DependencyID     string
	SourceKind       string
}

type localEnvironmentDependencyJobResult struct {
	State                 string
	SourceKind            string
	CanonicalRoot         string
	Version               string
	CompatibilityEvidence []string
	VerifiedArtifacts     []string
	Hashes                map[string]string
	SelectedConsumers     []string
	ActivationEnvDelta    []string
	AuditReasonCode       string
}

type localEnvironmentDependencyJobExecutor func(context.Context, localEnvironmentDependencyJobState) (localEnvironmentDependencyJobResult, error)

func (s *Service) startLocalEnvironmentDependencyJob(ctx context.Context, req localEnvironmentDependencyJobRequest, executor localEnvironmentDependencyJobExecutor) (localEnvironmentDependencyJobState, error) {
	normalized := normalizeLocalEnvironmentDependencyJobRequest(req)
	if normalized.EnvironmentKey == "" || normalized.DependencyFamily == "" || normalized.DependencyID == "" {
		return localEnvironmentDependencyJobState{}, errors.New("local environment dependency job requires environment key, family, and dependency id")
	}

	now := nowISO()
	s.mu.Lock()
	if s.localEnvironmentDependencyJobs == nil {
		s.localEnvironmentDependencyJobs = make(map[string]localEnvironmentDependencyJobState)
	}
	for _, job := range s.localEnvironmentDependencyJobs {
		if job.EnvironmentKey == normalized.EnvironmentKey && !localEnvironmentDependencyJobTerminal(job.State) {
			s.mu.Unlock()
			return job, nil
		}
	}
	job := localEnvironmentDependencyJobState{
		JobID:            "localenv_job_" + strings.ToLower(ulid.Make().String()),
		EnvironmentKey:   normalized.EnvironmentKey,
		DependencyFamily: normalized.DependencyFamily,
		DependencyID:     normalized.DependencyID,
		State:            localEnvironmentStateQueued,
		SourceKind:       normalized.SourceKind,
		Retryable:        true,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	s.localEnvironmentDependencyJobs[job.JobID] = job
	s.persistStateLocked()
	s.mu.Unlock()

	if executor == nil {
		return job, nil
	}
	return s.runLocalEnvironmentDependencyJob(ctx, job.JobID, executor)
}

func (s *Service) runLocalEnvironmentDependencyJob(ctx context.Context, jobID string, executor localEnvironmentDependencyJobExecutor) (localEnvironmentDependencyJobState, error) {
	job, ok := s.transitionLocalEnvironmentDependencyJob(jobID, localEnvironmentStateInstalling, "", true)
	if !ok {
		return localEnvironmentDependencyJobState{}, errors.New("local environment dependency job not found")
	}
	if executor == nil {
		return job, nil
	}

	result, err := executor(ctx, job)
	if err != nil {
		if errors.Is(err, errLocalEnvironmentJobCancelled) || errors.Is(err, context.Canceled) {
			cancelled, _ := s.transitionLocalEnvironmentDependencyJob(jobID, localEnvironmentStateCancelled, err.Error(), true)
			return cancelled, err
		}
		failed, _ := s.transitionLocalEnvironmentDependencyJob(jobID, localEnvironmentStateFailed, err.Error(), true)
		return failed, err
	}

	resultState := strings.TrimSpace(result.State)
	switch resultState {
	case localEnvironmentStateUnsupported:
		unsupported, _ := s.transitionLocalEnvironmentDependencyJob(jobID, localEnvironmentStateUnsupported, strings.TrimSpace(result.AuditReasonCode), false)
		return unsupported, nil
	case localEnvironmentStateRepairRequired:
		repairRequired, _ := s.transitionLocalEnvironmentDependencyJob(jobID, localEnvironmentStateRepairRequired, strings.TrimSpace(result.AuditReasonCode), true)
		return repairRequired, nil
	case localEnvironmentStateFailed:
		failed, _ := s.transitionLocalEnvironmentDependencyJob(jobID, localEnvironmentStateFailed, strings.TrimSpace(result.AuditReasonCode), true)
		return failed, nil
	}

	sourceKind := strings.TrimSpace(result.SourceKind)
	if sourceKind == "" {
		sourceKind = job.SourceKind
	}
	if sourceKind == "" {
		sourceKind = localEnvironmentSourceManaged
	}
	record := s.upsertLocalEnvironmentSelectedSourceRecord(localEnvironmentSelectedSourceRecordState{
		DependencyFamily:      job.DependencyFamily,
		DependencyID:          job.DependencyID,
		EnvironmentKey:        job.EnvironmentKey,
		SourceKind:            sourceKind,
		CanonicalRoot:         strings.TrimSpace(result.CanonicalRoot),
		Version:               strings.TrimSpace(result.Version),
		CompatibilityEvidence: normalizeStringSlice(result.CompatibilityEvidence),
		VerifiedArtifacts:     normalizeStringSlice(result.VerifiedArtifacts),
		Hashes:                cloneStringMap(result.Hashes),
		SelectedConsumers:     normalizeStringSlice(result.SelectedConsumers),
		ActivationEnvDelta:    normalizeStringSlice(result.ActivationEnvDelta),
		AuditReasonCode:       strings.TrimSpace(result.AuditReasonCode),
	})

	readyState := localEnvironmentStateReadyManaged
	if sourceKind == localEnvironmentSourceSystem {
		readyState = localEnvironmentStateReadySystem
	}
	promoted, _ := s.transitionLocalEnvironmentDependencyJob(jobID, readyState, "", false)
	promoted.SelectedSourceRecordID = record.RecordID
	promoted.SourceKind = sourceKind
	promoted.CanonicalRoot = strings.TrimSpace(result.CanonicalRoot)

	s.mu.Lock()
	s.localEnvironmentDependencyJobs[promoted.JobID] = promoted
	s.persistStateLocked()
	s.mu.Unlock()
	return promoted, nil
}

func (s *Service) cancelLocalEnvironmentDependencyJob(jobID string) (localEnvironmentDependencyJobState, bool) {
	return s.transitionLocalEnvironmentDependencyJob(jobID, localEnvironmentStateCancelled, "", true)
}

func (s *Service) markLocalEnvironmentDependencyRepairRequired(environmentKey string, reason string) (localEnvironmentSelectedSourceRecordState, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, ok := s.localEnvironmentSelectedSources[strings.TrimSpace(environmentKey)]
	if !ok {
		return localEnvironmentSelectedSourceRecordState{}, false
	}
	record.RepairState = localEnvironmentRepairRequired
	record.AuditReasonCode = strings.TrimSpace(reason)
	record.LastVerifiedAt = time.Now().UTC().Format(time.RFC3339Nano)
	s.localEnvironmentSelectedSources[record.EnvironmentKey] = record
	s.persistStateLocked()
	return record, true
}

func (s *Service) transitionLocalEnvironmentDependencyJob(jobID string, state string, detail string, retryable bool) (localEnvironmentDependencyJobState, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	job, ok := s.localEnvironmentDependencyJobs[strings.TrimSpace(jobID)]
	if !ok {
		return localEnvironmentDependencyJobState{}, false
	}
	if localEnvironmentDependencyJobTerminal(job.State) {
		return job, true
	}
	job.State = strings.TrimSpace(state)
	job.FailureDetail = strings.TrimSpace(detail)
	job.Retryable = retryable
	job.UpdatedAt = nowISO()
	s.localEnvironmentDependencyJobs[job.JobID] = job
	s.persistStateLocked()
	return job, true
}

func normalizeLocalEnvironmentDependencyJobRequest(req localEnvironmentDependencyJobRequest) localEnvironmentDependencyJobRequest {
	sourceKind := strings.TrimSpace(req.SourceKind)
	if sourceKind == "" {
		sourceKind = localEnvironmentSourceManaged
	}
	return localEnvironmentDependencyJobRequest{
		EnvironmentKey:   strings.TrimSpace(req.EnvironmentKey),
		DependencyFamily: strings.TrimSpace(req.DependencyFamily),
		DependencyID:     strings.TrimSpace(req.DependencyID),
		SourceKind:       sourceKind,
	}
}

func localEnvironmentDependencyJobTerminal(state string) bool {
	switch strings.TrimSpace(state) {
	case localEnvironmentStateReadySystem, localEnvironmentStateReadyManaged, localEnvironmentStateFailed, localEnvironmentStateUnsupported, localEnvironmentStateCancelled:
		return true
	default:
		return false
	}
}

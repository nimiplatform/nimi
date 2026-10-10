package ai

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/audiomedia"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/remoteexecution"
	"github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/grpc/codes"
)

type preparedScenarioBodiesKey struct{}

func scenarioBodiesPrepared(ctx context.Context, jobID string) bool {
	id, _ := ctx.Value(preparedScenarioBodiesKey{}).(string)
	return id == jobID
}

// @nimi-authority: rule.nimi.runtime.service-operations.scenario-job-admission
// Reserve the whole output set before the first body IO, then fill only slots
// that do not already have a complete, privately owned candidate.
func (s *Service) prepareNativeBodies(ctx context.Context, jobID string, effective *cloudMediaEffectiveInputs, host remoteexecution.NativeTaskHost, observation *nimillm.NativeTaskObservation) (capabilitydriver.CloudMediaTransportResponse, error) {
	store, ok := s.runtimeArtifacts.(runtimeartifact.JobBodyStore)
	if !ok {
		return capabilitydriver.CloudMediaTransportResponse{}, fmt.Errorf("Runtime artifact store cannot reserve a complete Job body set")
	}
	owner := s.runtimeArtifactOwnerForJob(jobID, effective.request.GetHead())
	receipt := s.scenarioJobs.originalNativeReceipt(jobID)
	slots := make([]runtimeartifact.JobBodySlot, 0, len(observation.Artifacts))
	for _, artifact := range observation.Artifacts {
		bound := runtimeartifact.MaxCustodyBytes
		if len(artifact.GetBytes()) > 0 {
			bound = int64(len(artifact.GetBytes()))
		}
		if effective.request.GetScenarioType() == runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE {
			bound = min(bound, audiomedia.MaxInputBytes)
		}
		slots = append(slots, runtimeartifact.JobBodySlot{ArtifactID: artifact.GetArtifactId(), MaxBytes: bound})
	}
	if effective.request.GetScenarioType() == runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE {
		slots = append(slots, musicGenerationBodySlots(jobID, false)...)
	}
	if err := s.scenarioJobs.withJobWorkAuthority(jobID, func() error {
		if receipt == nil {
			// Finite protocols already declared these private output identities.
			return nil
		}
		return store.PrepareJobBodies(jobID, owner, slots)
	}); err != nil {
		if errors.Is(err, runtimeartifact.ErrJobBodyCapacity) {
			return capabilitydriver.CloudMediaTransportResponse{}, jobCapacityError(err)
		}
		return capabilitydriver.CloudMediaTransportResponse{}, err
	}
	s.scenarioJobs.mu.Lock()
	s.scenarioJobs.jobBodies = store
	s.scenarioJobs.mu.Unlock()
	var worldBodies map[string]*capabilitydriver.ArtifactBody
	defer func() { capabilitydriver.CloseArtifactBodies(worldBodies) }()
	for _, artifact := range observation.Artifacts {
		if metadata, complete := store.JobBodyStat(jobID, artifact.GetArtifactId()); complete {
			projectCommittedArtifactMetadata(artifact, metadata)
			continue
		}
		var bodies map[string]*capabilitydriver.ArtifactBody
		var err error
		if receipt == nil {
			finiteHost, ok := s.remoteMediaHost.(remoteexecution.FiniteMediaArtifactHost)
			if !ok {
				return capabilitydriver.CloudMediaTransportResponse{}, fmt.Errorf("finite result acquisition Host unavailable")
			}
			bodies, err = finiteHost.OpenFiniteMediaArtifacts(ctx, effective.connector, effective.target, []*runtimev1.ScenarioArtifact{artifact}, effective.dispatchAudit())
		} else if len(observation.WorldPayload) > 0 {
			if worldBodies == nil {
				worldBodies, err = host.OpenNativeTaskArtifacts(ctx, effective.connector, effective.target, s.scenarioJobs.originalNativeReceipt(jobID), observation, effective.dispatchAudit())
			}
			bodies = worldBodies
		} else {
			one := &nimillm.NativeTaskObservation{Artifacts: []*runtimev1.ScenarioArtifact{artifact}}
			bodies, err = host.OpenNativeTaskArtifacts(ctx, effective.connector, effective.target, s.scenarioJobs.originalNativeReceipt(jobID), one, effective.dispatchAudit())
		}
		if err != nil {
			return capabilitydriver.CloudMediaTransportResponse{}, err
		}
		body := bodies[artifact.GetArtifactId()]
		var source io.ReadCloser
		if body != nil {
			switch body.Kind() {
			case capabilitydriver.ArtifactBodyBoundedBytes:
				source = io.NopCloser(bytes.NewReader(body.BoundedBytes()))
			case capabilitydriver.ArtifactBodyIncrementalStream:
				source = body.TakeIncrementalStream()
			}
		}
		if source == nil {
			capabilitydriver.CloseArtifactBodies(bodies)
			return capabilitydriver.CloudMediaTransportResponse{}, fmt.Errorf("native body slot has no owned source")
		}
		err = store.StageJobBody(ctx, artifact.GetArtifactId(), runtimeartifact.ArtifactRecord{ProducerJobID: jobID, Owner: owner, MimeType: artifact.GetMimeType(), SizeBytes: artifact.GetSizeBytes(), ContentSHA256: scenarioArtifactDigest(artifact)}, source)
		if len(observation.WorldPayload) == 0 {
			capabilitydriver.CloseArtifactBodies(bodies)
		}
		if err != nil {
			return capabilitydriver.CloudMediaTransportResponse{}, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{Message: "Runtime body custody could not be completed"})
		}
		metadata, complete := store.JobBodyStat(jobID, artifact.GetArtifactId())
		if !complete {
			return capabilitydriver.CloudMediaTransportResponse{}, fmt.Errorf("native body completion was not retained")
		}
		projectCommittedArtifactMetadata(artifact, metadata)
	}
	response := capabilitydriver.CloudMediaTransportResponse{Artifacts: observation.Artifacts, ArtifactBodies: map[string]*capabilitydriver.ArtifactBody{}, Usage: observation.Usage, FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP}
	for _, artifact := range observation.Artifacts {
		source, ok := store.OpenJobBody(ctx, jobID, artifact.GetArtifactId())
		if !ok {
			capabilitydriver.CloseArtifactBodies(response.ArtifactBodies)
			return capabilitydriver.CloudMediaTransportResponse{}, fmt.Errorf("complete native body integrity could not be verified")
		}
		body, err := capabilitydriver.NewIncrementalArtifactBody(source.Body)
		if err != nil {
			source.Body.Close()
			capabilitydriver.CloseArtifactBodies(response.ArtifactBodies)
			return capabilitydriver.CloudMediaTransportResponse{}, err
		}
		response.ArtifactBodies[artifact.GetArtifactId()] = body
	}
	return response, nil
}

func (s *Service) releaseScenarioBodyCandidates(jobID string) error {
	store, ok := s.runtimeArtifacts.(runtimeartifact.JobBodyStore)
	if !ok {
		return nil
	}
	s.scenarioJobs.mu.RLock()
	r := s.scenarioJobs.jobs[jobID]
	if r == nil || r.executionStarted || r.terminalUnpersisted || !isTerminalScenarioJobStatus(r.job.GetStatus()) {
		s.scenarioJobs.mu.RUnlock()
		return nil
	}
	ids := append([]string(nil), r.bodyArtifactIDs...)
	published := map[string]bool{}
	for _, artifact := range r.job.GetArtifacts() {
		published[artifact.GetArtifactId()] = true
	}
	completed := r.job.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED
	s.scenarioJobs.mu.RUnlock()
	if completed {
		if err := store.FinalizeJobBodyPublications(jobID); err != nil {
			return err
		}
	}
	for _, id := range ids {
		if completed && published[id] {
			continue
		}
		if err := store.DeleteJobBody(jobID, id); err != nil {
			return err
		}
	}

	s.scenarioJobs.mu.Lock()
	defer s.scenarioJobs.mu.Unlock()
	r = s.scenarioJobs.jobs[jobID]
	if r == nil || r.executionStarted {
		return nil
	}
	previous := r.nativeResult
	previousCandidate := r.resultCandidate
	previousIDs := r.bodyArtifactIDs
	r.nativeResult = nil
	r.resultCandidate = nil
	r.bodyArtifactIDs = nil
	if err := s.scenarioJobs.persistDurableJobsLocked(scenarioJobPersistenceAttempt{Operation: scenarioJobPersistMaintenance, JobID: jobID, Status: r.job.GetStatus()}); err != nil {
		r.nativeResult = previous
		r.resultCandidate = previousCandidate
		r.bodyArtifactIDs = previousIDs
		return err
	}
	return nil
}

// Called by the actual Runtime bootstrap before any artifact reader is served.
func (s *Service) ReconcileNativeBodyPublications() error {
	missingOriginalWriter := false
	if owner, ok := s.runtimeArtifacts.(interface {
		ReconcileJobBodyPublications(func(string, string) bool, ...func(string) bool) error
	}); ok {
		if err := owner.ReconcileJobBodyPublications(func(jobID, id string) bool {
			s.scenarioJobs.mu.RLock()
			defer s.scenarioJobs.mu.RUnlock()
			r := s.scenarioJobs.jobs[jobID]
			if r == nil || r.job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
				return false
			}
			for _, artifact := range r.job.GetArtifacts() {
				if artifact.GetArtifactId() == id {
					return true
				}
			}
			return false
		}, func(jobID string) bool {
			s.scenarioJobs.mu.RLock()
			defer s.scenarioJobs.mu.RUnlock()
			// A quarantined or incomplete writer is not negative ownership proof.
			if s.scenarioJobs.durablePath != "" && !s.scenarioJobs.durable.current {
				missingOriginalWriter = true
			}
			if s.scenarioJobs.recoveryIncomplete || !s.scenarioJobs.durable.current || len(s.scenarioJobs.isolationDiagnostics) > 0 {
				return true
			}
			return s.scenarioJobs.jobs[jobID] != nil || s.scenarioJobs.captureRows[jobID] != nil
		}); err != nil {
			return err
		}
	}
	if missingOriginalWriter {
		s.scenarioJobs.mu.Lock()
		s.scenarioJobs.recoveryIncomplete = true
		err := s.scenarioJobs.persistDurableJobsLocked(scenarioJobPersistenceAttempt{Operation: scenarioJobPersistLoad})
		s.scenarioJobs.mu.Unlock()
		if err != nil {
			return err
		}
	}
	s.scenarioJobs.mu.RLock()
	var terminal []string
	for id, r := range s.scenarioJobs.jobs {
		if (r.nativeResult != nil || r.resultCandidate != nil || len(r.bodyArtifactIDs) > 0) && isTerminalScenarioJobStatus(r.job.GetStatus()) {
			terminal = append(terminal, id)
		}
	}
	s.scenarioJobs.mu.RUnlock()
	for _, id := range terminal {
		if err := s.releaseScenarioBodyCandidates(id); err != nil {
			return err
		}
	}
	s.reconcileExpiredScenarioResources()
	return nil
}

// Expiration closes observation independently of private use. This bounded
// local sweep acknowledges candidate/credential cleanup before quota can be
// refunded; it never sends provider IO under historical authority.
func (s *Service) reconcileExpiredScenarioResources() {
	if s == nil || s.scenarioJobs == nil {
		return
	}
	now := time.Now()
	var ids []string
	s.scenarioJobs.mu.RLock()
	for id, r := range s.scenarioJobs.jobs {
		if len(ids) >= 32 {
			break
		}
		if r != nil && !r.executionStarted && isTerminalScenarioJobStatus(r.job.GetStatus()) && scenarioJobPublicExpired(r, now) {
			ids = append(ids, id)
		}
	}
	s.scenarioJobs.mu.RUnlock()
	for _, id := range ids {
		if err := s.releaseScenarioBodyCandidates(id); err != nil {
			s.logScenarioJobPersistenceFailure("expired Job body cleanup remains pending", "job_id", id, "error", err)
			continue
		}
		s.releaseCloudCredentialCustodyForJob(id)
	}
	if len(ids) == 0 {
		return
	}
	s.scenarioJobs.mu.Lock()
	defer s.scenarioJobs.mu.Unlock()
	s.scenarioJobs.pruneLocked(now)
	if err := s.scenarioJobs.persistDurableJobsLocked(scenarioJobPersistenceAttempt{Operation: scenarioJobPersistMaintenance}); err != nil {
		s.logScenarioJobPersistenceFailure("expired Job pruning remains pending", "error", err)
	}
}

// Locator expiry cannot strand an incomplete required set. A later Get may
// query only the original task, while complete owned bytes are reused.
func (s *Service) nativeBodiesComplete(jobID string, result *nimillm.NativeTaskObservation) bool {
	store, ok := s.runtimeArtifacts.(runtimeartifact.JobBodyStore)
	if !ok || result == nil || len(result.Artifacts) == 0 {
		return false
	}
	for _, artifact := range result.Artifacts {
		if _, complete := store.JobBodyStat(jobID, artifact.GetArtifactId()); !complete {
			return false
		}
	}
	return true
}
func (s *Service) preserveCompleteNativeSlots(jobID string, previous, refreshed *nimillm.NativeTaskObservation) error {
	if refreshed == nil || len(previous.Artifacts) != len(refreshed.Artifacts) {
		return fmt.Errorf("original task refresh changed required set")
	}
	store, ok := s.runtimeArtifacts.(runtimeartifact.JobBodyStore)
	if !ok {
		return fmt.Errorf("original body owner unavailable")
	}
	for i, artifact := range previous.Artifacts {
		if artifact.GetArtifactId() != refreshed.Artifacts[i].GetArtifactId() {
			return fmt.Errorf("original task refresh changed slot identity")
		}
		if _, complete := store.JobBodyStat(jobID, artifact.GetArtifactId()); complete {
			refreshed.Artifacts[i] = artifact
		}
	}
	return nil
}

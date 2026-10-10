package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
)

func validateScenarioBodyIDs(ids []string) error {
	if len(ids) > 16 {
		return fmt.Errorf("Job body set exceeds its admitted count")
	}
	seen := map[string]bool{}
	for _, id := range ids {
		if id == "" || id != strings.TrimSpace(id) || len(id) > 160 || seen[id] {
			return fmt.Errorf("Job body slot identity is invalid")
		}
		seen[id] = true
	}
	return nil
}

func (s *Service) prepareScenarioBodySlots(ctx context.Context, jobID string, slots []runtimeartifact.JobBodySlot) error {
	store, ok := s.runtimeArtifacts.(runtimeartifact.JobBodyStore)
	if !ok {
		return fmt.Errorf("Job body custody owner unavailable")
	}
	return s.scenarioJobs.withJobWorkAuthority(jobID, func() error {
		s.scenarioJobs.mu.Lock()
		defer s.scenarioJobs.mu.Unlock()
		r := s.scenarioJobs.jobs[jobID]
		if r == nil || isTerminalScenarioJobStatus(r.job.GetStatus()) || ctx.Err() != nil {
			return fmt.Errorf("Job body admission is closed")
		}
		ids := make([]string, 0, len(slots))
		for _, slot := range slots {
			ids = append(ids, slot.ArtifactID)
		}
		if err := validateScenarioBodyIDs(ids); err != nil {
			return err
		}
		if len(r.bodyArtifactIDs) > 0 {
			for _, id := range ids {
				found := false
				for _, owned := range r.bodyArtifactIDs {
					if owned == id {
						found = true
						break
					}
				}
				if !found {
					return fmt.Errorf("Job body set cannot grow after admission")
				}
			}
			return store.PrepareJobBodies(jobID, s.runtimeArtifactOwnerForJobRecord(r), slots)
		}
		r.bodyArtifactIDs = ids
		s.scenarioJobs.jobBodies = store
		if err := s.scenarioJobs.persistDurableJobsLocked(scenarioJobPersistenceAttempt{Operation: scenarioJobPersistTransition, JobID: jobID, Status: r.job.GetStatus()}); err != nil {
			r.bodyArtifactIDs = nil
			return err
		}
		owner := s.runtimeArtifactOwnerForJobRecord(r)
		err := store.PrepareJobBodies(jobID, owner, slots)
		if errors.Is(err, runtimeartifact.ErrJobBodyCapacity) {
			return jobCapacityError(err)
		}
		return err
	})
}

func (s *Service) runtimeArtifactOwnerForJobRecord(record *scenarioJobRecord) *runtimeartifact.ArtifactOwner {
	if owner := record.localAppOwner; owner.valid() {
		return &runtimeartifact.ArtifactOwner{SubjectUserID: owner.AccountID, RegisteredAppSubject: owner.RegisteredAppSubject, AppID: owner.ProducerAppID}
	}
	return runtimeArtifactOwner(record.job.GetHead())
}

package ai

import (
	"fmt"

	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.r108
// Upload storage custody is separate from generation acceptance. Registering a
// private hosted locator never changes the public Job or its terminal clock.
func (s *scenarioJobStore) recordPikaUpload(jobID string, upload nimillm.PikaInputUpload) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	r := s.jobs[jobID]
	if r == nil || r.job == nil || r.cloudAssembly == nil || !r.executionStarted || r.nativeObservation {
		return fmt.Errorf("Pika upload has no original executing Job")
	}
	previous := append([]nimillm.PikaInputUpload(nil), r.pikaUploads...)
	found := false
	for i, current := range r.pikaUploads {
		if current.ContentIndex != upload.ContentIndex {
			continue
		}
		if current.URL != upload.URL || current.PutComplete && !upload.PutComplete {
			return fmt.Errorf("Pika upload changed original storage identity")
		}
		r.pikaUploads[i] = upload
		found = true
		break
	}
	if !found {
		if upload.PutComplete || isTerminalScenarioJobStatus(r.job.GetStatus()) || r.publicEvicted || r.inputCleanup != nil {
			return fmt.Errorf("Pika upload admission is closed")
		}
		r.pikaUploads = append(r.pikaUploads, upload)
	}
	if err := validatePikaUploadRecord(r); err != nil {
		r.pikaUploads = previous
		return err
	}
	if err := s.persistDurableJobsLocked(scenarioJobPersistenceAttempt{Operation: scenarioJobPersistTransition, JobID: jobID, Status: r.job.GetStatus()}); err != nil {
		r.pikaUploads = previous
		return err
	}
	return nil
}

func (s *scenarioJobStore) currentPikaUploads(jobID string) []nimillm.PikaInputUpload {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if r := s.jobs[jobID]; r != nil {
		return append([]nimillm.PikaInputUpload(nil), r.pikaUploads...)
	}
	return nil
}

func validatePikaUploadRecord(r *scenarioJobRecord) error {
	if len(r.pikaUploads) == 0 {
		return nil
	}
	invalid := fmt.Errorf("invalid original Pika input upload custody")
	if r.cloudAssembly == nil || r.cloudAssembly.Connector.Provider != "pika" || len(r.pikaUploads) > 12 || r.dispatchPossible == nil || r.inputCleanup == nil && r.cloudAssembly.CredentialCustodyRef == "" {
		return invalid
	}
	indices := map[int]bool{}
	for _, reference := range r.cloudAssembly.VideoMediaReferences {
		indices[reference.ContentIndex] = true
	}
	seen := map[int]bool{}
	for _, upload := range r.pikaUploads {
		if !indices[upload.ContentIndex] || seen[upload.ContentIndex] || nimillm.ValidatePikaInputUpload(upload) != nil {
			return invalid
		}
		seen[upload.ContentIndex] = true
	}
	return nil
}

package ai

import (
	"fmt"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
)

// bindCloudCredentialCustody fixes the exact sealed credential generation to
// the already-minted ScenarioJob identity before Job+assembly persistence.
func (s *Service) bindCloudCredentialCustody(jobID string, assembly *cloudResolvedAssembly) error {
	if s == nil || s.connStore == nil || s.scenarioJobs == nil || assembly == nil {
		return fmt.Errorf("Cloud ScenarioJob credential custody is unavailable")
	}
	ref, err := connector.CredentialCustodyRefForJob(jobID)
	if err != nil {
		return err
	}
	if err := s.scenarioJobs.beginCloudCredentialCustody(jobID, ref); err != nil {
		return err
	}
	record, capturedRef, err := s.connStore.CaptureCredentialCustody(assembly.Connector.ConnectorID, jobID)
	if err != nil {
		_ = s.scenarioJobs.clearPendingCloudCredentialCustody(jobID, ref)
		return fmt.Errorf("capture Cloud ScenarioJob credential custody: %w", err)
	}
	if capturedRef != ref {
		_ = s.releaseCloudCredentialCustody(capturedRef)
		_ = s.scenarioJobs.clearPendingCloudCredentialCustody(jobID, ref)
		return fmt.Errorf("captured Cloud ScenarioJob credential custody reference does not match its durable obligation")
	}
	assembly.Connector = record
	assembly.CredentialCustodyRef = capturedRef
	if err := validateCloudResolvedAssembly(assembly); err != nil {
		_ = s.discardPendingCloudCredentialCustody(jobID, ref)
		assembly.CredentialCustodyRef = ""
		return err
	}
	return nil
}

func (s *Service) discardPendingCloudCredentialCustody(jobID string, ref string) error {
	if err := s.releaseCloudCredentialCustody(ref); err != nil {
		return err
	}
	if s == nil || s.scenarioJobs == nil {
		return fmt.Errorf("Cloud ScenarioJob credential custody is unavailable")
	}
	return s.scenarioJobs.clearPendingCloudCredentialCustody(jobID, ref)
}

func (s *Service) releaseCloudCredentialCustody(ref string) error {
	if strings.TrimSpace(ref) == "" {
		return nil
	}
	if s == nil || s.connStore == nil {
		return fmt.Errorf("Cloud ScenarioJob credential custody is unavailable")
	}
	return s.connStore.ReleaseCredentialCustody(ref)
}

func (s *Service) releaseCloudCredentialCustodyForJob(jobID string) {
	if s == nil || s.scenarioJobs == nil {
		return
	}
	assembly, ok := s.scenarioJobs.cloudResolvedAssembly(jobID)
	if !ok || assembly == nil || strings.TrimSpace(assembly.CredentialCustodyRef) == "" {
		return
	}
	if err := s.releaseCloudCredentialCustody(assembly.CredentialCustodyRef); err != nil {
		s.logScenarioJobPersistenceFailure(
			"terminal Cloud ScenarioJob credential custody could not be released",
			"job_id", strings.TrimSpace(jobID),
			"error", err,
		)
	}
}

// releaseRecoveredTerminalCloudCredentialCustody closes the crash window
// between durable terminal Job persistence and sealed credential deletion.
func (s *Service) releaseRecoveredTerminalCloudCredentialCustody() error {
	if s == nil || s.scenarioJobs == nil {
		return nil
	}
	for _, pending := range s.scenarioJobs.pendingCloudCredentialCustody() {
		if err := s.discardPendingCloudCredentialCustody(pending.jobID, pending.ref); err != nil {
			return fmt.Errorf("release pending Cloud ScenarioJob credential custody: %w", err)
		}
	}
	s.scenarioJobs.mu.RLock()
	refs := make([]string, 0)
	for _, record := range s.scenarioJobs.jobs {
		if record == nil || record.job == nil || record.cloudAssembly == nil ||
			!isTerminalScenarioJobStatus(record.job.GetStatus()) {
			continue
		}
		if ref := strings.TrimSpace(record.cloudAssembly.CredentialCustodyRef); ref != "" {
			refs = append(refs, ref)
		}
	}
	s.scenarioJobs.mu.RUnlock()
	for _, ref := range refs {
		if err := s.releaseCloudCredentialCustody(ref); err != nil {
			return fmt.Errorf("release recovered Cloud ScenarioJob credential custody: %w", err)
		}
	}
	return nil
}

func connectorRecordWithCredentialCustody(record connector.ConnectorRecord, ref string) connector.ConnectorRecord {
	record.CredentialCustodyRef = strings.TrimSpace(ref)
	return record
}

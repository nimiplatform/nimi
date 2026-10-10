package ai

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// bindCloudCredentialCustody fixes the exact sealed credential generation to
// the already-minted ScenarioJob identity before Job+assembly persistence.
func (s *Service) bindCloudCredentialCustody(ctx context.Context, jobID string, assembly *cloudResolvedAssembly) error {
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
	var record connector.ConnectorRecord
	var capturedRef string
	if connector.IsChatGPTPlanRecord(assembly.Connector) {
		// SIWC renews in Connector custody first and captures only one
		// request-scoped access token for this Job.
		record, capturedRef, err = s.connStore.CaptureChatGPTPlanRequestCredential(ctx, assembly.Connector.ConnectorID, jobID)
	} else {
		record, capturedRef, err = s.connStore.CaptureCredentialCustody(assembly.Connector.ConnectorID, jobID)
	}
	if err != nil {
		_ = s.discardPendingCloudCredentialCustody(jobID, ref)
		if _, typed := grpcerr.ExtractReasonCode(err); typed {
			return err
		}
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
	if err := s.releaseCloudCredentialCustodyForJobDurably(jobID); err != nil {
		s.logScenarioJobPersistenceFailure(
			"terminal Cloud ScenarioJob credential custody could not be released",
			"job_id", strings.TrimSpace(jobID),
			"error", err,
		)
	}
}

func (s *Service) releaseCloudCredentialCustodyForJobDurably(jobID string) error {
	if s == nil || s.scenarioJobs == nil {
		return nil
	}
	s.scenarioJobs.mu.RLock()
	record := s.scenarioJobs.jobs[strings.TrimSpace(jobID)]
	canRelease := record != nil && record.job != nil && isTerminalScenarioJobStatus(record.job.GetStatus()) && !record.executionStarted && !record.terminalUnpersisted
	if canRelease && record.job.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED {
		canRelease = record.job.GetStopOutcome() == runtimev1.ScenarioJobStopOutcome_SCENARIO_JOB_STOP_OUTCOME_NOT_DISPATCHED || record.job.GetStopOutcome() == runtimev1.ScenarioJobStopOutcome_SCENARIO_JOB_STOP_OUTCOME_CONFIRMED || scenarioJobPublicExpired(record, time.Now())
	}
	s.scenarioJobs.mu.RUnlock()
	if !canRelease {
		return nil
	}
	if s.voiceAssets != nil {
		if pending, _, _, exists := s.voiceAssets.unpublishedVoiceBinding(jobID); exists && !pending.GetMetadata().GetFields()["provider_delete_succeeded"].GetBoolValue() {
			return nil
		}
	}
	assembly, ok := s.scenarioJobs.cloudResolvedAssembly(jobID)
	if !ok || assembly == nil || strings.TrimSpace(assembly.CredentialCustodyRef) == "" {
		return nil
	}
	if err := s.releaseCloudCredentialCustody(assembly.CredentialCustodyRef); err != nil {
		return err
	}
	return s.scenarioJobs.clearTerminalCloudCredentialCustody(jobID, assembly.CredentialCustodyRef)
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
	jobIDs := make([]string, 0)
	for _, record := range s.scenarioJobs.jobs {
		if record == nil || record.job == nil || record.cloudAssembly == nil ||
			!isTerminalScenarioJobStatus(record.job.GetStatus()) {
			continue
		}
		if ref := strings.TrimSpace(record.cloudAssembly.CredentialCustodyRef); ref != "" {
			jobIDs = append(jobIDs, strings.TrimSpace(record.job.GetJobId()))
		}
	}
	s.scenarioJobs.mu.RUnlock()
	for _, jobID := range jobIDs {
		if err := s.releaseCloudCredentialCustodyForJobDurably(jobID); err != nil {
			return fmt.Errorf("release recovered Cloud ScenarioJob credential custody: %w", err)
		}
	}
	return nil
}

func connectorRecordWithCredentialCustody(record connector.ConnectorRecord, ref string) connector.ConnectorRecord {
	record.CredentialCustodyRef = strings.TrimSpace(ref)
	return record
}

// cloudCredentialCustodyError keeps a typed Connector outcome, such as a SIWC
// reauthorization requirement, and wraps only untyped custody failures.
func cloudCredentialCustodyError(err error, message string) error {
	if _, typed := grpcerr.ExtractReasonCode(err); typed {
		return err
	}
	return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{Message: message})
}

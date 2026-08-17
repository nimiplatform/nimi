// @nimi-authority: rule.nimi.runtime.service-operations.r036

package ai

import (
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// validatePersistedScenarioJob rejects a semantically invalid public Job row
// before restart recovery can reinterpret or rewrite it. Persistence metadata
// is validated independently from protobuf decoding; parseable zero values are
// not a supported durable Job representation.
func validatePersistedScenarioJob(job *runtimev1.ScenarioJob, createdAt, updatedAt, terminalAt time.Time) error {
	if job == nil || strings.TrimSpace(job.GetJobId()) == "" || job.GetJobId() != strings.TrimSpace(job.GetJobId()) {
		return fmt.Errorf("persisted ScenarioJob has no canonical Job identity")
	}
	head := job.GetHead()
	if head == nil || strings.TrimSpace(head.GetAppId()) == "" || head.GetAppId() != strings.TrimSpace(head.GetAppId()) ||
		strings.TrimSpace(head.GetSubjectUserId()) == "" || head.GetSubjectUserId() != strings.TrimSpace(head.GetSubjectUserId()) {
		return fmt.Errorf("persisted ScenarioJob has no canonical owner head")
	}
	if strings.TrimSpace(job.GetTraceId()) == "" || job.GetTraceId() != strings.TrimSpace(job.GetTraceId()) {
		return fmt.Errorf("persisted ScenarioJob has no canonical trace identity")
	}
	if job.GetRouteDecision() != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL &&
		job.GetRouteDecision() != runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD {
		return fmt.Errorf("persisted ScenarioJob route is invalid")
	}
	if err := validateScenarioExecutionMode(job.GetScenarioType(), job.GetExecutionMode()); err != nil {
		return fmt.Errorf("persisted ScenarioJob scenario or execution mode is invalid")
	}
	switch job.GetStatus() {
	case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED,
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING,
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED,
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED,
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT:
	default:
		return fmt.Errorf("persisted ScenarioJob status is invalid")
	}
	if (job.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED ||
		job.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED) && job.GetReasonMetadata() != nil {
		return fmt.Errorf("persisted completed or canceled ScenarioJob has reason metadata")
	}
	if job.GetReasonCode() == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		return fmt.Errorf("persisted ScenarioJob reason code is unspecified")
	}
	if _, known := runtimev1.ReasonCode_name[int32(job.GetReasonCode())]; !known {
		return fmt.Errorf("persisted ScenarioJob reason code is unknown")
	}
	if err := validateFailedScenarioJobProjection(job); err != nil {
		return fmt.Errorf("persisted ScenarioJob failure projection is invalid: %w", err)
	}
	if job.GetCreatedAt() == nil || job.GetUpdatedAt() == nil ||
		job.GetCreatedAt().CheckValid() != nil || job.GetUpdatedAt().CheckValid() != nil ||
		createdAt.IsZero() || updatedAt.IsZero() {
		return fmt.Errorf("persisted ScenarioJob timestamps are incomplete")
	}
	createdAt = createdAt.UTC()
	updatedAt = updatedAt.UTC()
	jobCreatedAt := job.GetCreatedAt().AsTime().UTC()
	jobUpdatedAt := job.GetUpdatedAt().AsTime().UTC()
	// The public timestamps describe the Job lifecycle while the disk metadata
	// describes when that lifecycle state was durably recorded. Version-one
	// stores intentionally wrote these at adjacent, not identical, instants.
	if updatedAt.Before(createdAt) || jobUpdatedAt.Before(jobCreatedAt) ||
		createdAt.Before(jobCreatedAt) || updatedAt.Before(jobUpdatedAt) {
		return fmt.Errorf("persisted ScenarioJob timestamps are inconsistent")
	}
	if isTerminalScenarioJobStatus(job.GetStatus()) {
		if terminalAt.IsZero() || !terminalAt.UTC().Equal(updatedAt) {
			return fmt.Errorf("persisted terminal ScenarioJob timestamp is inconsistent")
		}
	} else if !terminalAt.IsZero() {
		return fmt.Errorf("persisted nonterminal ScenarioJob has a terminal timestamp")
	}
	return nil
}

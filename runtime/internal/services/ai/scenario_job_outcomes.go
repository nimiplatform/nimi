package ai

import (
	"fmt"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// @nimi-authority: rule.nimi.runtime.service-operations.scenario-job-observation
func validateScenarioJobOutcomes(job *runtimev1.ScenarioJob) error {
	if job == nil {
		return fmt.Errorf("ScenarioJob outcome requires a Job")
	}
	submission, stop := job.GetSubmissionOutcome(), job.GetStopOutcome()
	if _, ok := runtimev1.ScenarioJobSubmissionOutcome_name[int32(submission)]; !ok {
		return fmt.Errorf("unknown ScenarioJob submission outcome")
	}
	if _, ok := runtimev1.ScenarioJobStopOutcome_name[int32(stop)]; !ok {
		return fmt.Errorf("unknown ScenarioJob stop outcome")
	}
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED && stop != runtimev1.ScenarioJobStopOutcome_SCENARIO_JOB_STOP_OUTCOME_UNSPECIFIED {
		return fmt.Errorf("stop outcome is not applicable to an uncanceled Job")
	}
	// Existing records with absent facts remain unknown. Their terminal status
	// never supplies evidence that creation or cancellation did not happen.
	if submission == runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_UNSPECIFIED {
		return nil
	}
	accepted := runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_ACCEPTED
	unknown := runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_UNKNOWN
	notDispatched := runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_NOT_DISPATCHED
	rejected := runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_REJECTED
	switch job.GetStatus() {
	case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED:
		if submission != notDispatched {
			return fmt.Errorf("pending scheduling Job is already dispatched")
		}
	case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING:
		if submission != accepted && submission != unknown {
			return fmt.Errorf("running Job requires possible or accepted dispatch")
		}
	case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED:
		if submission != accepted {
			return fmt.Errorf("completed Job requires accepted execution")
		}
	case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED:
	case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT:
		if submission == rejected {
			return fmt.Errorf("rejected execution cannot time out")
		}
	case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED:
		switch submission {
		case notDispatched:
			if stop != runtimev1.ScenarioJobStopOutcome_SCENARIO_JOB_STOP_OUTCOME_NOT_DISPATCHED {
				return fmt.Errorf("undispatched canceled Job needs definite non-dispatch stop")
			}
		case unknown:
			if stop != runtimev1.ScenarioJobStopOutcome_SCENARIO_JOB_STOP_OUTCOME_UNCONFIRMED {
				return fmt.Errorf("uncertain dispatch cannot claim stop confirmation")
			}
		case accepted, rejected:
			if stop != runtimev1.ScenarioJobStopOutcome_SCENARIO_JOB_STOP_OUTCOME_CONFIRMED && stop != runtimev1.ScenarioJobStopOutcome_SCENARIO_JOB_STOP_OUTCOME_UNCONFIRMED {
				return fmt.Errorf("canceled execution requires stop evidence")
			}
		}
	default:
		return fmt.Errorf("unknown ScenarioJob status for outcomes")
	}
	if job.GetReasonCode() == runtimev1.ReasonCode_AI_PROVIDER_TASK_CANCELED && (job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED || submission != accepted || stop != runtimev1.ScenarioJobStopOutcome_SCENARIO_JOB_STOP_OUTCOME_CONFIRMED) {
		return fmt.Errorf("provider cancellation facts are inconsistent")
	}
	if job.GetReasonCode() == runtimev1.ReasonCode_AI_PROVIDER_TASK_EXPIRED && (job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT || submission != accepted) {
		return fmt.Errorf("provider expiration facts are inconsistent")
	}
	return nil
}

func setScenarioJobCancellationOutcome(job *runtimev1.ScenarioJob) {
	if job.GetSubmissionOutcome() == runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_NOT_DISPATCHED {
		job.StopOutcome = runtimev1.ScenarioJobStopOutcome_SCENARIO_JOB_STOP_OUTCOME_NOT_DISPATCHED
	} else {
		job.StopOutcome = runtimev1.ScenarioJobStopOutcome_SCENARIO_JOB_STOP_OUTCOME_UNCONFIRMED
	}
}

func setScenarioJobTransitionOutcome(job *runtimev1.ScenarioJob) {
	if job.GetExecutionMode() != runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB {
		return
	}
	switch job.GetStatus() {
	case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING:
		if job.GetSubmissionOutcome() == runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_NOT_DISPATCHED {
			if job.GetRouteDecision() == runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
				job.SubmissionOutcome = runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_ACCEPTED
			} else {
				job.SubmissionOutcome = runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_UNKNOWN
			}
		}
	case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED:
		job.SubmissionOutcome = runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_ACCEPTED
	case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED:
		if job.GetReasonCode() == runtimev1.ReasonCode_AI_PROVIDER_TASK_CANCELED {
			job.SubmissionOutcome = runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_ACCEPTED
			job.StopOutcome = runtimev1.ScenarioJobStopOutcome_SCENARIO_JOB_STOP_OUTCOME_CONFIRMED
		} else {
			setScenarioJobCancellationOutcome(job)
		}
	case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT:
		if job.GetReasonCode() == runtimev1.ReasonCode_AI_PROVIDER_TASK_EXPIRED {
			job.SubmissionOutcome = runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_ACCEPTED
		}
	}
}

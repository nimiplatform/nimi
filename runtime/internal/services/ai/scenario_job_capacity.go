package ai

import (
	"encoding/json"
	"errors"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

const (
	scenarioJobRowBytes                int64 = 1 << 30
	scenarioJobOwnerBytes              int64 = 1 << 30
	scenarioJobMachineBytes            int64 = 4 << 30
	scenarioJobMaximumNonterminal            = 256
	scenarioJobOwnerMaximumNonterminal       = 64
)

var errScenarioJobCapacity = errors.New("ScenarioJob capacity exhausted")

func jobCapacityError(err error) error {
	return grpcerr.WrapWithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_AI_JOB_CAPACITY_EXCEEDED, err, grpcerr.ReasonOptions{Message: "Runtime Job capacity is unavailable"})
}

func scenarioJobSubmissionError(err error, message string) error {
	if errors.Is(err, errScenarioJobCapacity) {
		return jobCapacityError(err)
	}
	return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{Message: message})
}
func jobCapacityOwner(record *scenarioJobRecord) string {
	if record.localAppOwner.valid() {
		return record.localAppOwner.AccountID + "\x00" + record.localAppOwner.RegisteredAppSubject
	}
	return record.job.GetHead().GetSubjectUserId() + "\x00" + record.job.GetHead().GetAppId()
}

// @nimi-authority: rule.nimi.runtime.service-operations.scenario-job-admission
// Admission counts current records and pending captures. It reserves no future
// result or control bytes; existing Job mutations do not acquire another slot.
func (s *scenarioJobStore) admitJobCapacityLocked(record *scenarioJobRecord) error {
	if s.recoveryIncomplete {
		return errors.Join(errScenarioJobCapacity, errScenarioJobRecoveryIncomplete)
	}
	incoming, err := scenarioJobRecordCharge(record)
	if err != nil {
		return err
	}
	if incoming > scenarioJobRowBytes {
		return errScenarioJobCapacity
	}
	machine, ownerBytes := incoming, incoming
	count, ownerCount := 0, 0
	owner := jobCapacityOwner(record)
	for _, other := range s.capacityRecordsLocked() {
		if other == nil || other.job == nil || other.job.GetJobId() == record.job.GetJobId() {
			continue
		}
		charge, err := s.currentJobRecordBytesLocked(other)
		if err != nil {
			return err
		}
		machine += charge
		if jobCapacityOwner(other) == owner {
			ownerBytes += charge
		}
		if other.job.GetExecutionMode() == runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB && !isTerminalScenarioJobStatus(other.job.GetStatus()) {
			count++
			if jobCapacityOwner(other) == owner {
				ownerCount++
			}
		}
	}
	if machine > scenarioJobMachineBytes || ownerBytes > scenarioJobOwnerBytes {
		return errScenarioJobCapacity
	}
	if record.job.GetExecutionMode() == runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB && (count >= scenarioJobMaximumNonterminal || ownerCount >= scenarioJobOwnerMaximumNonterminal) {
		return errScenarioJobCapacity
	}
	return nil
}

func (s *scenarioJobStore) currentJobRecordBytesLocked(record *scenarioJobRecord) (int64, error) {
	id := record.job.GetJobId()
	if _, changed := s.durable.changed[id]; !changed && s.durable.current {
		if size, known := s.durable.rowBytes[id]; known {
			return size, nil
		}
	}
	return scenarioJobRecordCharge(record)
}

// Reuse acknowledged sizes for unchanged records; only changed rows are
// encoded. Finite record/aggregate limits and real storage errors still apply
// to controls, independently from new-task admission limits.
func (s *scenarioJobStore) validateJobCapacityLocked() error {
	var machine int64
	owners := make(map[string]int64)
	for _, record := range s.capacityRecordsLocked() {
		if record == nil || record.job == nil {
			continue
		}
		charge, err := s.currentJobRecordBytesLocked(record)
		if err != nil {
			return err
		}
		owner := jobCapacityOwner(record)
		if charge < 0 || charge > scenarioJobRowBytes || charge > scenarioJobMachineBytes-machine || charge > scenarioJobOwnerBytes-owners[owner] {
			return errScenarioJobCapacity
		}
		machine += charge
		owners[owner] += charge
	}
	return nil
}
func scenarioJobRecordCharge(record *scenarioJobRecord) (int64, error) {
	row, err := scenarioJobDiskRecordFor(record.job.GetJobId(), record, false)
	if err != nil {
		return 0, err
	}
	raw, err := json.Marshal(row)
	return int64(len(raw)), err
}
func validateScenarioJobRecordSize(record *scenarioJobRecord) error {
	size, err := scenarioJobRecordCharge(record)
	if err != nil {
		return err
	}
	if size > scenarioJobRowBytes {
		return errScenarioJobCapacity
	}
	return nil
}

var errScenarioJobRecoveryIncomplete = errors.New("original Job recovery is incomplete")

// This non-content fence belongs to the original writer. Quarantine expiry
// disposes copied content; it cannot prove an isolated action never existed.
// @nimi-authority: rule.nimi.runtime.service-operations.scenario-job-admission
func (s *scenarioJobStore) admitNewScenarioAction() error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.recoveryIncomplete {
		return jobRecoveryAdmissionError()
	}
	return nil
}
func jobRecoveryAdmissionError() error {
	return grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_JOB_CAPACITY_EXCEEDED, grpcerr.ReasonOptions{Message: "Runtime Job state recovery is incomplete", ActionHint: "reconcile_runtime_job_state"})
}

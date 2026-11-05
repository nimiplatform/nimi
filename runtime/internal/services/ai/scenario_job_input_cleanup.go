package ai

import (
	"fmt"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/protobuf/types/known/structpb"
)

func cloneInputCleanup(value *nimillm.OSSInputCleanup) *nimillm.OSSInputCleanup {
	if value == nil {
		return nil
	}
	copy := *value
	return &copy
}

// This is cleanup lifecycle state in the existing Job journal. Keeping it with
// the original Job prevents repeated DELETEs and loss of the disposition when
// terminal credential custody is released; audit remains a separate observation.
func (s *scenarioJobStore) recordInputCleanup(jobID string, result nimillm.OSSInputCleanup) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	record := s.jobs[jobID]
	if record == nil {
		return fmt.Errorf("input cleanup Job is unavailable")
	}
	if record.inputCleanup != nil {
		return nil
	}
	record.inputCleanup = cloneInputCleanup(&result)
	if err := validateInputCleanupRecord(record); err != nil {
		record.inputCleanup = nil
		return err
	}
	if err := s.persistDurableJobsLocked(scenarioJobPersistenceAttempt{Operation: scenarioJobPersistTransition, JobID: jobID, Status: record.job.GetStatus()}); err != nil {
		record.inputCleanup = nil
		return err
	}
	return nil
}

func (s *scenarioJobStore) currentInputCleanup(jobID string) *nimillm.OSSInputCleanup {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if record := s.jobs[jobID]; record != nil {
		return cloneInputCleanup(record.inputCleanup)
	}
	return nil
}

func validateInputCleanupRecord(record *scenarioJobRecord) error {
	if record.inputCleanup == nil {
		return nil
	}
	value := record.inputCleanup
	invalid := fmt.Errorf("invalid input-storage cleanup disposition")
	if record.cloudAssembly == nil || record.cloudAssembly.Connector.Provider != "dashscope" || record.cloudAssembly.Connector.MediaStorage == nil {
		return invalid
	}
	switch value.State {
	case "not_required", "deleted", "failed", "unconfirmed":
	default:
		return invalid
	}
	total := 0
	for _, n := range []int{value.Deleted, value.Absent, value.Failed, value.Unconfirmed} {
		if n < 0 || n > 10 {
			return invalid
		}
		total += n
	}
	if total > 10 {
		return invalid
	}
	if value.State == "deleted" && (value.Failed+value.Unconfirmed > 0 || value.Deleted+value.Absent == 0) {
		return invalid
	}
	if value.State == "not_required" && total != 0 {
		return invalid
	}
	if _, ok := runtimev1.ReasonCode_name[int32(value.ReasonCode)]; !ok {
		return invalid
	}
	return nil
}

func projectInputCleanup(job *runtimev1.ScenarioJob, value *nimillm.OSSInputCleanup) {
	if value == nil {
		return
	}
	if job.ReasonMetadata == nil {
		job.ReasonMetadata = &structpb.Struct{Fields: map[string]*structpb.Value{}}
	}
	if job.ReasonMetadata.Fields == nil {
		job.ReasonMetadata.Fields = map[string]*structpb.Value{}
	}
	job.ReasonMetadata.Fields["oss_input_cleanup"] = structpb.NewStringValue(value.State)
	job.ReasonMetadata.Fields["oss_input_cleanup_reason"] = structpb.NewStringValue(value.ReasonCode.String())
}

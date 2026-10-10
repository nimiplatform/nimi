package ai

import (
	"context"
	"encoding/json"
	"fmt"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

// Result facts are transferred from this private row field into the public
// Job, never duplicated in both durable projections. Complete owned bodies
// survive a failed final metadata write without repeating execution.
type scenarioJobResultCandidate struct {
	Job            json.RawMessage `json:"job"`
	VisionLocate   json.RawMessage `json:"vision_locate,omitempty"`
	VoiceAsset     json.RawMessage `json:"voice_asset,omitempty"`
	VoiceReference json.RawMessage `json:"voice_reference,omitempty"`
}

func encodeScenarioResultCandidate(record *scenarioJobRecord) (*scenarioJobResultCandidate, error) {
	candidate := &scenarioJobResultCandidate{}
	marshal := protojson.MarshalOptions{UseProtoNames: true}
	var err error
	if candidate.Job, err = marshal.Marshal(record.job); err != nil {
		return nil, err
	}
	if record.visionLocate != nil {
		if candidate.VisionLocate, err = marshal.Marshal(record.visionLocate); err != nil {
			return nil, err
		}
	}
	if record.voiceAsset != nil {
		if candidate.VoiceAsset, err = marshal.Marshal(record.voiceAsset); err != nil {
			return nil, err
		}
	}
	if record.voiceReference != nil {
		if candidate.VoiceReference, err = marshal.Marshal(record.voiceReference); err != nil {
			return nil, err
		}
	}
	return candidate, nil
}

// A failed terminal write retains its cause only in this live worker. Get may
// retry that fact after work exits, but it is not a second durable lifecycle.
// A rejected voluntary Cancel never enters this path.
func (s *scenarioJobStore) retryPendingTerminal(jobID string) error {
	s.mu.RLock()
	r := s.jobs[jobID]
	var pending *runtimev1.ScenarioJob
	if r != nil && !r.executionStarted && !isTerminalScenarioJobStatus(r.job.GetStatus()) {
		pending = cloneScenarioJob(r.pendingTerminal)
	}
	s.mu.RUnlock()
	if pending == nil {
		return nil
	}
	event := runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_FAILED
	switch pending.GetStatus() {
	case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED:
		event = runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_CANCELED
	case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT:
		event = runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_TIMEOUT
	}
	_, _, err := s.transition(jobID, pending.GetStatus(), event, func(job *runtimev1.ScenarioJob) { proto.Reset(job); proto.Merge(job, pending) })
	return err
}

func cloneScenarioResultCandidate(candidate *scenarioJobResultCandidate) *scenarioJobResultCandidate {
	if candidate == nil {
		return nil
	}
	return &scenarioJobResultCandidate{Job: append(json.RawMessage(nil), candidate.Job...), VisionLocate: append(json.RawMessage(nil), candidate.VisionLocate...), VoiceAsset: append(json.RawMessage(nil), candidate.VoiceAsset...), VoiceReference: append(json.RawMessage(nil), candidate.VoiceReference...)}
}

func validateScenarioResultCandidate(record *scenarioJobRecord) error {
	if record.resultCandidate == nil {
		return nil
	}
	var job runtimev1.ScenarioJob
	if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(record.resultCandidate.Job, &job); err != nil {
		return err
	}
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || job.GetJobId() != record.job.GetJobId() || job.GetScenarioType() != record.job.GetScenarioType() || !proto.Equal(job.GetHead(), record.job.GetHead()) {
		return fmt.Errorf("result candidate does not match its original Job")
	}
	if err := validateScenarioJobOutcomes(&job); err != nil {
		return err
	}
	copy := *record
	copy.job = &job
	if (len(record.resultCandidate.VoiceAsset) > 0) != (len(record.resultCandidate.VoiceReference) > 0) {
		return fmt.Errorf("voice result candidate requires both outer fields")
	}
	if len(record.resultCandidate.VoiceAsset) > 0 {
		copy.voiceAsset = &runtimev1.VoiceAsset{}
		copy.voiceReference = &runtimev1.VoiceReference{}
		if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(record.resultCandidate.VoiceAsset, copy.voiceAsset); err != nil {
			return err
		}
		if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(record.resultCandidate.VoiceReference, copy.voiceReference); err != nil {
			return err
		}
	}
	if copy.voiceAsset != nil && copy.voiceAsset.GetPersistence() != runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_PROVIDER_PERSISTENT {
		return fmt.Errorf("ephemeral voice cannot be a durable result candidate")
	}
	if len(record.resultCandidate.VisionLocate) > 0 {
		copy.visionLocate = &runtimev1.VisionLocateResult{}
		if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(record.resultCandidate.VisionLocate, copy.visionLocate); err != nil {
			return err
		}
	}
	return validateScenarioJobTerminalResults(&copy)
}

func (s *scenarioJobStore) hasResultCandidate(id string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	r := s.jobs[id]
	return r != nil && r.resultCandidate != nil
}

func (s *Service) commitScenarioResultCandidate(ctx context.Context, id string) error {
	s.scenarioJobs.mu.RLock()
	r := s.scenarioJobs.jobs[id]
	var candidate *scenarioJobResultCandidate
	if r != nil {
		candidate = cloneScenarioResultCandidate(r.resultCandidate)
	}
	s.scenarioJobs.mu.RUnlock()
	if candidate == nil {
		return fmt.Errorf("complete result candidate is unavailable")
	}
	var job runtimev1.ScenarioJob
	if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(candidate.Job, &job); err != nil {
		return err
	}
	if len(candidate.VisionLocate) > 0 {
		var result runtimev1.VisionLocateResult
		if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(candidate.VisionLocate, &result); err != nil {
			return err
		}
		return s.completeVisionScenarioJob(id, &result, ctx)
	}
	if len(candidate.VoiceAsset) > 0 {
		var asset runtimev1.VoiceAsset
		var reference runtimev1.VoiceReference
		if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(candidate.VoiceAsset, &asset); err != nil {
			return err
		}
		if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(candidate.VoiceReference, &reference); err != nil {
			return err
		}
		return s.voiceAssets.commitRetainedResult(&asset, &reference, func() error {
			_, changed, err := s.transitionVoiceScenarioJobCompleted(id, &asset, &reference, func(current *runtimev1.ScenarioJob) { proto.Reset(current); proto.Merge(current, &job) }, ctx)
			if err == nil && !changed {
				return fmt.Errorf("voice publication is closed")
			}
			return err
		})
	}
	_, changed, err := s.transitionScenarioJob(id, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED, func(current *runtimev1.ScenarioJob) { proto.Reset(current); proto.Merge(current, &job) }, ctx)
	if err == nil && !changed {
		return fmt.Errorf("Job publication is closed")
	}
	return err
}

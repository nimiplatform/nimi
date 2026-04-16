package ai

import (
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *voiceAssetStore) submit(input *voiceWorkflowSubmitInput) (*runtimev1.ScenarioJob, *runtimev1.VoiceAsset) {
	if input == nil || input.Head == nil || input.Spec == nil {
		return nil, nil
	}
	head := input.Head
	scenarioType := input.ScenarioType
	spec := input.Spec
	traceID := strings.TrimSpace(input.TraceID)
	if traceID == "" {
		traceID = ulid.Make().String()
	}
	now := timestamppb.New(time.Now().UTC())
	jobID := ulid.Make().String()
	assetID := ulid.Make().String()
	workflowType := runtimev1.VoiceWorkflowType_VOICE_WORKFLOW_TYPE_UNSPECIFIED
	targetModelID := ""
	switch scenarioType {
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE:
		workflowType = runtimev1.VoiceWorkflowType_VOICE_WORKFLOW_TYPE_TTS_V2V
		targetModelID = strings.TrimSpace(spec.GetVoiceClone().GetTargetModelId())
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN:
		workflowType = runtimev1.VoiceWorkflowType_VOICE_WORKFLOW_TYPE_TTS_T2V
		targetModelID = strings.TrimSpace(spec.GetVoiceDesign().GetTargetModelId())
	}
	provider := strings.TrimSpace(input.Provider)
	if provider == "" {
		provider = inferVoiceAssetProvider(head.GetModelId())
	}
	if provider == "" {
		provider = "local"
	}
	persistence := runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_SESSION_EPHEMERAL
	switch strings.ToLower(strings.TrimSpace(input.OutputPersistence)) {
	case "provider_persistent":
		persistence = runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_PROVIDER_PERSISTENT
	}
	asset := &runtimev1.VoiceAsset{
		VoiceAssetId:     assetID,
		AppId:            head.GetAppId(),
		SubjectUserId:    head.GetSubjectUserId(),
		WorkflowType:     workflowType,
		Provider:         provider,
		ModelId:          head.GetModelId(),
		TargetModelId:    targetModelID,
		ProviderVoiceRef: "",
		Persistence:      persistence,
		Status:           runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_ACTIVE,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	workflowFamily := strings.TrimSpace(input.WorkflowFamily)
	if workflowFamily == "" {
		workflowFamily = inferVoiceWorkflowFamily(
			input.WorkflowModelID,
			input.ModelResolved,
			targetModelID,
			head.GetModelId(),
		)
	}
	if strings.TrimSpace(input.WorkflowModelID) != "" ||
		workflowFamily != "" ||
		strings.TrimSpace(input.ModelResolved) != "" ||
		strings.TrimSpace(input.HandlePolicyID) != "" ||
		strings.TrimSpace(input.HandlePersistence) != "" ||
		strings.TrimSpace(input.HandleScope) != "" ||
		strings.TrimSpace(input.HandleDefaultTTL) != "" ||
		strings.TrimSpace(input.HandleDeleteSem) != "" ||
		input.RuntimeReconcile {
		metadata := map[string]any{
			"workflow_model_id": strings.TrimSpace(input.WorkflowModelID),
			"model_resolved":    strings.TrimSpace(input.ModelResolved),
		}
		if workflowFamily != "" {
			metadata["workflow_family"] = workflowFamily
		}
		if strings.TrimSpace(input.HandlePolicyID) != "" {
			metadata["voice_handle_policy_id"] = strings.TrimSpace(input.HandlePolicyID)
		}
		if strings.TrimSpace(input.HandlePersistence) != "" {
			metadata["voice_handle_policy_persistence"] = strings.TrimSpace(input.HandlePersistence)
		}
		if strings.TrimSpace(input.HandleScope) != "" {
			metadata["voice_handle_policy_scope"] = strings.TrimSpace(input.HandleScope)
		}
		if strings.TrimSpace(input.HandleDefaultTTL) != "" {
			metadata["voice_handle_policy_default_ttl"] = strings.TrimSpace(input.HandleDefaultTTL)
		}
		if strings.TrimSpace(input.HandleDeleteSem) != "" {
			metadata["voice_handle_policy_delete_semantics"] = strings.TrimSpace(input.HandleDeleteSem)
		}
		if input.RuntimeReconcile {
			metadata["voice_handle_policy_runtime_reconciliation_required"] = true
		}
		asset.Metadata = structFromMap(metadata)
	}
	job := &runtimev1.ScenarioJob{
		JobId:             jobID,
		Head:              cloneScenarioHead(head),
		ScenarioType:      scenarioType,
		ExecutionMode:     runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		RouteDecision:     input.RouteDecision,
		ModelResolved:     strings.TrimSpace(input.ModelResolved),
		Status:            runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
		ReasonCode:        runtimev1.ReasonCode_ACTION_EXECUTED,
		CreatedAt:         now,
		UpdatedAt:         now,
		TraceId:           traceID,
		ProviderJobId:     "",
		ReasonDetail:      "",
		RetryCount:        0,
		Artifacts:         nil,
		Usage:             nil,
		NextPollAt:        nil,
		IgnoredExtensions: cloneIgnoredScenarioExtensions(input.IgnoredExtensions),
	}
	if job.ModelResolved == "" {
		job.ModelResolved = head.GetModelId()
	}
	if job.RouteDecision == runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
		job.RouteDecision = head.GetRoutePolicy()
	}
	record := &voiceScenarioJobRecord{
		job:         cloneScenarioJob(job),
		assetID:     assetID,
		events:      make([]*runtimev1.ScenarioJobEvent, 0, 4),
		subscribers: make(map[uint64]chan *runtimev1.ScenarioJobEvent),
		createdAt:   now.AsTime(),
		updatedAt:   now.AsTime(),
	}
	s.mu.Lock()
	s.publishLocked(record, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_SUBMITTED)
	s.jobs[jobID] = record
	s.assets[assetID] = cloneVoiceAsset(asset)
	s.pruneLocked(now.AsTime())
	s.mu.Unlock()
	return cloneScenarioJob(job), cloneVoiceAsset(asset)
}

func (s *voiceAssetStore) getJob(jobID string) (*runtimev1.ScenarioJob, bool) {
	id := strings.TrimSpace(jobID)
	if id == "" {
		return nil, false
	}
	s.mu.RLock()
	record, ok := s.jobs[id]
	if !ok {
		s.mu.RUnlock()
		return nil, false
	}
	job := cloneScenarioJob(record.job)
	s.mu.RUnlock()
	return job, true
}

func (s *voiceAssetStore) cancelJob(jobID string, reason string) (*runtimev1.ScenarioJob, bool) {
	id := strings.TrimSpace(jobID)
	if id == "" {
		return nil, false
	}
	s.mu.Lock()
	record, ok := s.jobs[id]
	if !ok {
		s.mu.Unlock()
		return nil, false
	}
	if isTerminalScenarioJobStatus(record.job.GetStatus()) {
		job := cloneScenarioJob(record.job)
		s.mu.Unlock()
		return job, false
	}
	record.job.Status = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED
	record.job.ReasonCode = runtimev1.ReasonCode_ACTION_EXECUTED
	record.job.ReasonDetail = strings.TrimSpace(reason)
	nowTime := time.Now().UTC()
	record.updatedAt = nowTime
	record.terminalAt = nowTime
	record.job.UpdatedAt = timestamppb.New(nowTime)
	if asset := s.assets[record.assetID]; asset != nil {
		asset.Status = runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_FAILED
		asset.UpdatedAt = timestamppb.New(nowTime)
	}
	s.publishLocked(record, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_CANCELED)
	s.pruneLocked(nowTime)
	job := cloneScenarioJob(record.job)
	s.mu.Unlock()
	return job, true
}

func (s *voiceAssetStore) queueJob(jobID string) bool {
	return s.transitionJob(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_QUEUED, nil)
}

func (s *voiceAssetStore) runJob(jobID string) bool {
	return s.transitionJob(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_RUNNING, nil)
}

func (s *voiceAssetStore) completeJob(jobID string, providerJobID string, providerVoiceRef string, metadata map[string]any, usage *runtimev1.UsageStats) bool {
	return s.transitionJob(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED, func(record *voiceScenarioJobRecord) {
		record.job.ProviderJobId = strings.TrimSpace(providerJobID)
		record.job.ReasonCode = runtimev1.ReasonCode_ACTION_EXECUTED
		record.job.ReasonDetail = ""
		record.job.Usage = usage
		asset := s.assets[record.assetID]
		if asset != nil {
			asset.ProviderVoiceRef = strings.TrimSpace(providerVoiceRef)
			if len(metadata) > 0 {
				asset.Metadata = structFromMap(metadata)
			}
			asset.Status = runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_ACTIVE
			asset.UpdatedAt = timestamppb.New(time.Now().UTC())
		}
	})
}

func (s *voiceAssetStore) failJob(jobID string, reasonCode runtimev1.ReasonCode, detail string) bool {
	return s.transitionJob(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_FAILED, func(record *voiceScenarioJobRecord) {
		record.job.ReasonCode = reasonCode
		record.job.ReasonDetail = strings.TrimSpace(detail)
		asset := s.assets[record.assetID]
		if asset != nil {
			asset.Status = runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_FAILED
			asset.UpdatedAt = timestamppb.New(time.Now().UTC())
		}
	})
}

func (s *voiceAssetStore) timeoutJob(jobID string, reasonCode runtimev1.ReasonCode, detail string) bool {
	return s.transitionJob(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_TIMEOUT, func(record *voiceScenarioJobRecord) {
		record.job.ReasonCode = reasonCode
		record.job.ReasonDetail = strings.TrimSpace(detail)
		asset := s.assets[record.assetID]
		if asset != nil {
			asset.Status = runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_FAILED
			asset.UpdatedAt = timestamppb.New(time.Now().UTC())
		}
	})
}

func (s *voiceAssetStore) transitionJob(
	jobID string,
	status runtimev1.ScenarioJobStatus,
	eventType runtimev1.ScenarioJobEventType,
	mutate func(record *voiceScenarioJobRecord),
) bool {
	id := strings.TrimSpace(jobID)
	if id == "" {
		return false
	}
	s.mu.Lock()
	record, ok := s.jobs[id]
	if !ok {
		s.mu.Unlock()
		return false
	}
	if isTerminalScenarioJobStatus(record.job.GetStatus()) {
		s.mu.Unlock()
		return false
	}
	record.job.Status = status
	nowTime := time.Now().UTC()
	record.updatedAt = nowTime
	if isTerminalScenarioJobStatus(status) {
		record.terminalAt = nowTime
	}
	record.job.UpdatedAt = timestamppb.New(nowTime)
	if mutate != nil {
		mutate(record)
	}
	s.publishLocked(record, eventType)
	s.pruneLocked(nowTime)
	s.mu.Unlock()
	return true
}

func (s *voiceAssetStore) subscribe(jobID string, buffer int) (uint64, <-chan *runtimev1.ScenarioJobEvent, []*runtimev1.ScenarioJobEvent, bool, bool) {
	id := strings.TrimSpace(jobID)
	if id == "" {
		return 0, nil, nil, false, false
	}
	if buffer < 1 {
		buffer = 1
	}
	s.mu.Lock()
	record, ok := s.jobs[id]
	if !ok {
		s.mu.Unlock()
		return 0, nil, nil, false, false
	}
	record.nextSubID++
	subID := record.nextSubID
	ch := make(chan *runtimev1.ScenarioJobEvent, buffer)
	record.subscribers[subID] = ch
	backlog := make([]*runtimev1.ScenarioJobEvent, 0, len(record.events))
	for _, event := range record.events {
		backlog = append(backlog, cloneScenarioJobEvent(event))
	}
	terminal := isTerminalScenarioJobStatus(record.job.GetStatus())
	s.mu.Unlock()
	return subID, ch, backlog, terminal, true
}

func (s *voiceAssetStore) unsubscribe(jobID string, subID uint64) {
	id := strings.TrimSpace(jobID)
	if id == "" || subID == 0 {
		return
	}
	s.mu.Lock()
	record, ok := s.jobs[id]
	if !ok {
		s.mu.Unlock()
		return
	}
	if ch, exists := record.subscribers[subID]; exists {
		delete(record.subscribers, subID)
		close(ch)
	}
	s.mu.Unlock()
}

package ai

import (
	"context"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *voiceAssetStore) submit(input *voiceWorkflowSubmitInput) (*runtimev1.ScenarioJob, *runtimev1.VoiceAsset) {
	if input == nil || input.Head == nil || input.Spec == nil {
		return nil, nil
	}
	head := input.Head
	scenarioType := input.ScenarioType
	traceID := strings.TrimSpace(input.TraceID)
	if traceID == "" {
		traceID = ulid.Make().String()
	}
	now := timestamppb.New(time.Now().UTC())
	jobID := ulid.Make().String()
	assetID := ulid.Make().String()
	asset := newVoiceAssetDraft(input, assetID, now)
	if asset == nil {
		return nil, nil
	}
	job := &runtimev1.ScenarioJob{
		JobId:                  jobID,
		Head:                   cloneScenarioHead(head),
		ScenarioType:           scenarioType,
		ExecutionMode:          runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		RouteDecision:          input.RouteDecision,
		ModelResolved:          strings.TrimSpace(input.ModelResolved),
		Status:                 runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
		ReasonCode:             runtimev1.ReasonCode_ACTION_EXECUTED,
		CreatedAt:              now,
		UpdatedAt:              now,
		TraceId:                traceID,
		ProviderJobId:          "",
		ReasonDetail:           "",
		RetryCount:             0,
		Artifacts:              nil,
		Usage:                  nil,
		NextPollAt:             nil,
		EffectiveInputIdentity: cloneLoadoutEffectiveInputIdentity(input.EffectiveInputIdentity),
		IgnoredExtensions:      cloneIgnoredScenarioExtensions(input.IgnoredExtensions),
	}
	record := &voiceScenarioJobRecord{
		job:               cloneScenarioJob(job),
		localAppOwner:     cloneLocalAppJobOwner(input.LocalAppOwner),
		assetID:           assetID,
		assetDraft:        cloneVoiceAsset(asset),
		targetDraft:       input.ExecutionTarget.Clone(),
		cloudBindingDraft: input.CloudBinding.Clone(),
		events:            make([]*runtimev1.ScenarioJobEvent, 0, 4),
		subscribers:       make(map[uint64]chan *runtimev1.ScenarioJobEvent),
		createdAt:         now.AsTime(),
		updatedAt:         now.AsTime(),
	}
	s.mu.Lock()
	s.publishLocked(record, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_SUBMITTED)
	s.jobs[jobID] = record
	s.pruneLocked(now.AsTime())
	s.mu.Unlock()
	return cloneScenarioJob(job), cloneVoiceAsset(asset)
}

func newVoiceAssetDraft(input *voiceWorkflowSubmitInput, assetID string, now *timestamppb.Timestamp) *runtimev1.VoiceAsset {
	if input == nil || input.Head == nil || input.Spec == nil || strings.TrimSpace(assetID) == "" || now == nil {
		return nil
	}
	scenarioType := input.ScenarioType
	spec := input.Spec
	creationSource := runtimev1.VoiceCreationSource_VOICE_CREATION_SOURCE_UNSPECIFIED
	targetModelID := ""
	if scenarioType == runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE && spec.GetVoiceCreate() != nil {
		creation := spec.GetVoiceCreate()
		targetModelID = strings.TrimSpace(creation.GetTargetModelId())
		switch creation.GetSource().(type) {
		case *runtimev1.VoiceCreateScenarioSpec_ReferenceAudio:
			creationSource = runtimev1.VoiceCreationSource_VOICE_CREATION_SOURCE_REFERENCE_AUDIO
		case *runtimev1.VoiceCreateScenarioSpec_TextDescription:
			creationSource = runtimev1.VoiceCreationSource_VOICE_CREATION_SOURCE_TEXT_DESCRIPTION
		}
	}
	provider := strings.TrimSpace(input.Provider)
	persistence := runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_SESSION_EPHEMERAL
	switch strings.ToLower(strings.TrimSpace(input.OutputPersistence)) {
	case "provider_persistent":
		persistence = runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_PROVIDER_PERSISTENT
	}
	asset := &runtimev1.VoiceAsset{
		VoiceAssetId:     assetID,
		AppId:            input.Head.GetAppId(),
		SubjectUserId:    input.Head.GetSubjectUserId(),
		CreationSource:   creationSource,
		Provider:         provider,
		ModelId:          strings.TrimSpace(input.ModelResolved),
		TargetModelId:    targetModelID,
		ProviderVoiceRef: "",
		Persistence:      persistence,
		Status:           runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_UNSPECIFIED,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	workflowFamily := strings.TrimSpace(input.WorkflowFamily)
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
	return asset
}

func (s *voiceAssetStore) localAppOwner(jobID string) (*localAppJobOwner, bool) {
	id := strings.TrimSpace(jobID)
	if id == "" {
		return nil, false
	}
	s.mu.RLock()
	record := s.jobs[id]
	if record == nil || !record.localAppOwner.valid() {
		s.mu.RUnlock()
		return nil, false
	}
	owner := cloneLocalAppJobOwner(record.localAppOwner)
	s.mu.RUnlock()
	return owner, true
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

func (s *voiceAssetStore) getCompletedJobResult(jobID string) (*runtimev1.VoiceAsset, *runtimev1.VoiceReference, bool) {
	id := strings.TrimSpace(jobID)
	if id == "" {
		return nil, nil, false
	}
	s.mu.RLock()
	record := s.jobs[id]
	if record == nil {
		asset := s.assets[id]
		valid := asset != nil && asset.GetStatus() == runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_ACTIVE &&
			strings.TrimSpace(asset.GetVoiceAssetId()) == id && strings.TrimSpace(asset.GetProviderVoiceRef()) != "" &&
			s.targets[id] != nil && s.targets[id].Valid()
		resultAsset := cloneVoiceAsset(asset)
		s.mu.RUnlock()
		if !valid {
			return nil, nil, false
		}
		return resultAsset, voiceAssetReference(id), true
	}
	if record.job == nil || record.job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		s.mu.RUnlock()
		return nil, nil, false
	}
	asset := record.terminalAssetSnapshot
	reference := record.terminalVoiceReferenceSnapshot
	valid := validTerminalVoiceJobSnapshot(record)
	resultAsset := cloneVoiceAsset(asset)
	resultReference := cloneVoiceReference(reference)
	s.mu.RUnlock()
	if !valid {
		return nil, nil, false
	}
	return resultAsset, resultReference, true
}

func validTerminalVoiceJobSnapshot(record *voiceScenarioJobRecord) bool {
	if record == nil || record.job == nil || record.job.GetHead() == nil ||
		record.job.GetScenarioType() != runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE ||
		record.job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED ||
		strings.TrimSpace(record.job.GetJobId()) == "" {
		return false
	}
	asset := record.terminalAssetSnapshot
	reference := record.terminalVoiceReferenceSnapshot
	return asset != nil &&
		asset.GetStatus() == runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_ACTIVE &&
		strings.TrimSpace(asset.GetVoiceAssetId()) == strings.TrimSpace(record.assetID) &&
		strings.TrimSpace(asset.GetProviderVoiceRef()) != "" &&
		strings.TrimSpace(asset.GetAppId()) == strings.TrimSpace(record.job.GetHead().GetAppId()) &&
		strings.TrimSpace(asset.GetSubjectUserId()) == strings.TrimSpace(record.job.GetHead().GetSubjectUserId()) &&
		reference != nil &&
		reference.GetKind() == runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_VOICE_ASSET &&
		strings.TrimSpace(reference.GetVoiceAssetId()) == strings.TrimSpace(record.assetID)
}

func (s *voiceAssetStore) setJobCancel(jobID string, cancel context.CancelFunc) bool {
	id := strings.TrimSpace(jobID)
	if id == "" || cancel == nil {
		return false
	}
	s.mu.Lock()
	record, ok := s.jobs[id]
	if !ok || isTerminalScenarioJobStatus(record.job.GetStatus()) {
		s.mu.Unlock()
		return false
	}
	record.cancel = cancel
	s.mu.Unlock()
	return true
}

func (s *voiceAssetStore) cancelJob(jobID string, reason string) (*runtimev1.ScenarioJob, bool) {
	id := strings.TrimSpace(jobID)
	if id == "" {
		return nil, false
	}
	s.mu.Lock()
	record, ok := s.jobs[id]
	if !ok || record == nil || record.job == nil || isTerminalScenarioJobStatus(record.job.GetStatus()) {
		var job *runtimev1.ScenarioJob
		if record != nil {
			job = cloneScenarioJob(record.job)
		}
		s.mu.Unlock()
		return job, false
	}
	record.cancelRequested = true
	record.cancelReason = strings.TrimSpace(reason)
	record.job.ReasonCode = runtimev1.ReasonCode_ACTION_EXECUTED
	record.job.ReasonDetail = record.cancelReason
	record.job.ReasonMetadata = nil
	nowTime := time.Now().UTC()
	record.updatedAt = nowTime
	record.job.UpdatedAt = timestamppb.New(nowTime)
	cancel := record.cancel
	executionStarted := record.executionStarted
	job := cloneScenarioJob(record.job)
	s.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	if !executionStarted {
		s.finishJobExecution(id)
		job, _ = s.getJob(id)
	}
	return job, true
}

func (s *voiceAssetStore) startJobExecution(jobID string) bool {
	id := strings.TrimSpace(jobID)
	if id == "" {
		return false
	}
	s.mu.Lock()
	record := s.jobs[id]
	if record == nil || record.job == nil || isTerminalScenarioJobStatus(record.job.GetStatus()) || record.cancelRequested || record.executionStarted {
		s.mu.Unlock()
		return false
	}
	record.executionStarted = true
	s.mu.Unlock()
	return true
}

func (s *voiceAssetStore) finishJobExecution(jobID string) {
	id := strings.TrimSpace(jobID)
	if id == "" {
		return
	}
	s.mu.Lock()
	record := s.jobs[id]
	if record == nil || record.job == nil {
		s.mu.Unlock()
		return
	}
	record.executionStarted = false
	cancel := record.cancel
	record.cancel = nil
	if record.cancelRequested && !isTerminalScenarioJobStatus(record.job.GetStatus()) {
		nowTime := time.Now().UTC()
		record.job.Status = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED
		record.job.ReasonCode = runtimev1.ReasonCode_ACTION_EXECUTED
		record.job.ReasonDetail = record.cancelReason
		record.job.ReasonMetadata = nil
		record.updatedAt = nowTime
		record.terminalAt = nowTime
		record.job.UpdatedAt = timestamppb.New(nowTime)
		s.publishLocked(record, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_CANCELED)
		s.pruneLocked(nowTime)
	}
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (s *voiceAssetStore) queueJob(jobID string) bool {
	return s.transitionJob(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_QUEUED, nil)
}

func (s *voiceAssetStore) runJob(jobID string) bool {
	return s.transitionJob(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_RUNNING, nil)
}

func (s *voiceAssetStore) completeJob(jobID string, providerVoiceRef string, metadata map[string]any, usage *runtimev1.UsageStats) bool {
	providerVoiceRef = strings.TrimSpace(providerVoiceRef)
	if providerVoiceRef == "" || !s.hasPublishableVoiceResultDraft(jobID) {
		s.failJob(jobID, runtimev1.ReasonCode_AI_OUTPUT_INVALID, stableScenarioJobReasonDetail(runtimev1.ReasonCode_AI_OUTPUT_INVALID), nil)
		return false
	}
	return s.transitionJob(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED, func(record *voiceScenarioJobRecord) {
		// Provider task identities never enter the public Runtime voice job.
		record.job.ProviderJobId = ""
		record.job.ReasonCode = runtimev1.ReasonCode_ACTION_EXECUTED
		record.job.ReasonDetail = ""
		record.job.ReasonMetadata = nil
		record.job.Usage = usage
		asset := cloneVoiceAsset(record.assetDraft)
		asset.ProviderVoiceRef = providerVoiceRef
		if len(metadata) > 0 {
			asset.Metadata = structFromMap(metadata)
		}
		asset.Status = runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_ACTIVE
		asset.CreatedAt = timestamppb.New(record.job.GetUpdatedAt().AsTime())
		asset.UpdatedAt = timestamppb.New(record.job.GetUpdatedAt().AsTime())
		record.terminalAssetSnapshot = cloneVoiceAsset(asset)
		record.terminalVoiceReferenceSnapshot = voiceAssetReference(asset.GetVoiceAssetId())
		s.assets[record.assetID] = asset
		s.targets[record.assetID] = record.targetDraft.Clone()
		if record.cloudBindingDraft != nil {
			s.cloudBindings[record.assetID] = record.cloudBindingDraft.Clone()
		}
	})
}

func (s *voiceAssetStore) hasPublishableVoiceResultDraft(jobID string) bool {
	id := strings.TrimSpace(jobID)
	if id == "" {
		return false
	}
	s.mu.RLock()
	record := s.jobs[id]
	valid := record != nil && record.assetDraft != nil &&
		strings.TrimSpace(record.assetDraft.GetVoiceAssetId()) == strings.TrimSpace(record.assetID) &&
		record.targetDraft != nil && record.targetDraft.Valid()
	if valid && record.assetDraft.GetPersistence() == runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_PROVIDER_PERSISTENT {
		valid = record.cloudBindingDraft != nil && record.cloudBindingDraft.Valid()
	}
	s.mu.RUnlock()
	return valid
}

func (s *voiceAssetStore) failJob(jobID string, reasonCode runtimev1.ReasonCode, detail string, reasonMetadata *structpb.Struct) bool {
	return s.transitionJob(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_FAILED, func(record *voiceScenarioJobRecord) {
		record.job.ReasonCode = reasonCode
		record.job.ReasonDetail = strings.TrimSpace(detail)
		record.job.ReasonMetadata = reasonMetadata
	})
}

func (s *voiceAssetStore) timeoutJob(jobID string, reasonCode runtimev1.ReasonCode, detail string, reasonMetadata *structpb.Struct) bool {
	return s.transitionJob(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_TIMEOUT, func(record *voiceScenarioJobRecord) {
		record.job.ReasonCode = reasonCode
		record.job.ReasonDetail = strings.TrimSpace(detail)
		record.job.ReasonMetadata = reasonMetadata
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
	if isTerminalScenarioJobStatus(record.job.GetStatus()) || record.cancelRequested {
		s.mu.Unlock()
		return false
	}
	record.job.Status = status
	nowTime := time.Now().UTC()
	record.updatedAt = nowTime
	if isTerminalScenarioJobStatus(status) {
		record.terminalAt = nowTime
		record.cancel = nil
	}
	record.job.UpdatedAt = timestamppb.New(nowTime)
	if mutate != nil {
		mutate(record)
	}
	s.pruneLocked(nowTime)
	if err := s.persistDurableAssetsLocked(); err != nil {
		if status == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED && s.failProviderPersistentCompletionLocked(record, err, nowTime) {
			s.publishLocked(record, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_FAILED)
			s.mu.Unlock()
			return false
		}
	}
	s.publishLocked(record, eventType)
	s.mu.Unlock()
	return true
}

func (s *voiceAssetStore) failProviderPersistentCompletionLocked(record *voiceScenarioJobRecord, persistErr error, nowTime time.Time) bool {
	if record == nil || record.job == nil {
		return false
	}
	asset := s.assets[record.assetID]
	if asset == nil || asset.GetPersistence() != runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_PROVIDER_PERSISTENT {
		return false
	}
	delete(s.assets, record.assetID)
	delete(s.targets, record.assetID)
	delete(s.cloudBindings, record.assetID)
	record.terminalAssetSnapshot = nil
	record.terminalVoiceReferenceSnapshot = nil
	record.job.Status = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED
	record.job.ReasonCode = runtimev1.ReasonCode_AI_PROVIDER_INTERNAL
	if persistErr != nil {
		record.job.ReasonDetail = strings.TrimSpace(persistErr.Error())
	}
	record.job.UpdatedAt = timestamppb.New(nowTime)
	record.terminalAt = nowTime
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

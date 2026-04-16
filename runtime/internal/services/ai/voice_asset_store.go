package ai

import (
	"sort"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	maxVoiceAssetEventBacklog        = 128
	maxRetainedTerminalVoiceJobs     = 1024
	voiceAssetStoreRetentionWindow   = 30 * time.Minute
	voiceAssetDeleteRetryCooldown    = 30 * time.Second
	maxVoiceAssetDeleteRetryAttempts = 4
)

type voiceScenarioJobRecord struct {
	job         *runtimev1.ScenarioJob
	assetID     string
	events      []*runtimev1.ScenarioJobEvent
	subscribers map[uint64]chan *runtimev1.ScenarioJobEvent
	nextSubID   uint64
	nextSeq     uint64
	createdAt   time.Time
	updatedAt   time.Time
	terminalAt  time.Time
}

type voiceWorkflowSubmitInput struct {
	Head              *runtimev1.ScenarioRequestHead
	ScenarioType      runtimev1.ScenarioType
	Spec              *runtimev1.ScenarioSpec
	TraceID           string
	RouteDecision     runtimev1.RoutePolicy
	ModelResolved     string
	Provider          string
	WorkflowModelID   string
	WorkflowFamily    string
	OutputPersistence string
	HandlePolicyID    string
	HandlePersistence string
	HandleScope       string
	HandleDefaultTTL  string
	HandleDeleteSem   string
	RuntimeReconcile  bool
	IgnoredExtensions []*runtimev1.IgnoredScenarioExtension
}

type voiceAssetStore struct {
	mu     sync.RWMutex
	jobs   map[string]*voiceScenarioJobRecord
	assets map[string]*runtimev1.VoiceAsset
}

type voiceAssetDeleteResult struct {
	Attempted              bool
	Succeeded              bool
	ReconciliationRequired bool
	PendingReconciliation  bool
	Exhausted              bool
	DeleteSemantics        string
	LastError              string
	LastAttemptAt          time.Time
	NextRetryAfter         time.Time
	RetryAttemptCount      int
}

func newVoiceAssetStore() *voiceAssetStore {
	return &voiceAssetStore{
		jobs:   make(map[string]*voiceScenarioJobRecord),
		assets: make(map[string]*runtimev1.VoiceAsset),
	}
}

func inferVoiceAssetProvider(modelID string) string {
	normalized := strings.ToLower(strings.TrimSpace(modelID))
	if normalized == "" {
		return ""
	}
	switch {
	case strings.HasPrefix(normalized, "openbmb/voxcpm2"),
		strings.HasPrefix(normalized, "k2-fsa/omnivoice"):
		return "local"
	}
	if strings.HasPrefix(normalized, "local/") {
		return "local"
	}
	segments := strings.Split(normalized, "/")
	if len(segments) > 1 && strings.TrimSpace(segments[0]) != "" {
		return strings.TrimSpace(segments[0])
	}
	switch {
	case strings.HasPrefix(normalized, "qwen3-tts"):
		return "local"
	case strings.HasPrefix(normalized, "cosyvoice"),
		strings.HasPrefix(normalized, "gpt-sovits"),
		strings.HasPrefix(normalized, "f5-tts"),
		strings.HasPrefix(normalized, "piper"),
		strings.HasPrefix(normalized, "kokoro"),
		strings.HasPrefix(normalized, "voxcpm"),
		strings.HasPrefix(normalized, "omnivoice"):
		return "local"
	default:
		return ""
	}
}

func inferVoiceWorkflowFamily(ids ...string) string {
	for _, raw := range ids {
		normalized := strings.ToLower(strings.TrimSpace(raw))
		if normalized == "" {
			continue
		}
		switch {
		case strings.Contains(normalized, "voxcpm"):
			return "voxcpm"
		case strings.Contains(normalized, "omnivoice"):
			return "omnivoice"
		case strings.Contains(normalized, "qwen3-tts"),
			strings.Contains(normalized, "qwen3tts"):
			return "qwen3_tts"
		case strings.Contains(normalized, "cosyvoice"):
			return "cosyvoice"
		case strings.Contains(normalized, "f5-tts"),
			strings.Contains(normalized, "f5tts"):
			return "f5tts"
		case strings.Contains(normalized, "gpt-sovits"),
			strings.Contains(normalized, "gptsovits"):
			return "gpt-sovits"
		}
	}
	return ""
}

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

func (s *voiceAssetStore) getAsset(voiceAssetID string) (*runtimev1.VoiceAsset, bool) {
	id := strings.TrimSpace(voiceAssetID)
	if id == "" {
		return nil, false
	}
	s.mu.RLock()
	asset, ok := s.assets[id]
	if !ok {
		s.mu.RUnlock()
		return nil, false
	}
	out := cloneVoiceAsset(asset)
	s.mu.RUnlock()
	return out, true
}

func (s *voiceAssetStore) listAssets(req *runtimev1.ListVoiceAssetsRequest) []*runtimev1.VoiceAsset {
	if req == nil {
		return nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	items := make([]*runtimev1.VoiceAsset, 0, len(s.assets))
	for _, asset := range s.assets {
		if strings.TrimSpace(req.GetAppId()) != "" && asset.GetAppId() != req.GetAppId() {
			continue
		}
		if strings.TrimSpace(req.GetSubjectUserId()) != "" && asset.GetSubjectUserId() != req.GetSubjectUserId() {
			continue
		}
		if strings.TrimSpace(req.GetModelId()) != "" && asset.GetModelId() != req.GetModelId() {
			continue
		}
		if strings.TrimSpace(req.GetTargetModelId()) != "" && asset.GetTargetModelId() != req.GetTargetModelId() {
			continue
		}
		if req.GetWorkflowType() != runtimev1.VoiceWorkflowType_VOICE_WORKFLOW_TYPE_UNSPECIFIED && asset.GetWorkflowType() != req.GetWorkflowType() {
			continue
		}
		if req.GetStatus() != runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_UNSPECIFIED && asset.GetStatus() != req.GetStatus() {
			continue
		}
		items = append(items, cloneVoiceAsset(asset))
	}
	return items
}

func (s *voiceAssetStore) deleteAsset(voiceAssetID string) bool {
	return s.deleteAssetWithResult(voiceAssetID, voiceAssetDeleteResult{})
}

func (s *voiceAssetStore) deleteAssetWithResult(voiceAssetID string, result voiceAssetDeleteResult) bool {
	id := strings.TrimSpace(voiceAssetID)
	if id == "" {
		return false
	}
	s.mu.Lock()
	asset, ok := s.assets[id]
	if !ok {
		s.mu.Unlock()
		return false
	}
	asset.Status = runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_DELETED
	nowTime := time.Now().UTC()
	asset.UpdatedAt = timestamppb.New(nowTime)
	applyVoiceAssetDeleteResultMetadata(asset, result, nowTime)
	s.mu.Unlock()
	return true
}

func (s *voiceAssetStore) updateDeletedAssetReconciliationResult(voiceAssetID string, result voiceAssetDeleteResult) bool {
	id := strings.TrimSpace(voiceAssetID)
	if id == "" {
		return false
	}
	s.mu.Lock()
	asset, ok := s.assets[id]
	if !ok || asset == nil || asset.GetStatus() != runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_DELETED {
		s.mu.Unlock()
		return false
	}
	nowTime := time.Now().UTC()
	asset.UpdatedAt = timestamppb.New(nowTime)
	applyVoiceAssetDeleteResultMetadata(asset, result, nowTime)
	s.mu.Unlock()
	return true
}

func (s *voiceAssetStore) listPendingDeleteReconciliationAssets(appID string, subjectUserID string, now time.Time, limit int) []*runtimev1.VoiceAsset {
	if limit <= 0 {
		return nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	items := make([]*runtimev1.VoiceAsset, 0, limit)
	for _, asset := range s.assets {
		if asset == nil || asset.GetStatus() != runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_DELETED {
			continue
		}
		if strings.TrimSpace(appID) != "" && asset.GetAppId() != strings.TrimSpace(appID) {
			continue
		}
		if strings.TrimSpace(subjectUserID) != "" && asset.GetSubjectUserId() != strings.TrimSpace(subjectUserID) {
			continue
		}
		fields := asset.GetMetadata().GetFields()
		if !fields["provider_delete_reconciliation_pending"].GetBoolValue() {
			continue
		}
		if fields["provider_delete_reconciliation_exhausted"].GetBoolValue() {
			continue
		}
		if !fields["voice_handle_policy_runtime_reconciliation_required"].GetBoolValue() {
			continue
		}
		if nextRetry := strings.TrimSpace(fields["provider_delete_next_retry_at"].GetStringValue()); nextRetry != "" {
			if parsed, err := time.Parse(time.RFC3339Nano, nextRetry); err == nil && now.Before(parsed.UTC()) {
				continue
			}
		}
		if lastAttempt := strings.TrimSpace(fields["provider_delete_last_attempt_at"].GetStringValue()); lastAttempt != "" {
			if parsed, err := time.Parse(time.RFC3339Nano, lastAttempt); err == nil && now.Sub(parsed.UTC()) < voiceAssetDeleteRetryCooldown {
				continue
			}
		}
		items = append(items, cloneVoiceAsset(asset))
		if len(items) >= limit {
			break
		}
	}
	return items
}

func (s *voiceAssetStore) publishLocked(record *voiceScenarioJobRecord, eventType runtimev1.ScenarioJobEventType) {
	record.nextSeq++
	event := &runtimev1.ScenarioJobEvent{
		EventType: eventType,
		Sequence:  record.nextSeq,
		TraceId:   record.job.GetTraceId(),
		Timestamp: timestamppb.New(time.Now().UTC()),
		Job:       cloneScenarioJob(record.job),
	}
	record.events = append(record.events, event)
	if len(record.events) > maxVoiceAssetEventBacklog {
		record.events = cloneScenarioJobEvents(record.events[len(record.events)-maxVoiceAssetEventBacklog:])
	}
	for _, ch := range record.subscribers {
		select {
		case ch <- cloneScenarioJobEvent(event):
		default:
		}
	}
}

func (s *voiceAssetStore) pruneLocked(now time.Time) {
	cutoff := now.Add(-voiceAssetStoreRetentionWindow)
	type candidate struct {
		jobID string
		at    time.Time
	}
	terminal := make([]candidate, 0, len(s.jobs))
	for jobID, record := range s.jobs {
		if record == nil || record.job == nil {
			s.deleteJobLocked(jobID)
			continue
		}
		if !isTerminalScenarioJobStatus(record.job.GetStatus()) {
			continue
		}
		terminalAt := voiceJobRecordTimestamp(record)
		if !terminalAt.IsZero() && terminalAt.Before(cutoff) {
			s.deleteJobLocked(jobID)
			continue
		}
		terminal = append(terminal, candidate{jobID: jobID, at: terminalAt})
	}
	if len(terminal) <= maxRetainedTerminalVoiceJobs {
		return
	}
	sort.Slice(terminal, func(i int, j int) bool {
		return terminal[i].at.Before(terminal[j].at)
	})
	for _, item := range terminal[:len(terminal)-maxRetainedTerminalVoiceJobs] {
		s.deleteJobLocked(item.jobID)
	}
}

func (s *voiceAssetStore) deleteJobLocked(jobID string) {
	record := s.jobs[jobID]
	delete(s.jobs, jobID)
	if record == nil {
		return
	}
	if strings.TrimSpace(record.assetID) != "" {
		delete(s.assets, record.assetID)
	}
	for subID, ch := range record.subscribers {
		delete(record.subscribers, subID)
		close(ch)
	}
}

func voiceJobRecordTimestamp(record *voiceScenarioJobRecord) time.Time {
	if record == nil {
		return time.Time{}
	}
	switch {
	case !record.terminalAt.IsZero():
		return record.terminalAt
	case !record.updatedAt.IsZero():
		return record.updatedAt
	default:
		return record.createdAt
	}
}

func cloneVoiceAsset(input *runtimev1.VoiceAsset) *runtimev1.VoiceAsset {
	if input == nil {
		return nil
	}
	cloned := proto.Clone(input)
	out, ok := cloned.(*runtimev1.VoiceAsset)
	if !ok {
		return nil
	}
	return out
}

func cloneScenarioJob(input *runtimev1.ScenarioJob) *runtimev1.ScenarioJob {
	if input == nil {
		return nil
	}
	cloned := proto.Clone(input)
	out, ok := cloned.(*runtimev1.ScenarioJob)
	if !ok {
		return nil
	}
	return out
}

func cloneScenarioJobEvent(input *runtimev1.ScenarioJobEvent) *runtimev1.ScenarioJobEvent {
	if input == nil {
		return nil
	}
	cloned := proto.Clone(input)
	out, ok := cloned.(*runtimev1.ScenarioJobEvent)
	if !ok {
		return nil
	}
	return out
}

func cloneScenarioHead(input *runtimev1.ScenarioRequestHead) *runtimev1.ScenarioRequestHead {
	if input == nil {
		return nil
	}
	cloned := proto.Clone(input)
	out, ok := cloned.(*runtimev1.ScenarioRequestHead)
	if !ok {
		return nil
	}
	return out
}

func structFromMap(values map[string]any) *structpb.Struct {
	if len(values) == 0 {
		return nil
	}
	out, err := structpb.NewStruct(values)
	if err != nil {
		return nil
	}
	return out
}

func metadataMap(input *structpb.Struct) map[string]any {
	if input == nil {
		return map[string]any{}
	}
	out := make(map[string]any, len(input.GetFields()))
	for key, value := range input.GetFields() {
		out[key] = value.AsInterface()
	}
	return out
}

func mergeStructFields(existing *structpb.Struct, values map[string]any) *structpb.Struct {
	merged := metadataMap(existing)
	for key, value := range values {
		merged[key] = value
	}
	return structFromMap(merged)
}

func applyVoiceAssetDeleteResultMetadata(asset *runtimev1.VoiceAsset, result voiceAssetDeleteResult, now time.Time) {
	if asset == nil {
		return
	}
	fields := metadataMap(asset.GetMetadata())
	if strings.TrimSpace(anyString(fields["deleted_at"])) == "" {
		fields["deleted_at"] = now.Format(time.RFC3339Nano)
	}
	fields["provider_delete_attempted"] = result.Attempted
	fields["provider_delete_succeeded"] = result.Succeeded
	fields["provider_delete_reconciliation_pending"] = result.PendingReconciliation
	fields["provider_delete_reconciliation_exhausted"] = result.Exhausted
	if strings.TrimSpace(result.DeleteSemantics) != "" {
		fields["provider_delete_semantics_effective"] = strings.TrimSpace(result.DeleteSemantics)
	}
	if !result.LastAttemptAt.IsZero() {
		fields["provider_delete_last_attempt_at"] = result.LastAttemptAt.UTC().Format(time.RFC3339Nano)
	}
	if result.RetryAttemptCount > 0 {
		fields["provider_delete_retry_attempt_count"] = float64(result.RetryAttemptCount)
	}
	if !result.NextRetryAfter.IsZero() {
		fields["provider_delete_next_retry_at"] = result.NextRetryAfter.UTC().Format(time.RFC3339Nano)
	} else {
		delete(fields, "provider_delete_next_retry_at")
	}
	if strings.TrimSpace(result.LastError) != "" {
		fields["provider_delete_last_error"] = strings.TrimSpace(result.LastError)
	} else {
		delete(fields, "provider_delete_last_error")
	}
	if result.ReconciliationRequired {
		fields["provider_delete_runtime_reconciliation_required"] = true
	}
	asset.Metadata = structFromMap(fields)
}

func anyString(value any) string {
	switch v := value.(type) {
	case string:
		return strings.TrimSpace(v)
	default:
		return ""
	}
}

func isTerminalScenarioJobStatus(status runtimev1.ScenarioJobStatus) bool {
	switch status {
	case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED,
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED,
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT:
		return true
	default:
		return false
	}
}

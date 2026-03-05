package ai

import (
	"strings"
	"sync"
	"time"

	"github.com/oklog/ulid/v2"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type voiceScenarioJobRecord struct {
	job         *runtimev1.ScenarioJob
	events      []*runtimev1.ScenarioJobEvent
	subscribers map[uint64]chan *runtimev1.ScenarioJobEvent
	nextSubID   uint64
	nextSeq     uint64
}

type voiceAssetStore struct {
	mu     sync.RWMutex
	jobs   map[string]*voiceScenarioJobRecord
	assets map[string]*runtimev1.VoiceAsset
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
	case strings.HasPrefix(normalized, "cosyvoice"), strings.HasPrefix(normalized, "gpt-sovits"), strings.HasPrefix(normalized, "f5-tts"), strings.HasPrefix(normalized, "piper"), strings.HasPrefix(normalized, "kokoro"):
		return "local"
	default:
		return ""
	}
}

func (s *voiceAssetStore) submit(head *runtimev1.ScenarioRequestHead, scenarioType runtimev1.ScenarioType, spec *runtimev1.ScenarioSpec, traceID string) (*runtimev1.ScenarioJob, *runtimev1.VoiceAsset) {
	if head == nil || spec == nil {
		return nil, nil
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
	provider := inferVoiceAssetProvider(head.GetModelId())
	if provider == "" {
		provider = "local"
	}
	asset := &runtimev1.VoiceAsset{
		VoiceAssetId:     assetID,
		AppId:            head.GetAppId(),
		SubjectUserId:    head.GetSubjectUserId(),
		WorkflowType:     workflowType,
		Provider:         provider,
		ModelId:          head.GetModelId(),
		TargetModelId:    targetModelID,
		ProviderVoiceRef: "voice_asset:" + assetID,
		Persistence:      runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_SESSION_EPHEMERAL,
		Status:           runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_ACTIVE,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	job := &runtimev1.ScenarioJob{
		JobId:          jobID,
		Head:           cloneScenarioHead(head),
		ScenarioType:   scenarioType,
		ExecutionMode:  runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		RouteDecision:  head.GetRoutePolicy(),
		ModelResolved:  head.GetModelId(),
		Status:         runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
		ReasonCode:     runtimev1.ReasonCode_ACTION_EXECUTED,
		CreatedAt:      now,
		UpdatedAt:      now,
		TraceId:        traceID,
		ProviderJobId:  "voice-job:" + jobID,
		ReasonDetail:   "",
		RetryCount:     0,
		Artifacts:      nil,
		Usage:          nil,
		NextPollAt:     nil,
		IgnoredExtensions: nil,
	}
	record := &voiceScenarioJobRecord{
		job:         cloneScenarioJob(job),
		events:      make([]*runtimev1.ScenarioJobEvent, 0, 4),
		subscribers: make(map[uint64]chan *runtimev1.ScenarioJobEvent),
	}
	s.mu.Lock()
	s.publishLocked(record, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_SUBMITTED)
	s.publishLocked(record, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED)
	s.jobs[jobID] = record
	s.assets[assetID] = cloneVoiceAsset(asset)
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
	record.job.UpdatedAt = timestamppb.New(time.Now().UTC())
	s.publishLocked(record, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_CANCELED)
	job := cloneScenarioJob(record.job)
	s.mu.Unlock()
	return job, true
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
	asset.UpdatedAt = timestamppb.New(time.Now().UTC())
	s.mu.Unlock()
	return true
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
	for _, ch := range record.subscribers {
		select {
		case ch <- cloneScenarioJobEvent(event):
		default:
		}
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

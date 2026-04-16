package ai

import (
	"sort"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
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

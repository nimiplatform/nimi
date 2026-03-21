package ai

import (
	"context"
	"sort"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	maxScenarioJobEventBacklog        = 128
	maxRetainedTerminalScenarioJobs   = 1024
	maxScenarioUploadedArtifacts      = 1024
	maxScenarioIdempotencyBindings    = 2048
	scenarioJobRetention              = 30 * time.Minute
	scenarioUploadedArtifactRetention = 30 * time.Minute
	scenarioIdempotencyRetention      = 30 * time.Minute
)

type scenarioJobRecord struct {
	job         *runtimev1.ScenarioJob
	events      []*runtimev1.ScenarioJobEvent
	subscribers map[uint64]chan *runtimev1.ScenarioJobEvent
	nextSubID   uint64
	nextSeq     uint64
	done        chan struct{}
	doneClosed  bool
	cancel      context.CancelFunc
	createdAt   time.Time
	updatedAt   time.Time
	terminalAt  time.Time
}

type uploadedArtifactRecord struct {
	appID         string
	subjectUserID string
	traceID       string
	artifact      *runtimev1.ScenarioArtifact
	storedAt      time.Time
}

type scenarioIdempotencyBinding struct {
	jobID   string
	boundAt time.Time
}

type scenarioJobStore struct {
	mu          sync.RWMutex
	jobs        map[string]*scenarioJobRecord
	idempotency map[string]scenarioIdempotencyBinding
	uploads     map[string]*uploadedArtifactRecord
}

func newScenarioJobStore() *scenarioJobStore {
	return &scenarioJobStore{
		jobs:        make(map[string]*scenarioJobRecord),
		idempotency: make(map[string]scenarioIdempotencyBinding),
		uploads:     make(map[string]*uploadedArtifactRecord),
	}
}

func (s *scenarioJobStore) create(job *runtimev1.ScenarioJob, cancel context.CancelFunc) *runtimev1.ScenarioJob {
	if job == nil {
		return nil
	}
	id := strings.TrimSpace(job.GetJobId())
	if id == "" {
		return nil
	}
	nowTime := time.Now().UTC()
	now := timestamppb.New(nowTime)
	if job.GetCreatedAt() == nil {
		job.CreatedAt = now
	}
	if job.GetUpdatedAt() == nil {
		job.UpdatedAt = now
	}
	if job.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_UNSPECIFIED {
		job.Status = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED
	}
	record := &scenarioJobRecord{
		job:         cloneScenarioJob(job),
		events:      make([]*runtimev1.ScenarioJobEvent, 0, 8),
		subscribers: make(map[uint64]chan *runtimev1.ScenarioJobEvent),
		done:        make(chan struct{}),
		cancel:      cancel,
		createdAt:   nowTime,
		updatedAt:   nowTime,
	}

	s.mu.Lock()
	s.jobs[id] = record
	s.publishLocked(record, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_SUBMITTED)
	s.pruneLocked(nowTime)
	s.mu.Unlock()
	return cloneScenarioJob(record.job)
}

func (s *scenarioJobStore) get(jobID string) (*runtimev1.ScenarioJob, bool) {
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

func (s *scenarioJobStore) getByIdempotency(scopeKey string) (*runtimev1.ScenarioJob, bool) {
	key := strings.TrimSpace(scopeKey)
	if key == "" {
		return nil, false
	}
	s.mu.RLock()
	binding, ok := s.idempotency[key]
	jobID := strings.TrimSpace(binding.jobID)
	record := s.jobs[jobID]
	if !ok || record == nil {
		s.mu.RUnlock()
		return nil, false
	}
	job := cloneScenarioJob(record.job)
	s.mu.RUnlock()
	return job, true
}

func (s *scenarioJobStore) bindIdempotency(scopeKey string, jobID string) {
	key := strings.TrimSpace(scopeKey)
	id := strings.TrimSpace(jobID)
	if key == "" || id == "" {
		return
	}
	s.mu.Lock()
	if _, exists := s.jobs[id]; exists {
		s.idempotency[key] = scenarioIdempotencyBinding{
			jobID:   id,
			boundAt: time.Now().UTC(),
		}
		s.pruneLocked(time.Now().UTC())
	}
	s.mu.Unlock()
}

func (s *scenarioJobStore) transition(
	jobID string,
	status runtimev1.ScenarioJobStatus,
	eventType runtimev1.ScenarioJobEventType,
	mutate func(*runtimev1.ScenarioJob),
) (*runtimev1.ScenarioJob, bool) {
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
	if mutate != nil {
		mutate(record.job)
	}
	if status != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_UNSPECIFIED {
		record.job.Status = status
	}
	nowTime := time.Now().UTC()
	record.updatedAt = nowTime
	record.job.UpdatedAt = timestamppb.New(nowTime)
	if isTerminalScenarioJobStatus(record.job.GetStatus()) && !record.doneClosed {
		record.doneClosed = true
		record.terminalAt = nowTime
		close(record.done)
	}
	if eventType != runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_TYPE_UNSPECIFIED {
		s.publishLocked(record, eventType)
	}
	s.pruneLocked(nowTime)
	job := cloneScenarioJob(record.job)
	s.mu.Unlock()
	return job, true
}

func (s *scenarioJobStore) cancel(jobID string) bool {
	id := strings.TrimSpace(jobID)
	if id == "" {
		return false
	}
	s.mu.RLock()
	record, ok := s.jobs[id]
	s.mu.RUnlock()
	if !ok {
		return false
	}
	if record.cancel != nil {
		record.cancel()
	}
	return true
}

func (s *scenarioJobStore) listArtifacts(jobID string) (*runtimev1.ScenarioJob, []*runtimev1.ScenarioArtifact, string, bool) {
	job, ok := s.get(jobID)
	if !ok {
		return nil, nil, "", false
	}
	items := make([]*runtimev1.ScenarioArtifact, 0, len(job.GetArtifacts()))
	for _, artifact := range job.GetArtifacts() {
		items = append(items, cloneScenarioArtifact(artifact))
	}
	return job, items, job.GetTraceId(), true
}

func (s *scenarioJobStore) findArtifact(appID string, subjectUserID string, artifactID string) (*runtimev1.ScenarioArtifact, string, bool) {
	id := strings.TrimSpace(artifactID)
	if id == "" {
		return nil, "", false
	}
	wantAppID := strings.TrimSpace(appID)
	wantSubjectUserID := strings.TrimSpace(subjectUserID)

	s.mu.RLock()
	defer s.mu.RUnlock()

	if uploaded := s.uploads[id]; uploaded != nil {
		if wantAppID != "" && strings.TrimSpace(uploaded.appID) != wantAppID {
			return nil, "", false
		}
		if wantSubjectUserID != "" && strings.TrimSpace(uploaded.subjectUserID) != wantSubjectUserID {
			return nil, "", false
		}
		return cloneScenarioArtifact(uploaded.artifact), strings.TrimSpace(uploaded.traceID), true
	}

	for _, record := range s.jobs {
		if record == nil || record.job == nil {
			continue
		}
		head := record.job.GetHead()
		if wantAppID != "" && strings.TrimSpace(head.GetAppId()) != wantAppID {
			continue
		}
		if wantSubjectUserID != "" && strings.TrimSpace(head.GetSubjectUserId()) != wantSubjectUserID {
			continue
		}
		for _, artifact := range record.job.GetArtifacts() {
			if strings.TrimSpace(artifact.GetArtifactId()) != id {
				continue
			}
			return cloneScenarioArtifact(artifact), record.job.GetTraceId(), true
		}
	}
	return nil, "", false
}

func (s *scenarioJobStore) storeUploadedArtifact(appID string, subjectUserID string, traceID string, artifact *runtimev1.ScenarioArtifact) *runtimev1.ScenarioArtifact {
	if artifact == nil {
		return nil
	}
	artifactID := strings.TrimSpace(artifact.GetArtifactId())
	if artifactID == "" {
		return nil
	}
	cloned := cloneScenarioArtifact(artifact)
	nowTime := time.Now().UTC()
	s.mu.Lock()
	s.uploads[artifactID] = &uploadedArtifactRecord{
		appID:         strings.TrimSpace(appID),
		subjectUserID: strings.TrimSpace(subjectUserID),
		traceID:       strings.TrimSpace(traceID),
		artifact:      cloned,
		storedAt:      nowTime,
	}
	s.pruneLocked(nowTime)
	s.mu.Unlock()
	return cloneScenarioArtifact(cloned)
}

func (s *scenarioJobStore) subscribe(jobID string, buffer int) (uint64, <-chan *runtimev1.ScenarioJobEvent, []*runtimev1.ScenarioJobEvent, bool, bool) {
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

func (s *scenarioJobStore) unsubscribe(jobID string, subID uint64) {
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
	ch, exists := record.subscribers[subID]
	if exists {
		delete(record.subscribers, subID)
		close(ch)
	}
	s.mu.Unlock()
}

func (s *scenarioJobStore) publishLocked(record *scenarioJobRecord, eventType runtimev1.ScenarioJobEventType) {
	if record == nil {
		return
	}
	record.nextSeq++
	event := &runtimev1.ScenarioJobEvent{
		EventType: eventType,
		Sequence:  record.nextSeq,
		TraceId:   record.job.GetTraceId(),
		Timestamp: timestamppb.New(time.Now().UTC()),
		Job:       cloneScenarioJob(record.job),
	}
	record.events = append(record.events, event)
	if len(record.events) > maxScenarioJobEventBacklog {
		record.events = cloneScenarioJobEvents(record.events[len(record.events)-maxScenarioJobEventBacklog:])
	}
	for _, ch := range record.subscribers {
		select {
		case ch <- cloneScenarioJobEvent(event):
			continue
		default:
		}
		select {
		case <-ch:
		default:
		}
		select {
		case ch <- cloneScenarioJobEvent(event):
		default:
		}
	}
}

func (s *scenarioJobStore) pruneLocked(now time.Time) {
	s.pruneJobsLocked(now)
	s.pruneUploadsLocked(now)
	s.pruneIdempotencyLocked(now)
}

func (s *scenarioJobStore) pruneJobsLocked(now time.Time) {
	cutoff := now.Add(-scenarioJobRetention)
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
		terminalAt := scenarioJobRecordTimestamp(record)
		if !terminalAt.IsZero() && terminalAt.Before(cutoff) {
			s.deleteJobLocked(jobID)
			continue
		}
		terminal = append(terminal, candidate{jobID: jobID, at: terminalAt})
	}
	if len(terminal) <= maxRetainedTerminalScenarioJobs {
		return
	}
	sort.Slice(terminal, func(i int, j int) bool {
		return terminal[i].at.Before(terminal[j].at)
	})
	for _, item := range terminal[:len(terminal)-maxRetainedTerminalScenarioJobs] {
		s.deleteJobLocked(item.jobID)
	}
}

func (s *scenarioJobStore) pruneUploadsLocked(now time.Time) {
	cutoff := now.Add(-scenarioUploadedArtifactRetention)
	type candidate struct {
		artifactID string
		at         time.Time
	}
	uploads := make([]candidate, 0, len(s.uploads))
	for artifactID, record := range s.uploads {
		if record == nil || record.artifact == nil {
			delete(s.uploads, artifactID)
			continue
		}
		if !record.storedAt.IsZero() && record.storedAt.Before(cutoff) {
			delete(s.uploads, artifactID)
			continue
		}
		uploads = append(uploads, candidate{artifactID: artifactID, at: record.storedAt})
	}
	if len(uploads) <= maxScenarioUploadedArtifacts {
		return
	}
	sort.Slice(uploads, func(i int, j int) bool {
		return uploads[i].at.Before(uploads[j].at)
	})
	for _, item := range uploads[:len(uploads)-maxScenarioUploadedArtifacts] {
		delete(s.uploads, item.artifactID)
	}
}

func (s *scenarioJobStore) pruneIdempotencyLocked(now time.Time) {
	cutoff := now.Add(-scenarioIdempotencyRetention)
	type candidate struct {
		key string
		at  time.Time
	}
	bindings := make([]candidate, 0, len(s.idempotency))
	for key, binding := range s.idempotency {
		jobID := strings.TrimSpace(binding.jobID)
		if jobID == "" || s.jobs[jobID] == nil {
			delete(s.idempotency, key)
			continue
		}
		if !binding.boundAt.IsZero() && binding.boundAt.Before(cutoff) {
			delete(s.idempotency, key)
			continue
		}
		bindings = append(bindings, candidate{key: key, at: binding.boundAt})
	}
	if len(bindings) <= maxScenarioIdempotencyBindings {
		return
	}
	sort.Slice(bindings, func(i int, j int) bool {
		return bindings[i].at.Before(bindings[j].at)
	})
	for _, item := range bindings[:len(bindings)-maxScenarioIdempotencyBindings] {
		delete(s.idempotency, item.key)
	}
}

func (s *scenarioJobStore) deleteJobLocked(jobID string) {
	record := s.jobs[jobID]
	delete(s.jobs, jobID)
	if record == nil {
		return
	}
	for subID, ch := range record.subscribers {
		delete(record.subscribers, subID)
		close(ch)
	}
}

func scenarioJobRecordTimestamp(record *scenarioJobRecord) time.Time {
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

func cloneScenarioJobEvents(input []*runtimev1.ScenarioJobEvent) []*runtimev1.ScenarioJobEvent {
	if len(input) == 0 {
		return nil
	}
	out := make([]*runtimev1.ScenarioJobEvent, 0, len(input))
	for _, event := range input {
		out = append(out, cloneScenarioJobEvent(event))
	}
	return out
}

func cloneScenarioArtifact(input *runtimev1.ScenarioArtifact) *runtimev1.ScenarioArtifact {
	if input == nil {
		return nil
	}
	cloned := proto.Clone(input)
	out, ok := cloned.(*runtimev1.ScenarioArtifact)
	if !ok {
		return nil
	}
	return out
}

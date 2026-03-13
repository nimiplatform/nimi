package ai

import (
	"context"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
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
}

type uploadedArtifactRecord struct {
	appID         string
	subjectUserID string
	traceID       string
	artifact      *runtimev1.ScenarioArtifact
}

type scenarioJobStore struct {
	mu          sync.RWMutex
	jobs        map[string]*scenarioJobRecord
	idempotency map[string]string
	uploads     map[string]*uploadedArtifactRecord
}

func newScenarioJobStore() *scenarioJobStore {
	return &scenarioJobStore{
		jobs:        make(map[string]*scenarioJobRecord),
		idempotency: make(map[string]string),
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
	now := timestamppb.New(time.Now().UTC())
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
	}

	s.mu.Lock()
	s.jobs[id] = record
	s.publishLocked(record, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_SUBMITTED)
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
	jobID, ok := s.idempotency[key]
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
		s.idempotency[key] = id
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
	record.job.UpdatedAt = timestamppb.New(time.Now().UTC())
	if isTerminalScenarioJobStatus(record.job.GetStatus()) && !record.doneClosed {
		record.doneClosed = true
		close(record.done)
	}
	if eventType != runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_TYPE_UNSPECIFIED {
		s.publishLocked(record, eventType)
	}
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

func (s *scenarioJobStore) listArtifacts(jobID string) ([]*runtimev1.ScenarioArtifact, string, bool) {
	job, ok := s.get(jobID)
	if !ok {
		return nil, "", false
	}
	items := make([]*runtimev1.ScenarioArtifact, 0, len(job.GetArtifacts()))
	for _, artifact := range job.GetArtifacts() {
		items = append(items, cloneScenarioArtifact(artifact))
	}
	return items, job.GetTraceId(), true
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
	s.mu.Lock()
	s.uploads[artifactID] = &uploadedArtifactRecord{
		appID:         strings.TrimSpace(appID),
		subjectUserID: strings.TrimSpace(subjectUserID),
		traceID:       strings.TrimSpace(traceID),
		artifact:      cloned,
	}
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

package ai

import (
	"context"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"strings"
	"sync"
	"time"
)

type mediaJobRecord struct {
	job         *runtimev1.MediaJob
	events      []*runtimev1.MediaJobEvent
	subscribers map[uint64]chan *runtimev1.MediaJobEvent
	nextSubID   uint64
	nextSeq     uint64
	done        chan struct{}
	doneClosed  bool
	cancel      context.CancelFunc
}

type mediaJobStore struct {
	mu          sync.RWMutex
	jobs        map[string]*mediaJobRecord
	idempotency map[string]string
}

func newMediaJobStore() *mediaJobStore {
	return &mediaJobStore{
		jobs:        make(map[string]*mediaJobRecord),
		idempotency: make(map[string]string),
	}
}

func (s *mediaJobStore) create(job *runtimev1.MediaJob, cancel context.CancelFunc) *runtimev1.MediaJob {
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
	if job.GetStatus() == runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_UNSPECIFIED {
		job.Status = runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_SUBMITTED
	}
	record := &mediaJobRecord{
		job:         cloneMediaJob(job),
		events:      make([]*runtimev1.MediaJobEvent, 0, 8),
		subscribers: make(map[uint64]chan *runtimev1.MediaJobEvent),
		done:        make(chan struct{}),
		cancel:      cancel,
	}

	s.mu.Lock()
	s.jobs[id] = record
	s.publishLocked(record, runtimev1.MediaJobEventType_MEDIA_JOB_EVENT_SUBMITTED)
	s.mu.Unlock()

	return cloneMediaJob(record.job)
}

func (s *mediaJobStore) get(jobID string) (*runtimev1.MediaJob, bool) {
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
	job := cloneMediaJob(record.job)
	s.mu.RUnlock()
	return job, true
}

func (s *mediaJobStore) getByIdempotency(scopeKey string) (*runtimev1.MediaJob, bool) {
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
	job := cloneMediaJob(record.job)
	s.mu.RUnlock()
	return job, true
}

func (s *mediaJobStore) bindIdempotency(scopeKey string, jobID string) {
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

func (s *mediaJobStore) transition(
	jobID string,
	status runtimev1.MediaJobStatus,
	eventType runtimev1.MediaJobEventType,
	mutate func(*runtimev1.MediaJob),
) (*runtimev1.MediaJob, bool) {
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
	if status != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_UNSPECIFIED {
		record.job.Status = status
	}
	record.job.UpdatedAt = timestamppb.New(time.Now().UTC())
	if isTerminalMediaJobStatus(record.job.GetStatus()) && !record.doneClosed {
		record.doneClosed = true
		close(record.done)
	}
	if eventType != runtimev1.MediaJobEventType_MEDIA_JOB_EVENT_TYPE_UNSPECIFIED {
		s.publishLocked(record, eventType)
	}
	job := cloneMediaJob(record.job)
	s.mu.Unlock()
	return job, true
}

func (s *mediaJobStore) waitTerminal(ctx context.Context, jobID string) (*runtimev1.MediaJob, bool) {
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
	done := record.done
	s.mu.RUnlock()

	if done != nil {
		select {
		case <-ctx.Done():
			return nil, true
		case <-done:
		}
	}
	return s.get(id)
}

func (s *mediaJobStore) cancel(jobID string) bool {
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

func (s *mediaJobStore) listArtifacts(jobID string) ([]*runtimev1.MediaArtifact, string, bool) {
	job, ok := s.get(jobID)
	if !ok {
		return nil, "", false
	}
	items := make([]*runtimev1.MediaArtifact, 0, len(job.GetArtifacts()))
	for _, artifact := range job.GetArtifacts() {
		items = append(items, cloneMediaArtifact(artifact))
	}
	return items, job.GetTraceId(), true
}

func (s *mediaJobStore) subscribe(jobID string, buffer int) (uint64, <-chan *runtimev1.MediaJobEvent, []*runtimev1.MediaJobEvent, bool, bool) {
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
	ch := make(chan *runtimev1.MediaJobEvent, buffer)
	record.subscribers[subID] = ch

	backlog := make([]*runtimev1.MediaJobEvent, 0, len(record.events))
	for _, event := range record.events {
		backlog = append(backlog, cloneMediaJobEvent(event))
	}
	terminal := isTerminalMediaJobStatus(record.job.GetStatus())
	s.mu.Unlock()
	return subID, ch, backlog, terminal, true
}

func (s *mediaJobStore) unsubscribe(jobID string, subID uint64) {
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

func (s *mediaJobStore) publishLocked(record *mediaJobRecord, eventType runtimev1.MediaJobEventType) {
	if record == nil {
		return
	}
	record.nextSeq++
	event := &runtimev1.MediaJobEvent{
		EventType: eventType,
		Sequence:  record.nextSeq,
		TraceId:   record.job.GetTraceId(),
		Timestamp: timestamppb.New(time.Now().UTC()),
		Job:       cloneMediaJob(record.job),
	}
	record.events = append(record.events, event)
	for _, ch := range record.subscribers {
		select {
		case ch <- cloneMediaJobEvent(event):
			continue
		default:
		}
		select {
		case <-ch:
		default:
		}
		select {
		case ch <- cloneMediaJobEvent(event):
		default:
		}
	}
}

func isTerminalMediaJobStatus(status runtimev1.MediaJobStatus) bool {
	switch status {
	case runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED,
		runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_FAILED,
		runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_CANCELED,
		runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_TIMEOUT:
		return true
	default:
		return false
	}
}

func cloneMediaJob(input *runtimev1.MediaJob) *runtimev1.MediaJob {
	if input == nil {
		return nil
	}
	cloned := proto.Clone(input)
	copied, ok := cloned.(*runtimev1.MediaJob)
	if !ok {
		return nil
	}
	return copied
}

func cloneMediaArtifact(input *runtimev1.MediaArtifact) *runtimev1.MediaArtifact {
	if input == nil {
		return nil
	}
	cloned := proto.Clone(input)
	copied, ok := cloned.(*runtimev1.MediaArtifact)
	if !ok {
		return nil
	}
	return copied
}

func cloneMediaJobEvent(input *runtimev1.MediaJobEvent) *runtimev1.MediaJobEvent {
	if input == nil {
		return nil
	}
	cloned := proto.Clone(input)
	copied, ok := cloned.(*runtimev1.MediaJobEvent)
	if !ok {
		return nil
	}
	return copied
}

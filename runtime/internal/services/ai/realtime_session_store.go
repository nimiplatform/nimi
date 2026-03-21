package ai

import (
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type realtimeSessionRecord struct {
	mu            sync.Mutex
	sendMu        sync.Mutex
	sessionID     string
	appID         string
	subjectUserID string
	modelResolved string
	traceID       string
	routeDecision runtimev1.RoutePolicy
	conn          realtimeConn
	closed        bool
	readerActive  bool
	reader        chan *runtimev1.RealtimeEvent
	nextSeq       uint64
	events        []*runtimev1.RealtimeEvent
}

type realtimeSessionStore struct {
	mu       sync.RWMutex
	sessions map[string]*realtimeSessionRecord
	onDrop   func(string, *runtimev1.RealtimeEvent)
}

func newRealtimeSessionStore() *realtimeSessionStore {
	return &realtimeSessionStore{
		sessions: make(map[string]*realtimeSessionRecord),
	}
}

func (s *realtimeSessionStore) setDropReporter(report func(string, *runtimev1.RealtimeEvent)) {
	s.mu.Lock()
	s.onDrop = report
	s.mu.Unlock()
}

func (s *realtimeSessionStore) create(record *realtimeSessionRecord) *realtimeSessionRecord {
	if record == nil || strings.TrimSpace(record.sessionID) == "" {
		return nil
	}
	s.mu.Lock()
	s.sessions[record.sessionID] = record
	s.mu.Unlock()
	return record
}

func (s *realtimeSessionStore) get(sessionID string) (*realtimeSessionRecord, bool) {
	id := strings.TrimSpace(sessionID)
	if id == "" {
		return nil, false
	}
	s.mu.RLock()
	record := s.sessions[id]
	s.mu.RUnlock()
	return record, record != nil
}

func (s *realtimeSessionStore) appendEvent(sessionID string, event *runtimev1.RealtimeEvent) (*runtimev1.RealtimeEvent, bool) {
	record, ok := s.get(sessionID)
	if !ok || event == nil {
		return nil, false
	}
	var dropped *runtimev1.RealtimeEvent
	record.mu.Lock()
	record.nextSeq++
	cloned := cloneRealtimeEvent(event)
	cloned.Sequence = record.nextSeq
	if strings.TrimSpace(cloned.GetTraceId()) == "" {
		cloned.TraceId = record.traceID
	}
	if cloned.GetTimestamp() == nil {
		cloned.Timestamp = timestamppb.New(time.Now().UTC())
	}
	record.events = append(record.events, cloned)
	if record.reader != nil {
		select {
		case record.reader <- cloneRealtimeEvent(cloned):
		default:
			dropped = cloneRealtimeEvent(cloned)
		}
	}
	record.mu.Unlock()
	if dropped != nil {
		s.mu.RLock()
		report := s.onDrop
		s.mu.RUnlock()
		if report != nil {
			report(strings.TrimSpace(sessionID), dropped)
		}
	}
	return cloneRealtimeEvent(cloned), true
}

func (s *realtimeSessionStore) claimReader(sessionID string, afterSequence uint64) ([]*runtimev1.RealtimeEvent, <-chan *runtimev1.RealtimeEvent, bool, bool) {
	record, ok := s.get(sessionID)
	if !ok {
		return nil, nil, false, false
	}
	record.mu.Lock()
	defer record.mu.Unlock()
	if record.readerActive {
		return nil, nil, false, true
	}
	record.readerActive = true
	record.reader = make(chan *runtimev1.RealtimeEvent, 32)
	backlog := make([]*runtimev1.RealtimeEvent, 0, len(record.events))
	for _, event := range record.events {
		if event.GetSequence() <= afterSequence {
			continue
		}
		backlog = append(backlog, cloneRealtimeEvent(event))
	}
	return backlog, record.reader, record.closed, false
}

func (s *realtimeSessionStore) releaseReader(sessionID string) {
	record, ok := s.get(sessionID)
	if !ok {
		return
	}
	record.mu.Lock()
	reader := record.reader
	record.reader = nil
	record.readerActive = false
	record.mu.Unlock()
	if reader != nil {
		close(reader)
	}
}

func (s *realtimeSessionStore) close(sessionID string) {
	id := strings.TrimSpace(sessionID)
	if id == "" {
		return
	}
	s.mu.Lock()
	record := s.sessions[id]
	if record != nil {
		delete(s.sessions, id)
	}
	s.mu.Unlock()
	if record == nil {
		return
	}
	record.mu.Lock()
	record.closed = true
	reader := record.reader
	record.reader = nil
	record.readerActive = false
	record.mu.Unlock()
	if reader != nil {
		close(reader)
	}
}

func cloneRealtimeEvent(input *runtimev1.RealtimeEvent) *runtimev1.RealtimeEvent {
	if input == nil {
		return nil
	}
	cloned, _ := proto.Clone(input).(*runtimev1.RealtimeEvent)
	return cloned
}

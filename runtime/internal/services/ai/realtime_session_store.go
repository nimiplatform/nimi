package ai

import (
	"context"
	"strings"
	"sync"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/realtimecore"
	"github.com/nimiplatform/nimi/runtime/internal/remoteexecution"
)

type realtimeOutputTrack struct {
	providerResponseID string
	outputTrackID      string
	requestID          string
	frameSequence      uint64
	terminal           bool
	interrupted        bool
	interrupting       bool
	requestTerminal    bool
}

type realtimeInputIdentity struct {
	inputTrackID   string
	utteranceID    string
	providerItemID string
}

type realtimeSessionRecord struct {
	mu                 sync.Mutex
	sessionID          string
	channelID          string
	generation         uint64
	appID              string
	subjectUserID      string
	correlationID      string
	inputAudio         *runtimev1.AiRealtimeAudioFormat
	outputAudio        *runtimev1.AiRealtimeAudioFormat
	turnDetection      runtimev1.AiRealtimeTurnDetectionMode
	stream             *realtimecore.Stream[*runtimev1.AiRealtimeEvent]
	driver             capabilitydriver.CloudRealtimeDriver
	provider           remoteexecution.RealtimeSession
	ctx                context.Context
	cancel             context.CancelFunc
	closed             bool
	nextSequence       uint64
	pendingRequestID   string
	inputTrackID       string
	utteranceID        string
	inputFrameSeq      uint64
	inputIdentityCount uint64
	inputCommitted     bool
	pendingInputs      []realtimeInputIdentity
	inputsByProvider   map[string]realtimeInputIdentity
	terminalInputs     map[string]struct{}
	tracksByProvider   map[string]*realtimeOutputTrack
	tracksByRuntime    map[string]*realtimeOutputTrack
}

type realtimeSessionStore struct {
	mu       sync.RWMutex
	sessions map[string]*realtimeSessionRecord
}

func newRealtimeSessionStore() *realtimeSessionStore {
	return &realtimeSessionStore{sessions: make(map[string]*realtimeSessionRecord)}
}

func (s *realtimeSessionStore) create(record *realtimeSessionRecord) bool {
	if s == nil || record == nil || strings.TrimSpace(record.sessionID) == "" {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.sessions[record.sessionID] != nil {
		return false
	}
	s.sessions[record.sessionID] = record
	return true
}

func (s *realtimeSessionStore) get(sessionID string) (*realtimeSessionRecord, bool) {
	if s == nil {
		return nil, false
	}
	id := strings.TrimSpace(sessionID)
	s.mu.RLock()
	record := s.sessions[id]
	s.mu.RUnlock()
	return record, record != nil
}

func (s *realtimeSessionStore) remove(sessionID string) *realtimeSessionRecord {
	if s == nil {
		return nil
	}
	id := strings.TrimSpace(sessionID)
	s.mu.Lock()
	record := s.sessions[id]
	delete(s.sessions, id)
	s.mu.Unlock()
	return record
}

func (s *realtimeSessionStore) all() []*realtimeSessionRecord {
	if s == nil {
		return nil
	}
	s.mu.RLock()
	records := make([]*realtimeSessionRecord, 0, len(s.sessions))
	for _, record := range s.sessions {
		records = append(records, record)
	}
	s.mu.RUnlock()
	return records
}

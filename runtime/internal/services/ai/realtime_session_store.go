package ai

import (
	"context"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/realtimecore"
	"github.com/nimiplatform/nimi/runtime/internal/remoteexecution"
	"google.golang.org/protobuf/proto"
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
	inputTrackID      string
	utteranceID       string
	providerItemID    string
	speechStopped     bool
	partialTranscript string
}

type realtimeSessionRecord struct {
	operationMu          sync.Mutex
	mu                   sync.Mutex
	sessionID            string
	channelID            string
	generation           uint64
	appID                string
	subjectUserID        string
	ownerSessionID       protectedlocal.Identifier
	ownerInvalidated     <-chan struct{}
	terminalDone         chan struct{}
	terminalControl      *runtimev1.RealtimeControlStatus
	correlationID        string
	inputAudio           *runtimev1.AiRealtimeAudioFormat
	outputAudio          *runtimev1.AiRealtimeAudioFormat
	turnDetection        runtimev1.AiRealtimeTurnDetectionMode
	stream               *realtimecore.Stream[*runtimev1.AiRealtimeEvent]
	driver               capabilitydriver.CloudRealtimeProtocol
	openExpectation      capabilitydriver.CloudRealtimeOpen
	provider             remoteexecution.RealtimeSession
	ctx                  context.Context
	cancel               context.CancelFunc
	closed               bool
	nextSequence         uint64
	pendingRequestID     string
	requestsByResponse   map[string]string
	responseKeysRequired bool
	inputTrackID         string
	utteranceID          string
	inputFrameSeq        uint64
	inputIdentityCount   uint64
	inputCommitted       bool
	pendingInputs        []realtimeInputIdentity
	inputsByProvider     map[string]realtimeInputIdentity
	terminalInputs       map[string]struct{}
	tracksByProvider     map[string]*realtimeOutputTrack
	tracksByRuntime      map[string]*realtimeOutputTrack
}

type realtimeSessionStore struct {
	mu        sync.RWMutex
	sessions  map[string]*realtimeSessionRecord
	terminals map[string]realtimeSessionTerminal
	now       func() time.Time
}

const realtimeTerminalTTL = 5 * time.Minute
const realtimeTerminalLimit = 256

// Only the control receipt survives resource cleanup, never the live record.
type realtimeSessionTerminal struct {
	appID, subjectUserID string
	ownerSessionID       protectedlocal.Identifier
	ownerInvalidated     <-chan struct{}
	control              *runtimev1.RealtimeControlStatus
	expiresAt            time.Time
}

func newRealtimeSessionStore() *realtimeSessionStore {
	return &realtimeSessionStore{sessions: make(map[string]*realtimeSessionRecord), terminals: make(map[string]realtimeSessionTerminal), now: time.Now}
}

func (s *realtimeSessionStore) create(record *realtimeSessionRecord) bool {
	if s == nil || record == nil || strings.TrimSpace(record.sessionID) == "" {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneTerminalsLocked(s.now())
	if s.sessions[record.sessionID] != nil {
		return false
	}
	if _, exists := s.terminals[record.sessionID]; exists {
		return false
	}
	s.sessions[record.sessionID] = record
	record.terminalDone = make(chan struct{})
	return true
}

func (s *realtimeSessionStore) pruneTerminalsLocked(now time.Time) {
	for id, terminal := range s.terminals {
		invalidated := false
		select {
		case <-terminal.ownerInvalidated:
			invalidated = true
		default:
		}
		if invalidated || !now.Before(terminal.expiresAt) {
			delete(s.terminals, id)
		}
	}
}

func (s *realtimeSessionStore) finish(record *realtimeSessionRecord, control *runtimev1.RealtimeControlStatus) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	s.pruneTerminalsLocked(now)
	if len(s.terminals) >= realtimeTerminalLimit {
		oldestID := ""
		var oldest time.Time
		for id, terminal := range s.terminals {
			if oldestID == "" || terminal.expiresAt.Before(oldest) {
				oldestID, oldest = id, terminal.expiresAt
			}
		}
		delete(s.terminals, oldestID)
	}
	s.terminals[record.sessionID] = realtimeSessionTerminal{appID: record.appID, subjectUserID: record.subjectUserID, ownerSessionID: record.ownerSessionID, ownerInvalidated: record.ownerInvalidated, control: proto.Clone(control).(*runtimev1.RealtimeControlStatus), expiresAt: now.Add(realtimeTerminalTTL)}
	delete(s.sessions, record.sessionID)
}

func (s *realtimeSessionStore) terminal(id string) (realtimeSessionTerminal, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneTerminalsLocked(s.now())
	terminal, ok := s.terminals[strings.TrimSpace(id)]
	if ok {
		terminal.control = proto.Clone(terminal.control).(*runtimev1.RealtimeControlStatus)
	}
	return terminal, ok
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

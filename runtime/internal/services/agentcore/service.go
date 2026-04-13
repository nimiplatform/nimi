package agentcore

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
)

const (
	agentCoreStateSchemaVersion = 1
	defaultAgentPageSize        = 50
	maxAgentPageSize            = 200
	defaultHookPageSize         = 50
	maxHookPageSize             = 200
	maxEventLogSize             = 256
	subscriberBuffer            = 32
)

type agentEntry struct {
	Agent *runtimev1.AgentRecord
	State *runtimev1.AgentStateProjection
	Hooks map[string]*runtimev1.PendingHook
}

type subscriber struct {
	id           uint64
	agentID      string
	eventFilters map[runtimev1.AgentEventType]struct{}
	ch           chan *runtimev1.AgentEvent
}

type Service struct {
	runtimev1.UnimplementedRuntimeAgentCoreServiceServer

	logger    *slog.Logger
	memorySvc *memoryservice.Service
	statePath string

	mu               sync.RWMutex
	agents           map[string]*agentEntry
	events           []*runtimev1.AgentEvent
	sequence         uint64
	nextSubscriberID uint64
	subscribers      map[uint64]*subscriber

	lifeLoopMu     sync.Mutex
	lifeExecutor   LifeTrackExecutor
	lifeLoopCancel context.CancelFunc
	lifeLoopDone   chan struct{}
}

func New(logger *slog.Logger, localStatePath string, memorySvc *memoryservice.Service) (*Service, error) {
	if logger == nil {
		logger = slog.Default()
	}
	if memorySvc == nil {
		return nil, fmt.Errorf("memory service is required")
	}
	svc := &Service{
		logger:       logger,
		memorySvc:    memorySvc,
		statePath:    agentCoreStatePath(localStatePath),
		agents:       make(map[string]*agentEntry),
		events:       make([]*runtimev1.AgentEvent, 0, maxEventLogSize),
		subscribers:  make(map[uint64]*subscriber),
		lifeExecutor: rejectingLifeTrackExecutor{},
	}
	if err := svc.loadState(); err != nil {
		return nil, err
	}
	svc.memorySvc.RegisterReplicationObserver(svc.handleCommittedMemoryReplication)
	return svc, nil
}

func (s *Service) SubscribeAgentEvents(req *runtimev1.SubscribeAgentEventsRequest, stream runtimev1.RuntimeAgentCoreService_SubscribeAgentEventsServer) error {
	filterMap := make(map[runtimev1.AgentEventType]struct{}, len(req.GetEventFilters()))
	for _, filter := range req.GetEventFilters() {
		if filter != runtimev1.AgentEventType_AGENT_EVENT_TYPE_UNSPECIFIED {
			filterMap[filter] = struct{}{}
		}
	}
	cursor, err := decodeCursor(req.GetCursor())
	if err != nil {
		return err
	}
	sub := &subscriber{
		agentID:      strings.TrimSpace(req.GetAgentId()),
		eventFilters: filterMap,
		ch:           make(chan *runtimev1.AgentEvent, subscriberBuffer),
	}
	s.mu.Lock()
	s.nextSubscriberID++
	sub.id = s.nextSubscriberID
	s.subscribers[sub.id] = sub
	backlog := make([]*runtimev1.AgentEvent, 0, len(s.events))
	for _, event := range s.events {
		if event.GetSequence() <= cursor {
			continue
		}
		if subscriberMatchesEvent(sub, event) {
			backlog = append(backlog, cloneAgentEvent(event))
		}
	}
	s.mu.Unlock()
	defer s.removeSubscriber(sub.id)

	for _, event := range backlog {
		if err := stream.Send(event); err != nil {
			return err
		}
	}
	for {
		select {
		case <-stream.Context().Done():
			return stream.Context().Err()
		case event, ok := <-sub.ch:
			if !ok {
				return nil
			}
			if err := stream.Send(cloneAgentEvent(event)); err != nil {
				return err
			}
		}
	}
}

func (s *Service) SetLifeTrackExecutor(executor LifeTrackExecutor) {
	s.lifeLoopMu.Lock()
	defer s.lifeLoopMu.Unlock()
	if executor == nil {
		s.lifeExecutor = rejectingLifeTrackExecutor{}
		return
	}
	s.lifeExecutor = executor
}

func (s *Service) StartLifeTrackLoop(parent context.Context) error {
	if parent == nil {
		parent = context.Background()
	}
	s.lifeLoopMu.Lock()
	defer s.lifeLoopMu.Unlock()
	if s.lifeLoopDone != nil {
		return nil
	}
	ctx, cancel := context.WithCancel(parent)
	done := make(chan struct{})
	s.lifeLoopCancel = cancel
	s.lifeLoopDone = done
	go s.runLifeTrackLoop(ctx, done)
	return nil
}

func (s *Service) StopLifeTrackLoop() {
	s.lifeLoopMu.Lock()
	cancel := s.lifeLoopCancel
	done := s.lifeLoopDone
	s.lifeLoopCancel = nil
	s.lifeLoopDone = nil
	s.lifeLoopMu.Unlock()
	if cancel != nil {
		cancel()
	}
	if done != nil {
		<-done
	}
}

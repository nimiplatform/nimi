package runtimeagent

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"sync/atomic"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
)

const (
	runtimeAgentStateSchemaVersion = 1
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
	runtimev1.UnimplementedRuntimeAgentServiceServer

	logger        *slog.Logger
	memorySvc     *memoryservice.Service
	statePath     string
	backend       *runtimepersistence.Backend
	stateRepo     *runtimeAgentStateRepository
	chatStateRepo *publicChatSurfaceStateRepository
	reviews       reviewPersistence
	postures      behavioralPosturePersistence
	chatAppEmit   publicChatAppMessageEmitter
	aiBridgeMu    sync.RWMutex
	aiBridge      *RuntimePrivateAIBridge

	mu               sync.RWMutex
	agents           map[string]*agentEntry
	events           []*runtimev1.AgentEvent
	sequence         uint64
	nextSubscriberID uint64
	subscribers      map[uint64]*subscriber

	chatSurfaceMu      sync.Mutex
	chatSurfaceVersion uint64
	// chatAnchors holds runtime-owned ConversationAnchor truth keyed by
	// conversation_anchor_id. Per K-AGCORE-034 this is the only admitted
	// cross-surface continuity scope; agent identity is not continuity.
	chatAnchors       map[string]*publicChatAnchorState
	chatTurns         map[string]*publicChatTurnState
	chatFollowUps     map[string]*publicChatFollowUpState
	// chatActiveByAgent tracks the currently-active chat turn per agent.
	// With per-anchor isolation, each agent may still run only one active
	// chat turn at a time across anchors to preserve single-speaker truth.
	chatActiveByAgent map[string]string

	lifeLoopMu     sync.Mutex
	lifeLoopCancel context.CancelFunc
	lifeLoopDone   chan struct{}

	closeOnce sync.Once
	closed    atomic.Bool
}

func New(logger *slog.Logger, localStatePath string, memorySvc *memoryservice.Service) (*Service, error) {
	if logger == nil {
		logger = slog.Default()
	}
	if memorySvc == nil {
		return nil, fmt.Errorf("memory service is required")
	}
	statePath := runtimeAgentStatePath(localStatePath)
	backend := memorySvc.PersistenceBackend()
	stateRepo := newRuntimeAgentStateRepository(backend, statePath)
	svc := &Service{
		logger:            logger,
		memorySvc:         memorySvc,
		statePath:         statePath,
		backend:           backend,
		stateRepo:         stateRepo,
		chatStateRepo:     newPublicChatSurfaceStateRepository(backend, stateRepo),
		reviews:           newReviewPersistence(backend),
		postures:          newBehavioralPosturePersistence(backend),
		aiBridge:          newRuntimePrivateAIBridge(),
		agents:            make(map[string]*agentEntry),
		events:            make([]*runtimev1.AgentEvent, 0, maxEventLogSize),
		subscribers:       make(map[uint64]*subscriber),
		chatAnchors:       make(map[string]*publicChatAnchorState),
		chatTurns:         make(map[string]*publicChatTurnState),
		chatFollowUps:     make(map[string]*publicChatFollowUpState),
		chatActiveByAgent: make(map[string]string),
	}
	if err := svc.loadState(); err != nil {
		return nil, err
	}
	svc.memorySvc.RegisterReplicationObserver(svc.handleCommittedMemoryReplication)
	if err := svc.recoverReviewRuns(context.Background()); err != nil {
		return nil, err
	}
	return svc, nil
}

func (s *Service) Close() {
	if s == nil {
		return
	}
	s.closeOnce.Do(func() {
		s.closed.Store(true)
		s.StopLifeTrackLoop()
		s.shutdownPublicChatSurface()
	})
}

func (s *Service) isClosed() bool {
	return s == nil || s.closed.Load()
}

func (s *Service) SubscribeAgentEvents(req *runtimev1.SubscribeAgentEventsRequest, stream runtimev1.RuntimeAgentService_SubscribeAgentEventsServer) error {
	return s.eventStreamRuntime().subscribe(req, stream)
}

func (s *Service) SetLifeTrackExecutor(executor LifeTrackExecutor) {
	s.setLifeTrackExecutor(executor)
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

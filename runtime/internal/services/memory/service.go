package memory

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
)

const (
	memoryStateSchemaVersion = 1
	defaultHistoryPageSize   = 50
	maxHistoryPageSize       = 200
	defaultBankPageSize      = 50
	maxBankPageSize          = 200
	subscriberBuffer         = 32
)

type persistedMemoryState struct {
	SchemaVersion      int                               `json:"schemaVersion"`
	SavedAt            string                            `json:"savedAt"`
	Sequence           uint64                            `json:"sequence"`
	Banks              []persistedBankState              `json:"banks"`
	ReplicationBacklog []persistedReplicationBacklogItem `json:"replicationBacklog,omitempty"`
}

type persistedBankState struct {
	LocatorKey              string                               `json:"locatorKey"`
	Bank                    json.RawMessage                      `json:"bank"`
	Records                 []json.RawMessage                    `json:"records"`
	PendingEmbeddingCutover *persistedPendingEmbeddingCutoverRef `json:"pendingEmbeddingCutover,omitempty"`
}

type persistedPendingEmbeddingCutoverRef struct {
	GenerationID  string          `json:"generationId,omitempty"`
	TargetProfile json.RawMessage `json:"targetProfile"`
	RevisionToken string          `json:"revisionToken,omitempty"`
}

type pendingEmbeddingCutoverState struct {
	GenerationID  string
	TargetProfile *runtimev1.MemoryEmbeddingProfile
	RevisionToken string
}

type bankState struct {
	Bank                    *runtimev1.MemoryBank
	Records                 map[string]*runtimev1.MemoryRecord
	Order                   []string
	PendingEmbeddingCutover *pendingEmbeddingCutoverState
}

type subscriber struct {
	id              uint64
	scopeFilters    map[runtimev1.MemoryBankScope]struct{}
	ownerFilterKeys map[string]struct{}
	ch              chan *runtimev1.MemoryEvent
}

type replicationObserver struct {
	id      uint64
	handler func(*runtimev1.MemoryEvent)
}

type memoryEventStream interface {
	Context() context.Context
	Send(*runtimev1.MemoryEvent) error
}

type MemoryEmbeddingResolvedProfile struct {
	Profile           *runtimev1.MemoryEmbeddingProfile
	ResolutionState   string
	BlockedReasonCode runtimev1.ReasonCode
}

type MemoryEmbeddingIntentResolver func(context.Context, *runtimev1.MemoryRequestContext, *runtimev1.MemoryBankLocator) (*MemoryEmbeddingTextEmbedIntentSnapshot, error)
type MemoryEmbeddingProfileResolver func(context.Context, *MemoryEmbeddingTextEmbedIntentSnapshot) MemoryEmbeddingResolvedProfile
type MemoryEmbeddingVectorExecutor func(context.Context, *runtimev1.MemoryEmbeddingProfile, []string) ([][]float64, error)
type MemoryEmbeddingTargetAuthorizer func(context.Context, *runtimev1.MemoryRequestContext, *runtimev1.MemoryBankLocator) error

// @nimi-authority: definition.nimi.runtime.memory-world.canonical-memory-plane
// @nimi-authority: rule.nimi.runtime.memory-world.r001
type Service struct {
	logger    *slog.Logger
	statePath string
	backend   *runtimepersistence.Backend
	now       func() time.Time
	closeOnce sync.Once
	closeErr  error

	mu                      sync.RWMutex
	banks                   map[string]*bankState
	replicationBacklog      map[string]*ReplicationBacklogItem
	managedEmbeddingProfile *runtimev1.MemoryEmbeddingProfile
	sequence                uint64
	nextSubscriberID        uint64
	subscribers             map[uint64]*subscriber
	nextObserverID          uint64
	observers               map[uint64]func(*runtimev1.MemoryEvent)

	replicationLoopMu        sync.Mutex
	replicationBridgeAdapter ReplicationBridgeAdapter
	replicationLoopCancel    context.CancelFunc
	replicationLoopDone      chan struct{}

	acceleratorCleanupMu       sync.Mutex
	lastAcceleratorCleanupAt   time.Time
	acceleratorCleanupCooldown time.Duration
	runtimeEmbeddingIntent     MemoryEmbeddingIntentResolver
	runtimeEmbeddingResolver   MemoryEmbeddingProfileResolver
	runtimeEmbeddingExecutor   MemoryEmbeddingVectorExecutor
	embeddingTargetAuthorizer  MemoryEmbeddingTargetAuthorizer

	embeddingLifecycleMu     sync.Mutex
	embeddingLifecycleCtx    context.Context
	embeddingLifecycleCancel context.CancelFunc
	embeddingInflight        sync.WaitGroup
	embeddingClosing         bool
}

func New(logger *slog.Logger, cfg config.Config) (*Service, error) {
	if logger == nil {
		logger = slog.Default()
	}
	backend, err := runtimepersistence.Open(logger, cfg.LocalStatePath)
	if err != nil {
		return nil, err
	}
	embeddingLifecycleCtx, embeddingLifecycleCancel := context.WithCancel(context.Background())
	svc := &Service{
		logger:                     logger,
		statePath:                  memoryStatePath(cfg.LocalStatePath),
		backend:                    backend,
		now:                        time.Now,
		banks:                      make(map[string]*bankState),
		replicationBacklog:         make(map[string]*ReplicationBacklogItem),
		subscribers:                make(map[uint64]*subscriber),
		observers:                  make(map[uint64]func(*runtimev1.MemoryEvent)),
		replicationBridgeAdapter:   unavailableReplicationBridgeAdapter{},
		acceleratorCleanupCooldown: time.Minute,
		embeddingLifecycleCtx:      embeddingLifecycleCtx,
		embeddingLifecycleCancel:   embeddingLifecycleCancel,
	}
	if err := svc.loadState(); err != nil {
		return nil, err
	}
	svc.runAcceleratorCleanupBestEffort(context.Background())
	return svc, nil
}

func (s *Service) SubscribeMemoryEvents(req *runtimev1.SubscribeMemoryEventsRequest, stream memoryEventStream) error {
	sub := s.addSubscriber(req)
	defer s.removeSubscriber(sub.id)
	for {
		select {
		case <-stream.Context().Done():
			return stream.Context().Err()
		case event, ok := <-sub.ch:
			if !ok {
				return nil
			}
			if err := stream.Send(cloneEvent(event)); err != nil {
				return err
			}
		}
	}
}

func (s *Service) Close() error {
	if s == nil {
		return nil
	}
	s.closeOnce.Do(func() {
		s.closeMemoryEmbeddingAdmissions()
		s.StopReplicationLoop()
		s.embeddingInflight.Wait()
		if s.backend != nil {
			s.closeErr = s.backend.Close()
		}
	})
	return s.closeErr
}

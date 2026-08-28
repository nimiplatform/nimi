package runtimeagent

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	aicatalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/aiconfig"
	"github.com/nimiplatform/nimi/runtime/internal/aiprofile"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	"github.com/nimiplatform/nimi/runtime/internal/services/cognitionmemory"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"github.com/nimiplatform/nimi/runtime/internal/services/delegation"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
)

const (
	runtimeAgentStateSchemaVersion = 1
	defaultAgentPageSize           = 50
	maxAgentPageSize               = 200
	defaultHookPageSize            = 50
	maxHookPageSize                = 200
	maxEventLogSize                = 256
	subscriberBuffer               = 32
)

type agentEntry struct {
	Agent *runtimev1.LocalAgentRecord
	State *runtimev1.AgentStateProjection
	Hooks map[string]*runtimev1.PendingHook
}

type subscriber struct {
	id                    uint64
	agentID               string
	eventFilters          map[runtimev1.AgentEventType]struct{}
	bundledAvatarIdentity *localAgentIdentity
	ch                    chan *runtimev1.AgentEvent
	mu                    sync.Mutex
	closed                bool
}

type runtimeAccountProjectionProvider interface {
	AuthenticatedRuntimeProjection(context.Context) (*runtimev1.AccountProjection, bool)
}

// @nimi-authority: definition.nimi.runtime.agent-service.agent-service-plane
type Service struct {
	runtimev1.UnimplementedRuntimeAgentServiceServer

	logger                                   *slog.Logger
	backend                                  *runtimepersistence.Backend
	stateRepo                                *runtimeAgentStateRepository
	chatStateRepo                            *publicChatSurfaceStateRepository
	postures                                 behavioralPosturePersistence
	realmSourceMaterializationRepoV3         *realmSourceMaterializationRepositoryV3
	realmSourceSnapshotStoreV2               *realmSourceSnapshotV2Store
	realmSourceMaterializationIssuerV3       RealmSourceMaterializationIssuer
	realmSourceMaterializationRequestLocksV3 *realmSourceMaterializationRequestLocksV3
	realmSourceMaterializationStagingV3      *realmSourceMaterializationStagingV3
	sourceMaterializationMu                  sync.RWMutex
	sourceMaterializationRuntimeInstance     string
	publicChatSourceSnapshotResolve          func(context.Context, string) (localAgentSourceSnapshotV2, bool, error)
	sourceMaterializationNow                 func() time.Time
	chatAppEmit                              publicChatAppMessageEmitter
	runtimeAccountProjection                 runtimeAccountProjectionProvider
	realmCharacterPublicAvatar               realmCharacterPublicAvatarResolver
	localAppIngressRevalidator               localAppIngressRevalidator
	localAppConversationMu                   sync.Mutex
	localAppConversationPublishMu            sync.Mutex
	localAppConversationNextSubscriberID     uint64
	localAppConversationSubscribers          map[uint64]*localAppConversationSubscriber
	localAppConversationLiveChildren         map[string]localAppConversationLiveChildState
	agentRealtimeMu                          sync.RWMutex
	agentRealtimeAI                          agentRealtimeAIExecutor
	agentRealtimeSessions                    map[string]*localAppAgentRealtimeSession
	localAppAgentDisplayAvatarCacheMu        sync.Mutex
	localAppAgentDisplayAvatarCache          map[localAppAgentDisplayAvatarCacheKey]localAppAgentDisplayAvatarCacheEntry
	localAppAgentDisplayAvatarLookups        map[localAppAgentDisplayAvatarCacheKey]*localAppAgentDisplayAvatarLookup
	localAppAgentAvatarCacheMu               sync.Mutex
	localAppAgentAvatarCache                 map[localAppAgentAvatarCacheKey]string
	localAppAgentAvatarLookups               map[localAppAgentAvatarCacheKey]*localAppAgentAvatarLookup
	voiceAssetResolverMu                     sync.RWMutex
	voiceAssetResolver                       VoiceAssetResolver
	sourceCognitionBridge                    sourceCognitionBridge
	sourceCognitionLifecycleMu               sync.Mutex
	sourceCognitionLifecycleCtx              context.Context
	sourceCognitionLifecycleCancel           context.CancelFunc
	sourceCognitionWG                        sync.WaitGroup
	sourceCognitionJobs                      map[string]struct{}
	cognitionMemoryStore                     *cognitionmemory.Store
	cognitionMemoryBridge                    *cognitionmemory.Bridge
	cognitionMemoryFacade                    *cognitionmemory.Facade
	cognitionMemoryTermination               *cognitionmemory.TerminationService
	cognitionMemoryLifecycleCtx              context.Context
	cognitionMemoryLifecycleCancel           context.CancelFunc
	cognitionMemoryWG                        sync.WaitGroup
	aiBridgeMu                               sync.RWMutex
	aiBridge                                 *RuntimePrivateAIBridge
	machineExecutionBindingMu                sync.RWMutex
	machineExecutionBindingResolver          machineExecutionBindingResolver
	localExecution                           localexecution.Resolver
	aiConfigStore                            aiconfig.Store
	aiProfileStore                           aiprofile.Store
	connectorStore                           *connector.ConnectorStore
	modelCatalog                             *aicatalog.Resolver
	sharedPresetVoices                       sharedLocalAgentPresetVoiceResolver
	auditStore                               *auditlog.Store
	delegatedMu                              sync.RWMutex
	delegatedGateway                         delegatedCapabilityGateway
	delegatedFirewall                        delegatedOutputFirewall
	delegatedProviderProfiles                map[string]*runtimev1.DelegatedProviderProfile
	delegatedApprovalRequests                map[string]*runtimev1.DelegatedApprovalRequest
	delegatedPausedRequests                  map[string]*runtimeAgentPausedDelegatedCapabilityRequest
	// voiceLipsync is the K-AGCORE-051/K-VOICE-018 synthesizer path. Default
	// synthetic output is frame-only and cannot become a playable voice event.
	voiceLipsync voiceLipsyncSynthesizer
	// voiceTranscription is the first-party recorded voice ingress executor.
	// Runtime Agent resolves shared LocalAgent AIConfig inputs before invoking
	// it; callers never supply execution routing or machine selection.
	voiceTranscription agentVoiceTranscriptionScenarioExecutor
	// runtimeArtifacts is the runtime-owned by-id artifact byte store. Any
	// runtime event carrying an artifact id must put bytes here before emit.
	runtimeArtifacts  runtimeartifact.Store
	agentVoiceStreams *agentVoiceStreamBroker

	mu               sync.RWMutex
	agents           map[string]*agentEntry
	turnSourceViews  map[string]localAgentTurnSourceViewV1
	events           []*runtimev1.AgentEvent
	sequence         uint64
	nextSubscriberID uint64
	subscribers      map[uint64]*subscriber

	chatSurfaceMu      sync.Mutex
	chatSurfaceVersion uint64
	// chatAnchors stores Runtime-issued continuity tokens. Open resolution
	// converges on one resumable anchor per (owner_user_id, local_agent_ref).
	chatAnchors   map[string]*publicChatAnchorState
	chatTurns     map[string]*publicChatTurnState
	chatFollowUps map[string]*publicChatFollowUpState
	// avatarLiveInstanceBindings maps explicit Avatar window instances to
	// Runtime-owned ConversationAnchor ids. It lets late-joining Avatar windows
	// recover Desktop's current anchor without widening launch payload truth.
	avatarLiveInstanceBindings map[string]*avatarLiveInstanceBindingState
	// chatActiveByAgent tracks the currently-active chat turn per agent.
	// With per-anchor isolation, each agent may still run only one active
	// chat turn at a time across anchors to preserve single-speaker truth.
	chatActiveByAgent           map[string]string
	chatTerminatingAgents       map[string]uint32
	chatAsyncWG                 sync.WaitGroup
	chatAsyncLifecycleCtx       context.Context
	chatAsyncLifecycleCancel    context.CancelFunc
	chatConversationSummaryJobs map[string]*publicChatConversationSummaryJob
	// chatFollowUpWait is an injectable scheduling boundary. Production uses
	// the wall clock; deterministic owner tests replace it before arming any
	// follow-up so scheduling assertions never depend on host contention.
	chatFollowUpWait func(context.Context, time.Time) bool

	lifeLoopMu     sync.Mutex
	lifeLoopCancel context.CancelFunc
	lifeLoopDone   chan struct{}

	closeOnce sync.Once
	closed    atomic.Bool
}

func NewWithBackend(logger *slog.Logger, localStatePath string, backend *runtimepersistence.Backend) (*Service, error) {
	if backend == nil {
		return nil, fmt.Errorf("Runtime persistence backend is required")
	}
	return newWithBackend(logger, localStatePath, backend)
}

func newWithBackend(logger *slog.Logger, localStatePath string, backend *runtimepersistence.Backend) (*Service, error) {
	if logger == nil {
		logger = slog.Default()
	}
	delegatedFirewall, err := delegation.NewFirewall(delegation.FirewallPolicy{})
	if err != nil {
		return nil, err
	}
	stateRepo := newRuntimeAgentStateRepository(backend)
	realmSourceMaterializationRepoV3 := newRealmSourceMaterializationRepositoryV3(backend)
	if err := realmSourceMaterializationRepoV3.recoverStartup(context.Background(), time.Now().UTC()); err != nil {
		return nil, fmt.Errorf("recover Realm source materialization v3 state: %w", err)
	}
	realmSourceMaterializationStagingV3, err := newRealmSourceMaterializationStagingV3(backend.Path())
	if err != nil {
		return nil, err
	}
	if err := realmSourceMaterializationStagingV3.recoverStartup(); err != nil {
		return nil, err
	}
	realmSourceSnapshotStoreV2, err := newRealmSourceSnapshotV2Store(backend.DB())
	if err != nil {
		return nil, err
	}
	chatAsyncLifecycleCtx, chatAsyncLifecycleCancel := context.WithCancel(context.Background())
	sourceCognitionLifecycleCtx, sourceCognitionLifecycleCancel := context.WithCancel(context.Background())
	cognitionMemoryLifecycleCtx, cognitionMemoryLifecycleCancel := context.WithCancel(context.Background())
	svc := &Service{
		logger:                                   logger,
		backend:                                  backend,
		stateRepo:                                stateRepo,
		chatStateRepo:                            newPublicChatSurfaceStateRepository(backend, stateRepo),
		postures:                                 newBehavioralPosturePersistence(backend),
		realmSourceMaterializationRepoV3:         realmSourceMaterializationRepoV3,
		realmSourceSnapshotStoreV2:               realmSourceSnapshotStoreV2,
		realmSourceMaterializationRequestLocksV3: newRealmSourceMaterializationRequestLocksV3(),
		realmSourceMaterializationStagingV3:      realmSourceMaterializationStagingV3,
		publicChatSourceSnapshotResolve:          realmSourceSnapshotStoreV2.sourceSnapshot,
		sourceMaterializationNow:                 func() time.Time { return time.Now().UTC() },
		voiceAssetResolver:                       rejectingVoiceAssetResolver{},
		aiBridge:                                 newRuntimePrivateAIBridge(),
		delegatedFirewall:                        delegatedFirewall,
		agents:                                   make(map[string]*agentEntry),
		turnSourceViews:                          make(map[string]localAgentTurnSourceViewV1),
		events:                                   make([]*runtimev1.AgentEvent, 0, maxEventLogSize),
		subscribers:                              make(map[uint64]*subscriber),
		chatAnchors:                              make(map[string]*publicChatAnchorState),
		chatTurns:                                make(map[string]*publicChatTurnState),
		chatFollowUps:                            make(map[string]*publicChatFollowUpState),
		avatarLiveInstanceBindings:               make(map[string]*avatarLiveInstanceBindingState),
		chatActiveByAgent:                        make(map[string]string),
		chatTerminatingAgents:                    make(map[string]uint32),
		chatConversationSummaryJobs:              make(map[string]*publicChatConversationSummaryJob),
		chatAsyncLifecycleCtx:                    chatAsyncLifecycleCtx,
		chatAsyncLifecycleCancel:                 chatAsyncLifecycleCancel,
		sourceCognitionLifecycleCtx:              sourceCognitionLifecycleCtx,
		sourceCognitionLifecycleCancel:           sourceCognitionLifecycleCancel,
		sourceCognitionJobs:                      make(map[string]struct{}),
		cognitionMemoryLifecycleCtx:              cognitionMemoryLifecycleCtx,
		cognitionMemoryLifecycleCancel:           cognitionMemoryLifecycleCancel,
		localAppConversationSubscribers:          make(map[uint64]*localAppConversationSubscriber),
		localAppConversationLiveChildren:         make(map[string]localAppConversationLiveChildState),
		agentRealtimeSessions:                    make(map[string]*localAppAgentRealtimeSession),
		voiceLipsync:                             newSyntheticVoiceLipsyncSynthesizer(),
		runtimeArtifacts:                         runtimeartifact.NewMemoryStore(),
		agentVoiceStreams:                        newAgentVoiceStreamBroker(),
		delegatedProviderProfiles:                make(map[string]*runtimev1.DelegatedProviderProfile),
		delegatedApprovalRequests:                make(map[string]*runtimev1.DelegatedApprovalRequest),
		delegatedPausedRequests:                  make(map[string]*runtimeAgentPausedDelegatedCapabilityRequest),
	}
	if err := svc.loadState(); err != nil {
		return nil, err
	}
	if err := svc.recoverPresentationAssetStore(context.Background()); err != nil {
		return nil, fmt.Errorf("recover presentation asset store: %w", err)
	}
	if err := realmSourceSnapshotStoreV2.validatePersistedSnapshots(context.Background()); err != nil {
		return nil, fmt.Errorf("validate persisted Realm source SnapshotV2 state: %w", err)
	}
	if err := svc.validateLoadedSourceSnapshotBindings(context.Background()); err != nil {
		return nil, fmt.Errorf("validate loaded source snapshot bindings: %w", err)
	}
	if err := svc.loadDelegatedControlStateFromDB(); err != nil {
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
		s.sourceCognitionLifecycleMu.Lock()
		if s.sourceCognitionLifecycleCancel != nil {
			s.sourceCognitionLifecycleCancel()
		}
		s.sourceCognitionLifecycleMu.Unlock()
		s.sourceCognitionWG.Wait()
		if s.cognitionMemoryLifecycleCancel != nil {
			s.cognitionMemoryLifecycleCancel()
		}
		s.cognitionMemoryWG.Wait()
		s.StopLifeTrackLoop()
		s.shutdownAgentRealtime()
		s.shutdownPublicChatSurface()
	})
}

func (s *Service) isClosed() bool {
	return s == nil || s.closed.Load()
}

func (s *Service) SubscribeAgentEvents(req *runtimev1.SubscribeAgentEventsRequest, stream runtimev1.RuntimeAgentService_SubscribeAgentEventsServer) error {
	return s.eventStreamRuntime().subscribe(req, stream)
}

func (s *Service) SetAuditStore(store *auditlog.Store) {
	if s == nil {
		return
	}
	s.auditStore = store
}

func (s *Service) SetLifeTrackExecutor(executor LifeTrackExecutor) {
	s.setLifeTrackExecutor(executor)
}

// SetSourceMaterializationRuntimeIdentity binds private Realm Packet requests
// to the canonical configured Runtime identity. Materialization RPCs fail
// closed until the manager wires Config.RuntimeID through this method. A
// changed identity invalidates only unfinished acquisition state; committed
// snapshots and agents remain immutable product truth.
func (s *Service) SetSourceMaterializationRuntimeIdentity(runtimeInstanceID string) error {
	if s == nil || s.realmSourceMaterializationRepoV3 == nil {
		return fmt.Errorf("source materialization service is unavailable")
	}
	if runtimeInstanceID == "" || runtimeInstanceID != strings.TrimSpace(runtimeInstanceID) {
		return fmt.Errorf("source materialization runtime identity is required")
	}
	now := s.sourceMaterializationClock()()
	s.sourceMaterializationMu.Lock()
	defer s.sourceMaterializationMu.Unlock()
	if err := s.realmSourceMaterializationRepoV3.bindRuntimeInstance(context.Background(), runtimeInstanceID, now); err != nil {
		return err
	}
	s.sourceMaterializationRuntimeInstance = runtimeInstanceID
	return nil
}

// SetRealmSourceMaterializationIssuer installs the Runtime-private account /
// Realm acquisition owner. Public callers never select this issuer or provide
// any Realm transport, bearer, grant, Packet, proof or key material.
func (s *Service) SetRealmSourceMaterializationIssuer(issuer RealmSourceMaterializationIssuer) {
	if s == nil {
		return
	}
	s.sourceMaterializationMu.Lock()
	s.realmSourceMaterializationIssuerV3 = issuer
	s.sourceMaterializationMu.Unlock()
}

func (s *Service) sourceMaterializationClock() func() time.Time {
	if s == nil {
		return func() time.Time { return time.Now().UTC() }
	}
	s.sourceMaterializationMu.RLock()
	nowFn := s.sourceMaterializationNow
	s.sourceMaterializationMu.RUnlock()
	if nowFn == nil {
		return func() time.Time { return time.Now().UTC() }
	}
	return nowFn
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

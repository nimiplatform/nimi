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
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/providerhealth"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	"github.com/nimiplatform/nimi/runtime/internal/services/delegation"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
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
	Agent *runtimev1.AgentRecord
	State *runtimev1.AgentStateProjection
	Hooks map[string]*runtimev1.PendingHook
}

type subscriber struct {
	id            uint64
	agentID       string
	eventFilters  map[runtimev1.AgentEventType]struct{}
	scopedBinding *runtimev1.ScopedRuntimeBindingAttachment
	ch            chan *runtimev1.AgentEvent
	mu            sync.Mutex
	closed        bool
}

type scopedBindingValidator interface {
	ValidateScopedBinding(bindingID string, actual *runtimev1.ScopedAppBindingRelation, requiredScope string) (runtimev1.AccountReasonCode, bool)
}

type scopedBindingRelationResolver interface {
	ResolveScopedBindingRelation(bindingID string) *runtimev1.ScopedAppBindingRelation
}

type Service struct {
	runtimev1.UnimplementedRuntimeAgentServiceServer

	logger                                   *slog.Logger
	memorySvc                                *memoryservice.Service
	backend                                  *runtimepersistence.Backend
	stateRepo                                *runtimeAgentStateRepository
	chatStateRepo                            *publicChatSurfaceStateRepository
	reviews                                  reviewPersistence
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
	bindingValidator                         scopedBindingValidator
	voiceAssetResolverMu                     sync.RWMutex
	voiceAssetResolver                       VoiceAssetResolver
	aiBridgeMu                               sync.RWMutex
	aiBridge                                 *RuntimePrivateAIBridge
	auditStore                               *auditlog.Store
	delegatedMu                              sync.RWMutex
	delegatedGateway                         delegatedCapabilityGateway
	delegatedFirewall                        delegatedOutputFirewall
	delegatedTransportFactory                delegation.TransportFactory
	delegatedProviderProfiles                map[string]*runtimev1.DelegatedProviderProfile
	delegatedApprovalRequests                map[string]*runtimev1.DelegatedApprovalRequest
	delegatedPausedRequests                  map[string]*runtimeAgentPausedDelegatedCapabilityRequest
	// voiceLipsync is the K-AGCORE-051/K-VOICE-018 synthesizer path. Default
	// synthetic output is frame-only and cannot become a playable voice event.
	voiceLipsync voiceLipsyncSynthesizer
	// runtimeArtifacts is the runtime-owned by-id artifact byte store. Any
	// runtime event carrying an artifact id must put bytes here before emit.
	runtimeArtifacts  runtimeartifact.Store
	agentVoiceStreams *agentVoiceStreamBroker

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
	chatActiveByAgent map[string]string
	chatAsyncWG       sync.WaitGroup

	realmGroupCandidateMu          sync.RWMutex
	realmGroupCandidateExecutor    RealmGroupMessageCandidateExecutor
	realmGroupCandidates           map[string]*realmGroupMessageCandidateEvidenceRecord
	realmGroupCandidateIdempotency map[string]string
	memoryPromotionEvidence        map[string]runtimeMemoryPromotionEvidence

	// participationState is the K-AGCORE-061..088 participation record store
	// (lazy-initialized through participationStore()); audit/replay lineage
	// stays in auditStore per K-AGCORE-087.
	participationOnce  sync.Once
	participationState *participationStore

	// K-AGCORE-144..150 Runtime Agent AI Config domain. agentAIConfigMu
	// serializes mutations (the repository CAS re-checks inside the write tx);
	// agentAIConfigReadiness holds the last computed K-AGCORE-146 projection per
	// Runtime Local Agent instance.
	agentAIConfigMu   sync.Mutex
	agentAIConfigRepo *agentAgentAIConfigRepository

	agentAIConfigReadinessMu sync.RWMutex
	agentAIConfigReadiness   map[string]*runtimev1.RuntimeAgentAIConfigReadinessSnapshot

	execSubMu     sync.Mutex
	execNextSubID uint64
	execSubs      map[uint64]runtimeAgentAIConfigReadinessSubscriber

	execHealthMu      sync.Mutex
	execHealthTracker *providerhealth.Tracker
	execHealthCancel  func()
	execHealthDone    chan struct{}

	// execPendingAIConfigAudits parks Runtime Agent AI Config audit records
	// when a seed or mutation commits before the audit store attaches;
	// SetAuditStore flushes them in commit order.
	execAuditMu               sync.Mutex
	execPendingAIConfigAudits []*runtimev1.AuditEventRecord

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
	delegatedGateway, err := delegation.NewGateway(nil)
	if err != nil {
		return nil, err
	}
	delegatedFirewall, err := delegation.NewFirewall(delegation.FirewallPolicy{})
	if err != nil {
		return nil, err
	}
	backend := memorySvc.PersistenceBackend()
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
	svc := &Service{
		logger:                                   logger,
		memorySvc:                                memorySvc,
		backend:                                  backend,
		stateRepo:                                stateRepo,
		chatStateRepo:                            newPublicChatSurfaceStateRepository(backend, stateRepo),
		agentAIConfigRepo:                        newAgentAgentAIConfigRepository(backend),
		agentAIConfigReadiness:                   make(map[string]*runtimev1.RuntimeAgentAIConfigReadinessSnapshot),
		execSubs:                                 make(map[uint64]runtimeAgentAIConfigReadinessSubscriber),
		reviews:                                  newReviewPersistence(backend),
		postures:                                 newBehavioralPosturePersistence(backend),
		realmSourceMaterializationRepoV3:         realmSourceMaterializationRepoV3,
		realmSourceSnapshotStoreV2:               realmSourceSnapshotStoreV2,
		realmSourceMaterializationRequestLocksV3: newRealmSourceMaterializationRequestLocksV3(),
		realmSourceMaterializationStagingV3:      realmSourceMaterializationStagingV3,
		publicChatSourceSnapshotResolve:          realmSourceSnapshotStoreV2.sourceSnapshot,
		sourceMaterializationNow:                 func() time.Time { return time.Now().UTC() },
		voiceAssetResolver:                       rejectingVoiceAssetResolver{},
		aiBridge:                                 newRuntimePrivateAIBridge(),
		delegatedGateway:                         delegatedGateway,
		delegatedFirewall:                        delegatedFirewall,
		agents:                                   make(map[string]*agentEntry),
		events:                                   make([]*runtimev1.AgentEvent, 0, maxEventLogSize),
		subscribers:                              make(map[uint64]*subscriber),
		chatAnchors:                              make(map[string]*publicChatAnchorState),
		chatTurns:                                make(map[string]*publicChatTurnState),
		chatFollowUps:                            make(map[string]*publicChatFollowUpState),
		avatarLiveInstanceBindings:               make(map[string]*avatarLiveInstanceBindingState),
		chatActiveByAgent:                        make(map[string]string),
		realmGroupCandidates:                     make(map[string]*realmGroupMessageCandidateEvidenceRecord),
		realmGroupCandidateIdempotency:           make(map[string]string),
		memoryPromotionEvidence:                  make(map[string]runtimeMemoryPromotionEvidence),
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
	if err := realmSourceSnapshotStoreV2.validatePersistedSnapshots(context.Background()); err != nil {
		return nil, fmt.Errorf("validate persisted Realm source SnapshotV2 state: %w", err)
	}
	if err := svc.validateLoadedSourceSnapshotBindings(context.Background()); err != nil {
		return nil, fmt.Errorf("validate loaded source snapshot bindings: %w", err)
	}
	if err := svc.seedRuntimeAgentAIConfigsForLoadedAgents(); err != nil {
		return nil, err
	}
	if err := svc.loadRealmGroupMessageCandidateStateFromDB(); err != nil {
		return nil, err
	}
	if err := svc.loadDelegatedControlStateFromDB(); err != nil {
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
		s.stopAgentAIConfigReadinessHealthSubscription()
		s.shutdownPublicChatSurface()
	})
}

func (s *Service) isClosed() bool {
	return s == nil || s.closed.Load()
}

func (s *Service) SubscribeAgentEvents(req *runtimev1.SubscribeAgentEventsRequest, stream runtimev1.RuntimeAgentService_SubscribeAgentEventsServer) error {
	return s.eventStreamRuntime().subscribe(req, stream)
}

func (s *Service) SetScopedBindingValidator(validator scopedBindingValidator) {
	s.bindingValidator = validator
}

func (s *Service) SetAuditStore(store *auditlog.Store) {
	if s == nil {
		return
	}
	s.execAuditMu.Lock()
	s.auditStore = store
	s.execAuditMu.Unlock()
	s.flushPendingAgentAIConfigAudit()
}

func (s *Service) SetLifeTrackExecutor(executor LifeTrackExecutor) {
	s.setLifeTrackExecutor(executor)
}

func (s *Service) SetRealmGroupMessageCandidateExecutor(executor RealmGroupMessageCandidateExecutor) {
	if s == nil {
		return
	}
	s.realmGroupCandidateMu.Lock()
	defer s.realmGroupCandidateMu.Unlock()
	s.realmGroupCandidateExecutor = executor
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

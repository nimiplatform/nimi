package localruntime

import (
	"context"
	"log/slog"
	"sync"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
)

const (
	defaultLocalRuntimeEndpoint = "http://127.0.0.1:1234/v1"
	defaultServiceEndpoint      = "http://127.0.0.1:8080"
	defaultLocalAuditCapacity   = 5000
	localRuntimeAuditDomain     = "runtime.local_runtime"
)

// EngineManager is the interface the service uses to interact with the engine subsystem.
// Defined here to avoid a hard import cycle with the engine package.
type EngineManager interface {
	ListEngines() []EngineInfo
	EnsureEngine(ctx context.Context, engine string, version string) error
	StartEngine(ctx context.Context, engine string, port int, version string) error
	StopEngine(engine string) error
	EngineStatus(engine string) (EngineInfo, error)
}

// EngineInfo holds engine status data returned by the manager.
type EngineInfo struct {
	Engine              string
	Version             string
	Endpoint            string
	Port                int
	Status              string
	PID                 int
	Platform            string
	BinaryPath          string
	BinarySizeBytes     int64
	StartedAt           string
	LastHealthyAt       string
	ConsecutiveFailures int
}

// Service implements RuntimeLocalRuntimeService with persisted local-runtime state.
type Service struct {
	runtimev1.UnimplementedRuntimeLocalRuntimeServiceServer

	logger                  *slog.Logger
	auditStore              *auditlog.Store
	stateStorePath          string
	localAuditCap           int
	localModelsPath         string
	localAIModelsConfigPath string
	localAIManaged          bool

	mu                   sync.RWMutex
	models               map[string]*runtimev1.LocalModelRecord
	services             map[string]*runtimev1.LocalServiceDescriptor
	audits               []*runtimev1.LocalAuditEvent
	verified             []*runtimev1.LocalVerifiedModelDescriptor
	catalog              []*runtimev1.LocalCatalogModelDescriptor
	engineMgr            EngineManager
	localAIRegistrations map[string]localAIRegistration
	warmedModelKeys      map[string]struct{}

	endpointProbe     endpointProbeFunc
	hfCatalogSearch   hfCatalogSearchFunc
	modelProbeState   map[string]*probeRecoveryState
	serviceProbeState map[string]*probeRecoveryState
	recoveryCancel    context.CancelFunc
	recoveryDone      chan struct{}
}

func New(logger *slog.Logger, store *auditlog.Store, stateStorePath string, localAuditCapacity int) *Service {
	if logger == nil {
		logger = slog.Default()
	}
	if localAuditCapacity <= 0 {
		localAuditCapacity = defaultLocalAuditCapacity
	}
	verified := defaultVerifiedModels()
	svc := &Service{
		logger:                  logger,
		auditStore:              store,
		stateStorePath:          resolveLocalRuntimeStatePath(stateStorePath),
		localAuditCap:           localAuditCapacity,
		localModelsPath:         resolveLocalModelsPath(""),
		localAIModelsConfigPath: resolveGeneratedLocalAIModelsConfigPath(""),
		models:                  make(map[string]*runtimev1.LocalModelRecord),
		services:                make(map[string]*runtimev1.LocalServiceDescriptor),
		audits:                  make([]*runtimev1.LocalAuditEvent, 0, localAuditCapacity),
		verified:                verified,
		catalog:                 defaultCatalogFromVerified(verified),
		localAIRegistrations:    make(map[string]localAIRegistration),
		warmedModelKeys:         make(map[string]struct{}),
		endpointProbe:           defaultEndpointProbe,
		hfCatalogSearch:         defaultHFCatalogSearch,
		modelProbeState:         make(map[string]*probeRecoveryState),
		serviceProbeState:       make(map[string]*probeRecoveryState),
	}
	svc.restoreState()
	svc.startRecoveryLoop()
	return svc
}

func (s *Service) effectiveLocalAuditCapacity() int {
	capacity := s.localAuditCap
	if capacity <= 0 {
		return defaultLocalAuditCapacity
	}
	return capacity
}

func (s *Service) Close() {
	s.mu.Lock()
	cancel := s.recoveryCancel
	done := s.recoveryDone
	s.recoveryCancel = nil
	s.recoveryDone = nil
	s.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	if done != nil {
		<-done
	}
}

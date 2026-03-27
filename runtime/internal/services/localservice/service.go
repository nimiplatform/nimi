package localservice

import (
	"context"
	"log/slog"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
)

const (
	defaultLocalEndpoint      = "http://127.0.0.1:1234/v1"
	defaultMediaEndpoint      = "http://127.0.0.1:8321/v1"
	defaultSpeechEndpoint     = "http://127.0.0.1:8330/v1"
	defaultServiceEndpoint    = "http://127.0.0.1:8080"
	defaultLocalAuditCapacity = 5000
	localAuditDomain          = "runtime.local_runtime"
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
type EngineInfo = engine.EngineInfoDTO

// Service implements RuntimeLocalService with persisted local state.
type Service struct {
	runtimev1.UnimplementedRuntimeLocalServiceServer

	logger                         *slog.Logger
	auditStore                     *auditlog.Store
	stateStorePath                 string
	localAuditCap                  int
	localModelsPath                string
	managedLlamaModelsConfigPath   string
	managedLlamaEnabled            bool
	managedLlamaEndpointValue      string
	managedMediaEndpointValue      string
	managedSpeechEndpointValue     string
	managedMediaBackendConfigured  bool
	managedMediaBackendHealthy     bool
	managedMediaBackendAddress     string
	managedMediaBackendStatus      runtimev1.LocalServiceStatus
	managedMediaBackendDetail      string
	managedMediaBackendInstalledAt string
	managedMediaBackendUpdatedAt   string

	mu                        sync.RWMutex
	models                    map[string]*runtimev1.LocalModelRecord
	modelRuntimeModes         map[string]runtimev1.LocalEngineRuntimeMode
	artifacts                 map[string]*runtimev1.LocalArtifactRecord
	services                  map[string]*runtimev1.LocalServiceDescriptor
	serviceRuntimeModes       map[string]runtimev1.LocalEngineRuntimeMode
	audits                    []*runtimev1.LocalAuditEvent
	verified                  []*runtimev1.LocalVerifiedModelDescriptor
	verifiedArtifacts         []*runtimev1.LocalVerifiedArtifactDescriptor
	catalog                   []*runtimev1.LocalCatalogModelDescriptor
	engineMgr                 EngineManager
	managedLlamaRegistrations map[string]managedLlamaRegistration
	warmedModelKeys           map[string]struct{}
	warmedModelOrder          []string

	endpointProbe                endpointProbeFunc
	hfCatalogSearch              hfCatalogSearchFunc
	hfDownloadBaseURL            string
	artifactDownloadTimeout      time.Duration
	artifactDownloadMaxBodyBytes int64
	modelProbeState              map[string]*probeRecoveryState
	serviceProbeState            map[string]*probeRecoveryState
	recoveryCancel               context.CancelFunc
	recoveryDone                 chan struct{}
}

func New(logger *slog.Logger, store *auditlog.Store, stateStorePath string, localAuditCapacity int) (*Service, error) {
	if logger == nil {
		logger = slog.Default()
	}
	if localAuditCapacity <= 0 {
		localAuditCapacity = defaultLocalAuditCapacity
	}
	verified := defaultVerifiedModels()
	verifiedArtifacts := defaultVerifiedArtifacts()
	svc := &Service{
		logger:                       logger,
		auditStore:                   store,
		stateStorePath:               resolveLocalStatePath(stateStorePath),
		localAuditCap:                localAuditCapacity,
		localModelsPath:              resolveLocalModelsPath(""),
		managedLlamaModelsConfigPath: resolveGeneratedLlamaModelsConfigPath(""),
		models:                       make(map[string]*runtimev1.LocalModelRecord),
		modelRuntimeModes:            make(map[string]runtimev1.LocalEngineRuntimeMode),
		artifacts:                    make(map[string]*runtimev1.LocalArtifactRecord),
		services:                     make(map[string]*runtimev1.LocalServiceDescriptor),
		serviceRuntimeModes:          make(map[string]runtimev1.LocalEngineRuntimeMode),
		audits:                       make([]*runtimev1.LocalAuditEvent, 0, localAuditCapacity),
		verified:                     verified,
		verifiedArtifacts:            verifiedArtifacts,
		catalog:                      defaultCatalogFromVerified(verified),
		managedLlamaRegistrations:    make(map[string]managedLlamaRegistration),
		warmedModelKeys:              make(map[string]struct{}),
		warmedModelOrder:             make([]string, 0, 512),
		endpointProbe:                defaultEndpointProbe,
		hfCatalogSearch:              defaultHFCatalogSearch,
		hfDownloadBaseURL:            defaultHFDownloadBaseURL,
		artifactDownloadTimeout:      localArtifactDownloadTimeout,
		artifactDownloadMaxBodyBytes: localArtifactDownloadMaxBodyBytes,
		modelProbeState:              make(map[string]*probeRecoveryState),
		serviceProbeState:            make(map[string]*probeRecoveryState),
	}
	if err := svc.restoreState(); err != nil {
		return nil, err
	}
	svc.startRecoveryLoop()
	return svc, nil
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

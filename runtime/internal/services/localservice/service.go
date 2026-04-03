package localservice

import (
	"context"
	"log/slog"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/managedimagebackend"
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
	StartEngineWithConfig(ctx context.Context, cfg engine.EngineConfig) error
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
	managedMediaBackendEpoch       uint64

	mu                        sync.RWMutex
	assets                    map[string]*runtimev1.LocalAssetRecord
	assetRuntimeModes         map[string]runtimev1.LocalEngineRuntimeMode
	services                  map[string]*runtimev1.LocalServiceDescriptor
	serviceRuntimeModes       map[string]runtimev1.LocalEngineRuntimeMode
	audits                    []*runtimev1.LocalAuditEvent
	verified                  []*runtimev1.LocalVerifiedAssetDescriptor
	catalog                   []*runtimev1.LocalCatalogModelDescriptor
	managedImageProfiles      map[string]managedImageProfileState
	managedImageLoadCache     map[string]managedImageLoadedState
	managedImageLoadInflight  map[string]*managedImageLoadInflight
	engineMgr                 EngineManager
	managedLlamaRegistrations map[string]managedLlamaRegistration
	warmedModelKeys           map[string]struct{}
	warmedModelOrder          []string

	endpointProbe                endpointProbeFunc
	hfCatalogSearch              hfCatalogSearchFunc
	hfDownloadBaseURL            string
	artifactDownloadTimeout      time.Duration
	artifactDownloadMaxBodyBytes int64
	modelDownloadTimeout         time.Duration
	modelDownloadMaxBodyBytes    int64
	managedImageLoadModel        func(context.Context, managedimagebackend.LoadModelRequest) error
	managedImageFreeModel        func(context.Context, managedimagebackend.LoadModelRequest) error
	assetProbeState              map[string]*probeRecoveryState
	serviceProbeState            map[string]*probeRecoveryState
	transfers                    map[string]*runtimev1.LocalTransferSessionSummary
	transferControls             map[string]*localTransferControl
	transferSubscribers          map[uint64]chan *runtimev1.LocalTransferProgressEvent
	transferSubscriberSeq        uint64
	entryHashCache               map[string]entryHashCacheState
	recoveryCancel               context.CancelFunc
	recoveryDone                 chan struct{}
}

type entryHashCacheState struct {
	size            int64
	modTimeUnixNano int64
	sha256          string
}

func New(logger *slog.Logger, store *auditlog.Store, stateStorePath string, localAuditCapacity int) (*Service, error) {
	if logger == nil {
		logger = slog.Default()
	}
	if localAuditCapacity <= 0 {
		localAuditCapacity = defaultLocalAuditCapacity
	}
	verified := defaultVerifiedAssets()
	svc := &Service{
		logger:                       logger,
		auditStore:                   store,
		stateStorePath:               resolveLocalStatePath(stateStorePath),
		localAuditCap:                localAuditCapacity,
		localModelsPath:              resolveLocalModelsPath(""),
		managedLlamaModelsConfigPath: resolveGeneratedLlamaModelsConfigPath(""),
		assets:                       make(map[string]*runtimev1.LocalAssetRecord),
		assetRuntimeModes:            make(map[string]runtimev1.LocalEngineRuntimeMode),
		services:                     make(map[string]*runtimev1.LocalServiceDescriptor),
		serviceRuntimeModes:          make(map[string]runtimev1.LocalEngineRuntimeMode),
		audits:                       make([]*runtimev1.LocalAuditEvent, 0, localAuditCapacity),
		verified:                     verified,
		catalog:                      defaultCatalogFromVerified(verified),
		managedImageProfiles:         make(map[string]managedImageProfileState),
		managedImageLoadCache:        make(map[string]managedImageLoadedState),
		managedImageLoadInflight:     make(map[string]*managedImageLoadInflight),
		managedLlamaRegistrations:    make(map[string]managedLlamaRegistration),
		warmedModelKeys:              make(map[string]struct{}),
		warmedModelOrder:             make([]string, 0, 512),
		endpointProbe:                defaultEndpointProbe,
		hfCatalogSearch:              defaultHFCatalogSearch,
		hfDownloadBaseURL:            defaultHFDownloadBaseURL,
		artifactDownloadTimeout:      localArtifactDownloadTimeout,
		artifactDownloadMaxBodyBytes: localArtifactDownloadMaxBodyBytes,
		modelDownloadTimeout:         localModelDownloadTimeout,
		modelDownloadMaxBodyBytes:    localModelDownloadMaxBodyBytes,
		managedImageLoadModel:        managedimagebackend.LoadModel,
		managedImageFreeModel:        managedimagebackend.FreeModel,
		assetProbeState:              make(map[string]*probeRecoveryState),
		serviceProbeState:            make(map[string]*probeRecoveryState),
		transfers:                    make(map[string]*runtimev1.LocalTransferSessionSummary),
		transferControls:             make(map[string]*localTransferControl),
		transferSubscribers:          make(map[uint64]chan *runtimev1.LocalTransferProgressEvent),
		entryHashCache:               make(map[string]entryHashCacheState),
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

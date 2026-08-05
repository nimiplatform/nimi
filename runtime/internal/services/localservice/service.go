package localservice

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
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
	EnsureEngineBinaryDependency(ctx context.Context, engine string, version string) (engine.EngineBinaryDependencyStatus, error)
	EnsureUVToolDependency(ctx context.Context) (engine.UVToolDependencyStatus, error)
	EnsurePythonRuntimeDependency(ctx context.Context, uvPath string, engine string, version string, pythonVersion string) (engine.PythonRuntimeDependencyStatus, error)
	EnsurePythonVenvDependency(ctx context.Context, uvPath string, pythonRuntimePath string, engine string, version string) (engine.PythonVenvDependencyStatus, error)
	EnsurePythonPackageSetDependency(ctx context.Context, uvPath string, venvRoot string, consumer string) (engine.PythonPackageSetDependencyStatus, error)
	EnsurePythonTorchWheelDependency(ctx context.Context, uvPath string, venvRoot string, consumer string) (engine.PythonTorchWheelDependencyStatus, error)
	EnsureManagedImageBackend(ctx context.Context, cfg *engine.ManagedImageBackendConfig) error
	EnsureManagedImageBackendDependency(ctx context.Context, cfg *engine.ManagedImageBackendConfig) (engine.ManagedImageBackendDependencyStatus, error)
	StartInstalledManagedImageBackend(ctx context.Context, cfg *engine.ManagedImageBackendConfig) error
	ResolveSharedAcceleratorDependency(dependencyID string, consumerID string) engine.SharedAcceleratorDependencyStatus
	EnsureSharedAcceleratorDependency(ctx context.Context, dependencyID string) (engine.SharedAcceleratorDependencyStatus, error)
	StartEngine(ctx context.Context, engine string, port int, version string) error
	StartEngineWithConfig(ctx context.Context, cfg engine.EngineConfig) error
	StopEngine(engine string) error
	EngineStatus(engine string) (EngineInfo, error)
}

// EngineInfo holds engine status data returned by the manager.
type EngineInfo = engine.EngineInfoDTO

type RuntimeAccountProjectionProvider interface {
	AuthenticatedRuntimeProjection(context.Context) (*runtimev1.AccountProjection, bool)
}

// Service implements RuntimeLocalService with persisted local state.
type Service struct {
	runtimev1.UnimplementedRuntimeLocalServiceServer

	logger                             *slog.Logger
	auditStore                         *auditlog.Store
	localProviderCatalog               *catalog.LocalProviderCatalog
	runtimeAccountProvider             RuntimeAccountProjectionProvider
	stateStorePath                     string
	productControlRoot                 string
	productControlRootLocked           bool
	productControlDataRootSecurity     ProductControlDataRootSecurityBinding
	productControlDataRootConfigWriter func(string) (bool, error)
	localAuditCap                      int
	productVersion                     string
	localModelsPath                    string
	runtimeDataRoot                    string
	managedMediaEndpointValue          string
	managedSpeechEndpointValue         string
	managedMediaBackendConfigured      bool
	managedMediaBackendHealthy         bool
	managedMediaBackendAddress         string
	managedMediaBackendPackageSource   string
	managedMediaBackendStatus          runtimev1.LocalServiceStatus
	managedMediaBackendDetail          string
	managedMediaBackendInstalledAt     string
	managedMediaBackendUpdatedAt       string
	managedMediaBackendEpoch           uint64

	mu                                      sync.RWMutex
	assets                                  map[string]*runtimev1.LocalAssetRecord
	assetRuntimeModes                       map[string]runtimev1.LocalEngineRuntimeMode
	services                                map[string]*runtimev1.LocalServiceDescriptor
	serviceRuntimeModes                     map[string]runtimev1.LocalEngineRuntimeMode
	audits                                  []*runtimev1.LocalAuditEvent
	verified                                []*runtimev1.LocalVerifiedAssetDescriptor
	catalog                                 []*runtimev1.LocalCatalogModelDescriptor
	managedImageProfiles                    map[string]managedImageProfileState
	managedImageProfileBindings             map[string]managedImageProfileState
	managedImageLoadCache                   map[string]managedImageLoadedState
	managedImageLoadInflight                map[string]*managedImageLoadInflight
	localAssetProbeInflight                 map[string]*localAssetProbeInflight
	engineMgr                               EngineManager
	warmedModelKeys                         map[string]struct{}
	warmedModelOrder                        []string
	assetResidency                          map[string]localAssetResidencyState
	engineResidency                         map[string]localEngineResidencyState
	localEnvironmentHostProfiles            map[string]localEnvironmentHostProfileState
	localEnvironmentSelectedSources         map[string]localEnvironmentSelectedSourceRecordState
	localEnvironmentDependencyJobs          map[string]localEnvironmentDependencyJobState
	localEnvironmentPlanDependencyContracts map[string]localEnvironmentPlanDependencyContractState
	localEnvironmentJobCancels              map[string]context.CancelFunc
	localEnvironmentJobWG                   sync.WaitGroup
	localEnvironmentPrerequisiteWaitTimeout time.Duration
	machineLocalConfigurationMutationMu     sync.Mutex
	machineLocalConfigurations              map[string]*storedLocalCapabilityConfiguration
	machineLocalSelections                  map[string]*runtimev1.LocalCapabilitySelection
	machineLocalConfigurationStore          machineLocalConfigurationStore
	capabilityDrivers                       *capabilitydriver.Registry
	jobLifetimeCtx                          context.Context
	jobLifetimeCancel                       context.CancelFunc

	profileRegistry *ProfileRegistry

	endpointProbe                endpointProbeFunc
	hfCatalogSearch              hfCatalogSearchFunc
	hfCatalogVariants            hfCatalogVariantsFunc
	hfDownloadBaseURL            string
	artifactDownloadTimeout      time.Duration
	artifactDownloadMaxBodyBytes int64
	modelDownloadTimeout         time.Duration
	modelDownloadMaxBodyBytes    int64
	modelDownloadMaxAttempts     int
	modelDownloadRetryBackoff    time.Duration
	managedImageLoadModel        func(context.Context, managedimagebackend.LoadModelRequest) (*managedimagebackend.LoadModelDiagnostics, error)
	managedImageFreeModel        func(context.Context, managedimagebackend.LoadModelRequest) error
	assetProbeState              map[string]*probeRecoveryState
	serviceProbeState            map[string]*probeRecoveryState
	transfers                    map[string]*runtimev1.LocalTransferSessionSummary
	transferControls             map[string]*localTransferControl
	transferRates                map[string]*transferRateTracker
	transferSubscribers          map[uint64]chan *runtimev1.LocalTransferProgressEvent
	transferSubscriberSeq        uint64
	entryHashCache               map[string]entryHashCacheState
	recoveryCancel               context.CancelFunc
	recoveryDone                 chan struct{}
	localModelKeepAlive          time.Duration
	managedPortAvailable         func(int) bool
}

type entryHashCacheState struct {
	size            int64
	modTimeUnixNano int64
	sha256          string
}

func New(logger *slog.Logger, store *auditlog.Store, stateStorePath string, localAuditCapacity int, localModelsPathOverride ...string) (*Service, error) {
	if len(localModelsPathOverride) > 1 {
		return nil, fmt.Errorf("local service data root must be bound through Product Control")
	}
	localModelsPath := ""
	if len(localModelsPathOverride) == 1 {
		localModelsPath = localModelsPathOverride[0]
	}
	return newService(logger, store, stateStorePath, localAuditCapacity, localModelsPath, "")
}

// NewWithProductControlDataRoot constructs the service with the data root
// already resolved from the fixed Product Control record. The models path is a
// derived equality proof, not an independent locator.
func NewWithProductControlDataRoot(logger *slog.Logger, store *auditlog.Store, stateStorePath string, localAuditCapacity int, localModelsPath string, dataRoot string) (*Service, error) {
	if err := validateProductControlDerivedLocalPaths(localModelsPath, dataRoot); err != nil {
		return nil, err
	}
	return newService(logger, store, stateStorePath, localAuditCapacity, localModelsPath, dataRoot)
}

func newService(logger *slog.Logger, store *auditlog.Store, stateStorePath string, localAuditCapacity int, localModelsPath string, runtimeDataRoot string) (*Service, error) {
	if logger == nil {
		logger = slog.Default()
	}
	if localAuditCapacity <= 0 {
		localAuditCapacity = defaultLocalAuditCapacity
	}
	resolvedStateStorePath := resolveLocalStatePath(stateStorePath)
	localProviderCatalog, catalogErr := catalog.LoadBuiltInLocalProviderCatalog()
	if catalogErr != nil {
		return nil, fmt.Errorf("local service: load local provider catalog: %w", catalogErr)
	}
	verified, verifiedErr := verifiedAssetsFromLocalCatalog(localProviderCatalog)
	if verifiedErr != nil {
		return nil, fmt.Errorf("local service: load verified assets: %w", verifiedErr)
	}
	svc := &Service{
		logger:                                  logger,
		auditStore:                              store,
		localProviderCatalog:                    localProviderCatalog,
		stateStorePath:                          resolvedStateStorePath,
		localAuditCap:                           localAuditCapacity,
		localModelsPath:                         resolveLocalModelsPath(localModelsPath),
		runtimeDataRoot:                         resolveLocalEnvironmentRuntimeDataRoot(runtimeDataRoot),
		assets:                                  make(map[string]*runtimev1.LocalAssetRecord),
		assetRuntimeModes:                       make(map[string]runtimev1.LocalEngineRuntimeMode),
		services:                                make(map[string]*runtimev1.LocalServiceDescriptor),
		serviceRuntimeModes:                     make(map[string]runtimev1.LocalEngineRuntimeMode),
		audits:                                  make([]*runtimev1.LocalAuditEvent, 0, localAuditCapacity),
		verified:                                verified,
		catalog:                                 make([]*runtimev1.LocalCatalogModelDescriptor, 0, len(verified)),
		managedImageProfiles:                    make(map[string]managedImageProfileState),
		managedImageProfileBindings:             make(map[string]managedImageProfileState),
		managedImageLoadCache:                   make(map[string]managedImageLoadedState),
		managedImageLoadInflight:                make(map[string]*managedImageLoadInflight),
		localAssetProbeInflight:                 make(map[string]*localAssetProbeInflight),
		warmedModelKeys:                         make(map[string]struct{}),
		warmedModelOrder:                        make([]string, 0, 512),
		assetResidency:                          make(map[string]localAssetResidencyState),
		engineResidency:                         make(map[string]localEngineResidencyState),
		localEnvironmentHostProfiles:            make(map[string]localEnvironmentHostProfileState),
		localEnvironmentSelectedSources:         make(map[string]localEnvironmentSelectedSourceRecordState),
		localEnvironmentDependencyJobs:          make(map[string]localEnvironmentDependencyJobState),
		localEnvironmentPlanDependencyContracts: make(map[string]localEnvironmentPlanDependencyContractState),
		localEnvironmentJobCancels:              make(map[string]context.CancelFunc),
		machineLocalConfigurations:              make(map[string]*storedLocalCapabilityConfiguration),
		machineLocalSelections:                  make(map[string]*runtimev1.LocalCapabilitySelection),
		machineLocalConfigurationStore:          newDiskMachineLocalConfigurationStore(resolvedStateStorePath),
		capabilityDrivers:                       capabilitydriver.NewProductionRegistry(),
		profileRegistry:                         NewProfileRegistry(),
		endpointProbe:                           defaultEndpointProbe,
		hfCatalogSearch:                         defaultHFCatalogSearch,
		hfCatalogVariants:                       defaultHFCatalogVariants,
		hfDownloadBaseURL:                       defaultHFDownloadBaseURL,
		artifactDownloadTimeout:                 localArtifactDownloadTimeout,
		artifactDownloadMaxBodyBytes:            localArtifactDownloadMaxBodyBytes,
		modelDownloadTimeout:                    localModelDownloadTimeout,
		modelDownloadMaxBodyBytes:               localModelDownloadMaxBodyBytes,
		modelDownloadMaxAttempts:                localModelDownloadMaxAttempts,
		modelDownloadRetryBackoff:               localModelDownloadRetryBackoff,
		managedImageLoadModel:                   managedimagebackend.LoadModel,
		managedImageFreeModel:                   managedimagebackend.FreeModel,
		assetProbeState:                         make(map[string]*probeRecoveryState),
		serviceProbeState:                       make(map[string]*probeRecoveryState),
		transfers:                               make(map[string]*runtimev1.LocalTransferSessionSummary),
		transferControls:                        make(map[string]*localTransferControl),
		transferRates:                           make(map[string]*transferRateTracker),
		transferSubscribers:                     make(map[uint64]chan *runtimev1.LocalTransferProgressEvent),
		entryHashCache:                          make(map[string]entryHashCacheState),
		localModelKeepAlive:                     defaultLocalModelKeepAlive,
		managedPortAvailable:                    loopbackPortAvailable,
	}
	jobCtx, jobCancel := context.WithCancel(context.Background())
	svc.jobLifetimeCtx = jobCtx
	svc.jobLifetimeCancel = jobCancel
	if err := svc.restoreMachineLocalConfigurations(); err != nil {
		jobCancel()
		return nil, fmt.Errorf("local service: restore Machine Local AI Configuration: %w", err)
	}
	if err := svc.restoreState(); err != nil {
		jobCancel()
		return nil, err
	}
	svc.seedInitialResidencyState()
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

func (s *Service) SetProductVersion(version string) error {
	if s == nil {
		return errors.New("local service is nil")
	}
	trimmed := strings.TrimSpace(version)
	if trimmed == "" {
		return errors.New("Runtime product version is required")
	}
	s.mu.Lock()
	s.productVersion = trimmed
	s.mu.Unlock()
	return nil
}

func (s *Service) SetRuntimeAccountProjectionProvider(provider RuntimeAccountProjectionProvider) {
	if s == nil {
		return
	}
	s.mu.Lock()
	s.runtimeAccountProvider = provider
	s.mu.Unlock()
}

// SetProductControlDataRootConfigWriter binds the Runtime-owned, bounded
// service config mutation used by SelectProductControlDataRoot. The writer is
// injected from protected startup so no request can select its physical path.
func (s *Service) SetProductControlDataRootConfigWriter(writer func(string) (bool, error)) {
	if s == nil {
		return
	}
	s.mu.Lock()
	s.productControlDataRootConfigWriter = writer
	s.mu.Unlock()
}

func (s *Service) SetLocalModelKeepAlive(duration time.Duration) {
	if s == nil {
		return
	}
	s.mu.Lock()
	s.localModelKeepAlive = duration
	s.mu.Unlock()
	s.seedInitialResidencyState()
}

func (s *Service) Close() {
	s.mu.Lock()
	cancel := s.recoveryCancel
	done := s.recoveryDone
	jobCancel := s.jobLifetimeCancel
	s.recoveryCancel = nil
	s.recoveryDone = nil
	s.jobLifetimeCancel = nil
	s.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	if done != nil {
		<-done
	}
	// Abort any in-flight local-environment dependency-job goroutines and wait
	// for them to reach a terminal transition before the service is torn down.
	if jobCancel != nil {
		jobCancel()
	}
	s.localEnvironmentJobWG.Wait()
}

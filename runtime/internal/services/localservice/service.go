package localservice

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/oklog/ulid/v2"
)

const (
	defaultLocalEndpoint      = "http://127.0.0.1:1234/v1"
	defaultMediaEndpoint      = "http://127.0.0.1:8321/v1"
	defaultSpeechEndpoint     = "http://127.0.0.1:8330/v1"
	defaultLocalAuditCapacity = 5000
	localAuditDomain          = "runtime.local_runtime"
)

// EngineManager is the interface the service uses to interact with the engine subsystem.
// Defined here to avoid a hard import cycle with the engine package.
type EngineManager interface {
	ListEngines() []EngineInfo
	EnsureEngineBinaryDependency(ctx context.Context, engine string, version string) (engine.EngineBinaryDependencyStatus, error)
	VerifyEngineBinaryDependency(engine string, version string, expectedBinaryPath string) error
	EnsureESpeakNGDependency(ctx context.Context) (engine.ESpeakNGDependencyStatus, error)
	EnsureUVToolDependency(ctx context.Context) (engine.UVToolDependencyStatus, error)
	EnsurePythonRuntimeDependency(ctx context.Context, uvPath string, engine string, version string, pythonVersion string) (engine.PythonRuntimeDependencyStatus, error)
	EnsurePythonDependencyProfile(ctx context.Context, uvPath string, pythonRuntimePath string, consumer string, platformTuple string, acceleratorPlane string) (engine.PythonDependencyProfileStatus, error)
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

// ProductControlRootHandoff is the concrete Runtime process boundary used by
// Product Control replacement. It closes new root-bound RPC admission and
// drains already admitted work without stopping the Product Control service
// that owns the activation commit.
type ProductControlRootHandoff interface {
	CloseRootAdmission(context.Context) error
	AbortRootHandoff()
	CommitRootHandoff()
}

// @nimi-authority: definition.nimi.runtime.service-operations.local-service-plane
// Service implements RuntimeLocalService with persisted local state.
type Service struct {
	runtimev1.UnimplementedRuntimeLocalServiceServer

	logger                                *slog.Logger
	auditStore                            *auditlog.Store
	localProviderCatalog                  *catalog.LocalProviderCatalog
	runtimeAccountProvider                RuntimeAccountProjectionProvider
	stateStorePath                        string
	stateProcessLock                      *localStateProcessLock
	productControlRoot                    string
	productControlRootLocked              bool
	productControlDataRootSecurity        ProductControlDataRootSecurityBinding
	productControlDataRootConfigWriter    func(string) (bool, error)
	productControlDataRootConfigValidator func(string) error
	productControlRootHandoff             ProductControlRootHandoff
	productControlRootAdmissionClosed     bool
	localAuditCap                         int
	productVersion                        string
	localModelsPath                       string
	runtimeDataRoot                       string
	llamaEngineVersion                    string

	mu                                      sync.RWMutex
	productControlReplacementMu             sync.Mutex
	productControlCheckSyncStartMu          sync.Mutex
	localEnvironmentPlanApplyMu             sync.Mutex
	managedSpeechMu                         sync.Mutex
	managedSpeechAdmissionToken             string
	audits                                  []*runtimev1.LocalAuditEvent
	verified                                []*runtimev1.LocalVerifiedAssetDescriptor
	catalog                                 []*runtimev1.LocalCatalogModelDescriptor
	engineMgr                               EngineManager
	localEnvironmentHostProfiles            map[string]localEnvironmentHostProfileState
	localEnvironmentSelectedSources         map[string]localEnvironmentSelectedSourceRecordState
	localEnvironmentDependencyJobs          map[string]localEnvironmentDependencyJobState
	localEnvironmentPlanDependencyContracts map[string]localEnvironmentPlanDependencyContractState
	localEnvironmentJobCancels              map[string]context.CancelFunc
	localEnvironmentJobWG                   sync.WaitGroup
	transferWorkerWG                        sync.WaitGroup
	localEnvironmentPrerequisiteWaitTimeout time.Duration
	loadoutMutationMu                       sync.Mutex
	loadouts                                map[string]*runtimev1.Loadout
	loadoutSelections                       map[string]*runtimev1.LoadoutSelection
	loadoutStore                            loadoutStore
	heldLoadoutPrepares                     map[string]heldLoadoutPrepare
	loadoutCASToken                         string
	loadoutNow                              func() time.Time
	modelAssetMutationMu                    sync.Mutex
	modelAssets                             map[string]*runtimev1.ModelAssetRecord
	modelAssetDirectories                   map[string]string
	modelAssetCleanupObligations            map[string]modelAssetCleanupObligation
	modelAssetPendingDirectoryRebases       map[string]string
	modelAssetPendingCleanupRebases         map[string]modelAssetCleanupObligation
	modelAssetStorePath                     string
	saveModelAssetStore                     func(string, modelAssetStoreSnapshot) error
	writeModelAssetManifest                 func(string, []byte) error
	removeModelAssetDirectory               func(string) error
	localStateRetainedRecords               []quarantinedStateRecord
	modelAssetRetainedRecords               []quarantinedStateRecord
	heldModelInstallPlans                   map[string]heldModelInstallPlan
	modelInstallPlanNow                     func() time.Time
	capabilityDrivers                       *capabilitydriver.Registry
	jobLifetimeCtx                          context.Context
	jobLifetimeCancel                       context.CancelFunc

	hfCatalogSearch               hfCatalogSearchFunc
	hfCatalogVariants             hfCatalogVariantsFunc
	hfDownloadBaseURL             string
	artifactDownloadTimeout       time.Duration
	artifactDownloadMaxBodyBytes  int64
	modelDownloadTimeout          time.Duration
	modelDownloadMaxBodyBytes     int64
	modelDownloadMaxAttempts      int
	modelDownloadRetryDelays      []time.Duration
	transfers                     map[string]*runtimev1.LocalTransferSessionSummary
	managedModelDownloadSpecs     map[string]managedDownloadedModelSpec
	transferControls              map[string]*localTransferControl
	transferRates                 map[string]*transferRateTracker
	transferSubscribers           map[uint64]chan *runtimev1.LocalTransferProgressEvent
	transferSubscriberSeq         uint64
	entryHashCache                map[string]entryHashCacheState
	entryFileSHA256               func(string) (string, error)
	adoptResolvedModelImports     bool
	managedPortAvailable          func(int) bool
	modelIndexRefreshMu           sync.Mutex
	modelIndexCacheWrite          func(string, []byte) error
	deviceProfileMu               sync.Mutex
	deviceProfileCached           *runtimev1.LocalDeviceProfile
	deviceProfileCachedAt         time.Time
	productControlCheckSyncMu     sync.RWMutex
	productControlCheckSyncClosed bool
	productControlCheckSyncRun    *productControlCheckSyncRun
	productControlCheckSyncError  string
	productControlCheckSyncOwners productControlCheckSyncRuntimeOwners
}

type entryHashCacheState struct {
	size             int64
	modTimeUnixNano  int64
	generationDigest string
	sha256           string
}

type serviceConstructionMode struct {
	exclusiveStateAccess      bool
	adoptResolvedModelImports bool
}

func New(logger *slog.Logger, store *auditlog.Store, stateStorePath string, localAuditCapacity int, localModelsPathOverride ...string) (*Service, error) {
	if len(localModelsPathOverride) > 1 {
		return nil, fmt.Errorf("local service data root must be bound through Product Control")
	}
	localModelsPath := ""
	if len(localModelsPathOverride) == 1 {
		localModelsPath = localModelsPathOverride[0]
	}
	return newService(logger, store, stateStorePath, localAuditCapacity, localModelsPath, "", serviceConstructionMode{})
}

// NewForLocalModelRecovery opens state exclusively and without daemon recovery
// loops. A running daemon holds the same lock, so explicit repair fails fast
// instead of writing concurrently.
func NewForLocalModelRecovery(logger *slog.Logger, store *auditlog.Store, stateStorePath string, localAuditCapacity int, localModelsPath string) (*Service, error) {
	return newService(logger, store, stateStorePath, localAuditCapacity, localModelsPath, "", serviceConstructionMode{
		exclusiveStateAccess:      true,
		adoptResolvedModelImports: true,
	})
}

// NewWithProductControlDataRoot constructs the service with the data root
// already resolved from the fixed Product Control record. The models path is a
// derived equality proof, not an independent locator.
func NewWithProductControlDataRoot(logger *slog.Logger, store *auditlog.Store, stateStorePath string, localAuditCapacity int, localModelsPath string, dataRoot string) (*Service, error) {
	if err := validateProductControlDerivedLocalPaths(localModelsPath, dataRoot); err != nil {
		return nil, err
	}
	return newService(logger, store, stateStorePath, localAuditCapacity, localModelsPath, dataRoot, serviceConstructionMode{})
}

// NewRuntimeWithProductControlDataRoot owns the daemon's exclusive state lock.
func NewRuntimeWithProductControlDataRoot(logger *slog.Logger, store *auditlog.Store, stateStorePath string, localAuditCapacity int, localModelsPath string, dataRoot string) (*Service, error) {
	if err := validateProductControlDerivedLocalPaths(localModelsPath, dataRoot); err != nil {
		return nil, err
	}
	return newService(logger, store, stateStorePath, localAuditCapacity, localModelsPath, dataRoot, serviceConstructionMode{exclusiveStateAccess: true})
}

func newService(logger *slog.Logger, store *auditlog.Store, stateStorePath string, localAuditCapacity int, localModelsPath string, runtimeDataRoot string, mode serviceConstructionMode) (*Service, error) {
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
	capabilityDrivers := capabilitydriver.NewProductionRegistry()
	if err := validateLocalCatalogLoadoutRecipes(localProviderCatalog, capabilityDrivers); err != nil {
		return nil, fmt.Errorf("local service: validate Loadout recipes: %w", err)
	}
	verified, verifiedErr := verifiedAssetsFromLocalCatalog(localProviderCatalog)
	if verifiedErr != nil {
		return nil, fmt.Errorf("local service: load verified assets: %w", verifiedErr)
	}
	var stateProcessLock *localStateProcessLock
	if mode.exclusiveStateAccess {
		var err error
		stateProcessLock, err = acquireLocalStateProcessLock(resolvedStateStorePath)
		if err != nil {
			return nil, fmt.Errorf("local service: acquire exclusive state access: %w", err)
		}
	}
	keepStateProcessLock := false
	defer func() {
		if !keepStateProcessLock {
			stateProcessLock.release()
		}
	}()
	if !mode.adoptResolvedModelImports {
		if err := rejectRetiredMachineConfiguration(resolvedStateStorePath); err != nil {
			return nil, fmt.Errorf("local service: %w", err)
		}
	}
	svc := &Service{
		logger:                                  logger,
		stateProcessLock:                        stateProcessLock,
		auditStore:                              store,
		localProviderCatalog:                    localProviderCatalog,
		stateStorePath:                          resolvedStateStorePath,
		localAuditCap:                           localAuditCapacity,
		localModelsPath:                         resolveLocalModelsPath(localModelsPath),
		runtimeDataRoot:                         resolveLocalEnvironmentRuntimeDataRoot(runtimeDataRoot),
		llamaEngineVersion:                      engine.DefaultLlamaConfig().Version,
		audits:                                  make([]*runtimev1.LocalAuditEvent, 0, localAuditCapacity),
		verified:                                verified,
		catalog:                                 make([]*runtimev1.LocalCatalogModelDescriptor, 0, len(verified)),
		localEnvironmentHostProfiles:            make(map[string]localEnvironmentHostProfileState),
		localEnvironmentSelectedSources:         make(map[string]localEnvironmentSelectedSourceRecordState),
		localEnvironmentDependencyJobs:          make(map[string]localEnvironmentDependencyJobState),
		localEnvironmentPlanDependencyContracts: make(map[string]localEnvironmentPlanDependencyContractState),
		localEnvironmentJobCancels:              make(map[string]context.CancelFunc),
		loadouts:                                make(map[string]*runtimev1.Loadout),
		loadoutSelections:                       make(map[string]*runtimev1.LoadoutSelection),
		loadoutStore:                            newDiskLoadoutStore(resolvedStateStorePath),
		heldLoadoutPrepares:                     make(map[string]heldLoadoutPrepare),
		loadoutCASToken:                         "loadout-cas_" + ulid.Make().String(),
		loadoutNow:                              time.Now,
		modelAssets:                             make(map[string]*runtimev1.ModelAssetRecord),
		modelAssetDirectories:                   make(map[string]string),
		modelAssetCleanupObligations:            make(map[string]modelAssetCleanupObligation),
		modelAssetPendingDirectoryRebases:       make(map[string]string),
		modelAssetPendingCleanupRebases:         make(map[string]modelAssetCleanupObligation),
		modelAssetStorePath:                     resolveModelAssetStorePath(resolvedStateStorePath, resolveLocalModelsPath(localModelsPath)),
		saveModelAssetStore:                     saveModelAssetStore,
		writeModelAssetManifest: func(path string, payload []byte) error {
			return writeFileAtomically(path, payload, 0o600)
		},
		removeModelAssetDirectory:    os.RemoveAll,
		heldModelInstallPlans:        make(map[string]heldModelInstallPlan),
		modelInstallPlanNow:          time.Now,
		capabilityDrivers:            capabilityDrivers,
		hfCatalogSearch:              defaultHFCatalogSearch,
		hfCatalogVariants:            defaultHFCatalogVariants,
		hfDownloadBaseURL:            defaultHFDownloadBaseURL,
		artifactDownloadTimeout:      localArtifactDownloadTimeout,
		artifactDownloadMaxBodyBytes: localArtifactDownloadMaxBodyBytes,
		modelDownloadTimeout:         localModelDownloadTimeout,
		modelDownloadMaxBodyBytes:    localModelDownloadMaxBodyBytes,
		modelDownloadMaxAttempts:     localModelDownloadMaxAttempts,
		modelDownloadRetryDelays:     append([]time.Duration(nil), localModelDownloadRetryDelays...),
		transfers:                    make(map[string]*runtimev1.LocalTransferSessionSummary),
		managedModelDownloadSpecs:    make(map[string]managedDownloadedModelSpec),
		transferControls:             make(map[string]*localTransferControl),
		transferRates:                make(map[string]*transferRateTracker),
		transferSubscribers:          make(map[uint64]chan *runtimev1.LocalTransferProgressEvent),
		entryHashCache:               make(map[string]entryHashCacheState),
		entryFileSHA256:              computeFileSHA256,
		adoptResolvedModelImports:    mode.adoptResolvedModelImports,
		managedPortAvailable:         loopbackPortAvailable,
	}
	jobCtx, jobCancel := context.WithCancel(context.Background())
	svc.jobLifetimeCtx = jobCtx
	svc.jobLifetimeCancel = jobCancel
	if err := svc.restoreLoadouts(); err != nil {
		jobCancel()
		return nil, fmt.Errorf("local service: restore Loadouts: %w", err)
	}
	if err := svc.restoreModelAssetStore(); err != nil {
		jobCancel()
		return nil, fmt.Errorf("local service: restore ModelAsset inventory: %w", err)
	}
	if !mode.adoptResolvedModelImports {
		if err := svc.restoreState(); err != nil {
			jobCancel()
			return nil, err
		}
	}
	keepStateProcessLock = true
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

func (s *Service) SetProductControlDataRootConfigValidator(validator func(string) error) {
	if s == nil {
		return
	}
	s.mu.Lock()
	s.productControlDataRootConfigValidator = validator
	s.mu.Unlock()
}

func (s *Service) SetProductControlRootHandoff(handoff ProductControlRootHandoff) {
	if s == nil {
		return
	}
	s.mu.Lock()
	s.productControlRootHandoff = handoff
	s.mu.Unlock()
}

func (s *Service) Close() {
	s.StopProductControlCheckSync()
	s.mu.Lock()
	jobCancel := s.jobLifetimeCancel
	s.jobLifetimeCancel = nil
	s.mu.Unlock()
	// Abort any in-flight local-environment dependency-job goroutines and wait
	// for them to reach a terminal transition before the service is torn down.
	if jobCancel != nil {
		jobCancel()
	}
	s.localEnvironmentJobWG.Wait()
	s.transferWorkerWG.Wait()

	s.mu.Lock()
	stateProcessLock := s.stateProcessLock
	s.stateProcessLock = nil
	s.mu.Unlock()
	stateProcessLock.release()
}

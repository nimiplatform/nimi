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

	logger         *slog.Logger
	auditStore     *auditlog.Store
	stateStorePath string

	mu        sync.RWMutex
	models    map[string]*runtimev1.LocalModelRecord
	services  map[string]*runtimev1.LocalServiceDescriptor
	audits    []*runtimev1.LocalAuditEvent
	verified  []*runtimev1.LocalVerifiedModelDescriptor
	catalog   []*runtimev1.LocalCatalogModelDescriptor
	engineMgr EngineManager
}

func New(logger *slog.Logger, store *auditlog.Store, stateStorePath string, localAuditCapacity int) *Service {
	if logger == nil {
		logger = slog.Default()
	}
	if localAuditCapacity <= 0 {
		localAuditCapacity = 5000
	}
	verified := defaultVerifiedModels()
	svc := &Service{
		logger:         logger,
		auditStore:     store,
		stateStorePath: resolveLocalRuntimeStatePath(stateStorePath),
		models:         make(map[string]*runtimev1.LocalModelRecord),
		services:       make(map[string]*runtimev1.LocalServiceDescriptor),
		audits:         make([]*runtimev1.LocalAuditEvent, 0, localAuditCapacity),
		verified:       verified,
		catalog:        defaultCatalogFromVerified(verified),
	}
	svc.restoreState()
	return svc
}

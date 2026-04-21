package grpcserver

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/appregistry"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/health"
	"github.com/nimiplatform/nimi/runtime/internal/idempotency"
	"github.com/nimiplatform/nimi/runtime/internal/modelregistry"
	"github.com/nimiplatform/nimi/runtime/internal/providerhealth"
	"github.com/nimiplatform/nimi/runtime/internal/scheduler"
	"github.com/nimiplatform/nimi/runtime/internal/scopecatalog"
	aiservice "github.com/nimiplatform/nimi/runtime/internal/services/ai"
	appservice "github.com/nimiplatform/nimi/runtime/internal/services/app"
	auditservice "github.com/nimiplatform/nimi/runtime/internal/services/audit"
	authservice "github.com/nimiplatform/nimi/runtime/internal/services/auth"
	cognitionservice "github.com/nimiplatform/nimi/runtime/internal/services/cognition"
	connectorservice "github.com/nimiplatform/nimi/runtime/internal/services/connector"
	grantservice "github.com/nimiplatform/nimi/runtime/internal/services/grant"
	knowledgeservice "github.com/nimiplatform/nimi/runtime/internal/services/knowledge"
	localservice "github.com/nimiplatform/nimi/runtime/internal/services/localservice"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
	modelservice "github.com/nimiplatform/nimi/runtime/internal/services/model"
	runtimeagentservice "github.com/nimiplatform/nimi/runtime/internal/services/runtimeagent"
	workflowservice "github.com/nimiplatform/nimi/runtime/internal/services/workflow"
	"google.golang.org/grpc"
	grpcHealth "google.golang.org/grpc/health"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
)

// Server wraps the gRPC serving stack for the runtime daemon.
type Server struct {
	addr             string
	state            *health.State
	logger           *slog.Logger
	grpcServer       *grpc.Server
	healthServer     *grpcHealth.Server
	rpcRegistry      *activeRPCRegistry
	aiHealth         *providerhealth.Tracker
	auditStore       *auditlog.Store
	aiSvc            *aiservice.Service
	appService       *appservice.Service
	localService     *localservice.Service
	memoryService    *memoryservice.Service
	cognitionService *cognitionservice.Service
	agentService     *runtimeagentservice.Service
}

const (
	maxGRPCMessageBytes      = 8 << 20
	maxGRPCConcurrentStreams = 128
	grpcIOBufferBytes        = 32 << 10
)

func New(cfg config.Config, state *health.State, logger *slog.Logger, version string) (*Server, error) {
	addr := cfg.GRPCAddr
	auditStore := auditlog.New(cfg.AuditRingBufferSize, cfg.UsageStatsBufferSize)
	idempotencyStore, err := idempotency.New(24*time.Hour, cfg.IdempotencyCapacity)
	if err != nil {
		return nil, fmt.Errorf("configure idempotency store: %w", err)
	}
	appRegistry := appregistry.New()
	scopeCatalog := scopecatalog.New(func(operation string, version string, code runtimev1.ReasonCode) {
		appendAuditEvent(auditStore, auditEventInput{
			Domain:              "runtime.scope",
			Operation:           operation,
			ReasonCode:          code,
			ScopeCatalogVersion: version,
			CallerKind:          runtimev1.CallerKind_CALLER_KIND_DESKTOP_CORE,
			CallerID:            "scope-catalog",
		})
	})
	registryPath := modelregistry.ResolvePersistencePath()
	modelRegistry, err := modelregistry.NewFromFile(registryPath)
	if err != nil {
		return nil, fmt.Errorf("load model registry: %w", err)
	}
	if registryPath != "" {
		logger.Info("model registry persistence enabled", "path", registryPath)
	}
	aiHealth := providerhealth.New()
	rpcRegistry := newActiveRPCRegistry(nil)

	h := grpcHealth.NewServer()
	grantSvc := grantservice.NewWithDependencies(logger, appRegistry, scopeCatalog,
		grantservice.WithAuditStore(auditStore),
		grantservice.WithTTLBounds(cfg.SessionTTLMinSeconds, cfg.SessionTTLMaxSeconds),
		grantservice.WithMaxDelegationDepth(cfg.MaxDelegationDepth),
	)
	authSvc := authservice.NewWithDependencies(
		logger, appRegistry, auditStore,
		int32(cfg.SessionTTLMinSeconds), int32(cfg.SessionTTLMaxSeconds),
	)

	// AuthN validator — JWKS mode (K-AUTHN-004)
	authnValidator, authnErr := authn.NewValidator(cfg.AuthJWTJWKSURL, cfg.AuthJWTIssuer, cfg.AuthJWTAudience)
	if authnErr != nil {
		logger.Warn("JWT authn validator init failed; all JWT tokens will be rejected", "error", authnErr)
		authnValidator, _ = authn.NewValidator("", "", "")
	}
	authnValidator.SetRevocationURL(cfg.AuthJWTRevocationURL)

	g := grpc.NewServer(
		grpc.MaxRecvMsgSize(maxGRPCMessageBytes),
		grpc.MaxSendMsgSize(maxGRPCMessageBytes),
		grpc.MaxConcurrentStreams(maxGRPCConcurrentStreams),
		grpc.ReadBufferSize(grpcIOBufferBytes),
		grpc.WriteBufferSize(grpcIOBufferBytes),
		grpc.ChainUnaryInterceptor(
			newUnaryVersionInterceptor(logger, version),
			newUnaryLifecycleInterceptor(state),
			newUnaryActivityInterceptor(rpcRegistry),
			newUnaryProtocolInterceptor(idempotencyStore),
			authn.NewUnaryInterceptor(authnValidator),
			newUnaryAuthzInterceptor(grantSvc),
			newUnaryCredentialScrubInterceptor(),
			newUnaryAuditInterceptor(auditStore),
		),
		grpc.ChainStreamInterceptor(
			newStreamVersionInterceptor(logger, version),
			newStreamLifecycleInterceptor(state),
			newStreamActivityInterceptor(rpcRegistry),
			newStreamProtocolInterceptor(),
			authn.NewStreamInterceptor(authnValidator),
			newStreamAuthzInterceptor(grantSvc),
			newStreamCredentialScrubInterceptor(),
			newStreamAuditInterceptor(auditStore),
		),
	)
	healthpb.RegisterHealthServer(g, h)
	runtimev1.RegisterRuntimeAuditServiceServer(g, auditservice.New(state, logger, aiHealth, auditStore))

	connStore := connectorservice.NewConnectorStore(connectorservice.ResolveBasePath())
	if err := connStore.ReconcileStartup(); err != nil {
		return nil, fmt.Errorf("reconcile connector store: %w", err)
	}
	if err := connectorservice.EnsureLocalConnectors(connStore); err != nil {
		return nil, fmt.Errorf("ensure local connectors: %w", err)
	}

	cloudDefs := buildCloudConnectorDefs(cfg)
	if err := connectorservice.EnsureCloudConnectorsFromConfig(connStore, cloudDefs); err != nil {
		return nil, fmt.Errorf("ensure cloud connectors: %w", err)
	}

	aiSvc, err := aiservice.New(logger, modelRegistry, aiHealth, auditStore, connStore, cfg)
	if err != nil {
		return nil, fmt.Errorf("init ai service: %w", err)
	}
	aiSvc.SetModelRegistryPersistencePath(registryPath)
	runtimev1.RegisterRuntimeAiServiceServer(g, aiSvc)
	runtimev1.RegisterRuntimeAiRealtimeServiceServer(g, aiSvc)

	runtimev1.RegisterRuntimeWorkflowServiceServer(g, workflowservice.New(logger)) // Phase 2 Draft
	modelSvc := modelservice.New(logger, modelRegistry)                            // Phase 2 Draft
	modelSvc.SetPersistencePath(registryPath)
	runtimev1.RegisterRuntimeModelServiceServer(g, modelSvc) // Phase 2 Draft
	localSvc, err := localservice.New(logger, auditStore, cfg.LocalStatePath, cfg.LocalAuditCapacity)
	if err != nil {
		return nil, fmt.Errorf("init local service: %w", err)
	}
	modelSvc.SetLocalModelLister(localSvc)
	runtimev1.RegisterRuntimeLocalServiceServer(g, localSvc)
	aiSvc.SetLocalModelLister(localSvc)
	aiSvc.SetLocalImageProfileResolver(localSvc)
	memorySvc, err := memoryservice.New(logger, cfg)
	if err != nil {
		return nil, fmt.Errorf("init memory service: %w", err)
	}
	memorySvc.SetRuntimeEmbeddingProfileResolver(func(ctx context.Context, snapshot *memoryservice.MemoryEmbeddingBindingIntentSnapshot) memoryservice.MemoryEmbeddingResolvedProfile {
		return resolveRuntimeMemoryEmbeddingProfile(ctx, snapshot, localSvc, connStore, aiSvc.SpeechCatalogResolver())
	})
	memorySvc.SetRuntimeEmbeddingVectorExecutor(aiSvc.EmbedTextsForMemory)
	agentSvc, err := runtimeagentservice.New(logger, cfg.LocalStatePath, memorySvc)
	if err != nil {
		_ = memorySvc.Close()
		return nil, fmt.Errorf("init agent core service: %w", err)
	}
	agentSvc.SetRuntimePrivateAIBridge(runtimeagentservice.NewAIBackedRuntimePrivateAIBridge(aiSvc))
	runtimev1.RegisterRuntimeAgentServiceServer(g, agentSvc)

	// K-SCHED-004: register target-agnostic denial checks. Device profile is
	// collected on each Peek (no caching per K-SCHED-004).

	// Denial 1: disk below safety threshold (K-CFG driven, K-SCHED-004).
	diskDenialThreshold := cfg.SchedulingDiskDenialThresholdBytes
	if diskDenialThreshold <= 0 {
		diskDenialThreshold = 500 * 1024 * 1024 // fallback 500 MB
	}
	aiSvc.RegisterSchedulerDenialCheck(func() (bool, string) {
		resp, err := localSvc.CollectDeviceProfile(context.Background(), &runtimev1.CollectDeviceProfileRequest{})
		if err != nil || resp == nil || resp.GetProfile() == nil {
			return false, ""
		}
		free := resp.GetProfile().GetDiskFreeBytes()
		if free > 0 && free < diskDenialThreshold {
			return true, fmt.Sprintf("disk free space %d bytes is below safety threshold %d bytes", free, diskDenialThreshold)
		}
		return false, ""
	})

	// K-SCHED-004 denial 2: dependency infeasible. Uses profile registry + ResolveProfile preflight.
	// The checker looks up the profile descriptor by (modID, profileID) from the runtime-side
	// profile registry, then calls ResolveProfile to evaluate dependency feasibility.
	profileRegistry := localSvc.GetProfileRegistry()
	aiSvc.SetSchedulerDependencyChecker(func(modID, profileID, capability string) (bool, string) {
		profile := profileRegistry.LookupProfile(modID, profileID)
		if profile == nil {
			return true, "" // profile not found — skip, not deny ("unable to evaluate ≠ infeasible")
		}
		resp, err := localSvc.ResolveProfile(context.Background(), &runtimev1.ResolveProfileRequest{
			ModId:      modID,
			Profile:    profile,
			Capability: capability,
		})
		if err != nil || resp == nil || resp.GetPlan() == nil {
			return true, "" // cannot evaluate — skip, not deny
		}
		execPlan := resp.GetPlan().GetExecutionPlan()
		if execPlan == nil {
			return true, ""
		}
		for _, decision := range execPlan.GetPreflightDecisions() {
			if decision != nil && !decision.GetOk() {
				return false, fmt.Sprintf("dependency infeasible: %s — %s",
					decision.GetReasonCode(), decision.GetDetail())
			}
		}
		return true, ""
	})

	// K-SCHED-005: resource assessor for risk states.
	// Collects device profile on each Peek call (no caching per K-DEV-008).
	aiSvc.SetSchedulerResourceAssessor(func() *scheduler.ResourceSnapshot {
		resp, err := localSvc.CollectDeviceProfile(context.Background(), &runtimev1.CollectDeviceProfileRequest{})
		if err != nil || resp == nil || resp.GetProfile() == nil {
			return nil
		}
		p := resp.GetProfile()
		gpu := p.GetGpu()
		memoryModel := "unknown"
		if gpu != nil {
			switch gpu.GetMemoryModel() {
			case runtimev1.GpuMemoryModel_GPU_MEMORY_MODEL_DISCRETE:
				memoryModel = "discrete"
			case runtimev1.GpuMemoryModel_GPU_MEMORY_MODEL_UNIFIED:
				memoryModel = "unified"
			}
		}
		return &scheduler.ResourceSnapshot{
			TotalRAMBytes:      p.GetTotalRamBytes(),
			AvailableRAMBytes:  p.GetAvailableRamBytes(),
			TotalVRAMBytes:     gpu.GetTotalVramBytes(),
			AvailableVRAMBytes: gpu.GetAvailableVramBytes(),
			DiskFreeBytes:      p.GetDiskFreeBytes(),
			GPUAvailable:       gpu.GetAvailable(),
			MemoryModel:        memoryModel,
		}
	})

	// K-SCHED-005: risk thresholds from config.
	preemptionPct := cfg.SchedulingPreemptionOccupancyPercent
	if preemptionPct <= 0 || preemptionPct > 100 {
		preemptionPct = 75
	}
	aiSvc.SetSchedulerRiskThresholds(scheduler.RiskThresholds{
		SlowdownRAMBytes:         cfg.SchedulingSlowdownRAMThresholdBytes,
		SlowdownVRAMBytes:        cfg.SchedulingSlowdownVRAMThresholdBytes,
		SlowdownDiskBytes:        cfg.SchedulingSlowdownDiskThresholdBytes,
		PreemptionOccupancyRatio: float64(preemptionPct) / 100.0,
	})

	connSvc := connectorservice.New(logger, connStore, auditStore)
	connSvc.SetCloudProvider(aiSvc.CloudProvider())
	connSvc.SetLocalModelLister(localSvc)
	connSvc.SetModelCatalogResolver(aiSvc.SpeechCatalogResolver())
	runtimev1.RegisterRuntimeConnectorServiceServer(g, connSvc)
	logger.Info("runtime in-process mode enabled")

	knowledgeSvc, err := knowledgeservice.NewWithBackend(logger, memorySvc.PersistenceBackend())
	if err != nil {
		_ = memorySvc.Close()
		localSvc.Close()
		return nil, fmt.Errorf("init knowledge service: %w", err)
	}
	cognitionSvc, err := cognitionservice.New(logger, cfg, memorySvc, knowledgeSvc)
	if err != nil {
		_ = knowledgeSvc.Close()
		_ = memorySvc.Close()
		localSvc.Close()
		return nil, fmt.Errorf("init cognition service: %w", err)
	}

	runtimev1.RegisterRuntimeGrantServiceServer(g, grantSvc)
	runtimev1.RegisterRuntimeAuthServiceServer(g, authSvc)
	runtimev1.RegisterRuntimeCognitionServiceServer(g, cognitionSvc)
	appSvc := appservice.New(logger, appservice.WithSessionValidator(authSvc))
	appSvc.RegisterInternalConsumer("runtime.agent.internal.chat_track_sidecar", agentSvc.ConsumeChatTrackSidecarAppMessage)
	appSvc.RegisterInternalConsumer("runtime.agent", agentSvc.ConsumePublicChatAppMessage)
	agentSvc.SetPublicChatAppEmitter(appSvc.SendAppMessage)
	runtimev1.RegisterRuntimeAppServiceServer(g, appSvc) // Phase 2 Draft

	s := &Server{
		addr:             addr,
		state:            state,
		logger:           logger,
		grpcServer:       g,
		healthServer:     h,
		rpcRegistry:      rpcRegistry,
		aiHealth:         aiHealth,
		auditStore:       auditStore,
		aiSvc:            aiSvc,
		appService:       appSvc,
		localService:     localSvc,
		memoryService:    memorySvc,
		cognitionService: cognitionSvc,
		agentService:     agentSvc,
	}
	s.SyncServingState()
	return s, nil
}

func (s *Server) AIHealthTracker() *providerhealth.Tracker {
	return s.aiHealth
}

func (s *Server) AuditStore() *auditlog.Store {
	return s.auditStore
}

func (s *Server) AIService() *aiservice.Service {
	return s.aiSvc
}

func (s *Server) AppService() *appservice.Service {
	return s.appService
}

// LocalService returns the in-process local runtime service for engine
// manager injection.
func (s *Server) LocalService() *localservice.Service {
	return s.localService
}

func (s *Server) MemoryService() *memoryservice.Service {
	return s.memoryService
}

func (s *Server) CognitionService() *cognitionservice.Service {
	return s.cognitionService
}

func (s *Server) AgentService() *runtimeagentservice.Service {
	return s.agentService
}

func resolveRuntimeMemoryEmbeddingProfile(
	ctx context.Context,
	snapshot *memoryservice.MemoryEmbeddingBindingIntentSnapshot,
	localSvc *localservice.Service,
	connStore *connectorservice.ConnectorStore,
	modelCatalog *catalog.Resolver,
) memoryservice.MemoryEmbeddingResolvedProfile {
	normalized := normalizeMemoryEmbeddingBindingIntentSnapshot(snapshot)
	if !memoryEmbeddingBindingIntentPresent(normalized) {
		return memoryservice.MemoryEmbeddingResolvedProfile{
			ResolutionState:   "missing",
			BlockedReasonCode: runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
		}
	}
	switch normalized.SourceKind {
	case memoryservice.MemoryEmbeddingBindingSourceKindLocal:
		return resolveLocalRuntimeMemoryEmbeddingProfile(ctx, normalized, localSvc)
	case memoryservice.MemoryEmbeddingBindingSourceKindCloud:
		return resolveCloudRuntimeMemoryEmbeddingProfile(normalized, connStore, modelCatalog)
	default:
		return memoryservice.MemoryEmbeddingResolvedProfile{
			ResolutionState:   "missing",
			BlockedReasonCode: runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
		}
	}
}

func normalizeMemoryEmbeddingBindingIntentSnapshot(input *memoryservice.MemoryEmbeddingBindingIntentSnapshot) *memoryservice.MemoryEmbeddingBindingIntentSnapshot {
	if input == nil {
		return nil
	}
	out := &memoryservice.MemoryEmbeddingBindingIntentSnapshot{
		SourceKind:    memoryservice.MemoryEmbeddingBindingSourceKind(strings.ToLower(strings.TrimSpace(string(input.SourceKind)))),
		RevisionToken: strings.TrimSpace(input.RevisionToken),
	}
	if input.CloudBinding != nil {
		out.CloudBinding = &memoryservice.MemoryEmbeddingCloudBindingRef{
			ConnectorID: strings.TrimSpace(input.CloudBinding.ConnectorID),
			ModelID:     strings.TrimSpace(input.CloudBinding.ModelID),
		}
		if out.CloudBinding.ConnectorID == "" && out.CloudBinding.ModelID == "" {
			out.CloudBinding = nil
		}
	}
	if input.LocalBinding != nil {
		out.LocalBinding = &memoryservice.MemoryEmbeddingLocalBindingRef{
			LocalModelID: strings.TrimSpace(input.LocalBinding.LocalModelID),
		}
		if out.LocalBinding.LocalModelID == "" {
			out.LocalBinding = nil
		}
	}
	return out
}

func memoryEmbeddingBindingIntentPresent(snapshot *memoryservice.MemoryEmbeddingBindingIntentSnapshot) bool {
	if snapshot == nil {
		return false
	}
	switch snapshot.SourceKind {
	case memoryservice.MemoryEmbeddingBindingSourceKindCloud:
		return snapshot.CloudBinding != nil
	case memoryservice.MemoryEmbeddingBindingSourceKindLocal:
		return snapshot.LocalBinding != nil
	default:
		return false
	}
}

func resolveLocalRuntimeMemoryEmbeddingProfile(
	ctx context.Context,
	snapshot *memoryservice.MemoryEmbeddingBindingIntentSnapshot,
	localSvc *localservice.Service,
) memoryservice.MemoryEmbeddingResolvedProfile {
	if snapshot == nil || snapshot.LocalBinding == nil {
		return memoryservice.MemoryEmbeddingResolvedProfile{
			ResolutionState:   "unresolved",
			BlockedReasonCode: runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE,
		}
	}
	if localSvc == nil {
		return memoryservice.MemoryEmbeddingResolvedProfile{
			ResolutionState:   "unavailable",
			BlockedReasonCode: runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE,
		}
	}
	resp, err := localSvc.ListLocalAssets(ctx, &runtimev1.ListLocalAssetsRequest{
		StatusFilter: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
		KindFilter:   runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_EMBEDDING,
	})
	if err != nil {
		return memoryservice.MemoryEmbeddingResolvedProfile{
			ResolutionState:   "unavailable",
			BlockedReasonCode: runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE,
		}
	}
	targetID := strings.TrimSpace(snapshot.LocalBinding.LocalModelID)
	for _, asset := range resp.GetAssets() {
		if asset == nil {
			continue
		}
		if !memoryEmbeddingLocalTargetMatches(asset, targetID) {
			continue
		}
		return memoryservice.MemoryEmbeddingResolvedProfile{
			Profile: &runtimev1.MemoryEmbeddingProfile{
				Provider:       "local",
				ModelId:        strings.TrimSpace(asset.GetAssetId()),
				Dimension:      256,
				DistanceMetric: runtimev1.MemoryDistanceMetric_MEMORY_DISTANCE_METRIC_COSINE,
				Version: func() string {
					if value := strings.TrimSpace(asset.GetLocalAssetId()); value != "" {
						return value
					}
					return strings.TrimSpace(asset.GetAssetId())
				}(),
				MigrationPolicy: runtimev1.MemoryMigrationPolicy_MEMORY_MIGRATION_POLICY_REINDEX,
			},
			ResolutionState:   "resolved",
			BlockedReasonCode: runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
		}
	}
	return memoryservice.MemoryEmbeddingResolvedProfile{
		ResolutionState:   "unresolved",
		BlockedReasonCode: runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE,
	}
}

func resolveCloudRuntimeMemoryEmbeddingProfile(
	snapshot *memoryservice.MemoryEmbeddingBindingIntentSnapshot,
	connStore *connectorservice.ConnectorStore,
	modelCatalog *catalog.Resolver,
) memoryservice.MemoryEmbeddingResolvedProfile {
	if snapshot == nil || snapshot.CloudBinding == nil {
		return memoryservice.MemoryEmbeddingResolvedProfile{
			ResolutionState:   "unresolved",
			BlockedReasonCode: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
		}
	}
	if connStore == nil || modelCatalog == nil {
		return memoryservice.MemoryEmbeddingResolvedProfile{
			ResolutionState:   "unavailable",
			BlockedReasonCode: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
		}
	}
	connectorID := strings.TrimSpace(snapshot.CloudBinding.ConnectorID)
	modelID := strings.TrimSpace(snapshot.CloudBinding.ModelID)
	record, found, err := connStore.Get(connectorID)
	if err != nil {
		return memoryservice.MemoryEmbeddingResolvedProfile{
			ResolutionState:   "unavailable",
			BlockedReasonCode: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
		}
	}
	if !found ||
		record.Kind != runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED ||
		record.Status != runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE ||
		!record.HasCredential {
		return memoryservice.MemoryEmbeddingResolvedProfile{
			ResolutionState:   "unresolved",
			BlockedReasonCode: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
		}
	}
	providerID := strings.TrimSpace(record.Provider)
	if providerID == "" || modelID == "" {
		return memoryservice.MemoryEmbeddingResolvedProfile{
			ResolutionState:   "unresolved",
			BlockedReasonCode: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
		}
	}
	supported, supportErr := modelCatalog.SupportsCapabilityForSubject("", providerID, modelID, "text.embed")
	if supportErr != nil && !errors.Is(supportErr, catalog.ErrModelNotFound) {
		return memoryservice.MemoryEmbeddingResolvedProfile{
			ResolutionState:   "unavailable",
			BlockedReasonCode: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
		}
	}
	if !supported {
		return memoryservice.MemoryEmbeddingResolvedProfile{
			ResolutionState:   "unresolved",
			BlockedReasonCode: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
		}
	}
	return memoryservice.MemoryEmbeddingResolvedProfile{
		Profile: &runtimev1.MemoryEmbeddingProfile{
			Provider:        providerID,
			ModelId:         modelID,
			Dimension:       256,
			DistanceMetric:  runtimev1.MemoryDistanceMetric_MEMORY_DISTANCE_METRIC_COSINE,
			Version:         connectorID,
			MigrationPolicy: runtimev1.MemoryMigrationPolicy_MEMORY_MIGRATION_POLICY_REINDEX,
		},
		ResolutionState:   "resolved",
		BlockedReasonCode: runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
	}
}

func memoryEmbeddingLocalTargetMatches(asset *runtimev1.LocalAssetRecord, targetID string) bool {
	if asset == nil {
		return false
	}
	normalized := strings.TrimSpace(targetID)
	if normalized == "" {
		return false
	}
	return normalized == strings.TrimSpace(asset.GetAssetId()) || normalized == strings.TrimSpace(asset.GetLocalAssetId())
}

func (s *Server) Serve() error {
	listener, err := net.Listen("tcp", s.addr)
	if err != nil {
		return fmt.Errorf("listen grpc %s: %w", s.addr, err)
	}

	s.logger.Info("grpc server listening", "addr", s.addr)
	if err := s.grpcServer.Serve(listener); err != nil {
		return fmt.Errorf("serve grpc: %w", err)
	}
	return nil
}

type StopResult struct {
	Shutdown ShutdownSummary
}

func (s *Server) BeginShutdown() []activeRPCSnapshot {
	if s.rpcRegistry == nil {
		return []activeRPCSnapshot{}
	}
	return s.rpcRegistry.BeginShutdown()
}

func (s *Server) Stop(ctx context.Context) StopResult {
	if s.rpcRegistry != nil {
		s.rpcRegistry.BeginShutdown()
	}
	done := make(chan struct{})
	go func() {
		s.grpcServer.GracefulStop()
		close(done)
	}()

	select {
	case <-done:
		if s.rpcRegistry == nil {
			return StopResult{}
		}
		return StopResult{Shutdown: s.rpcRegistry.CompleteShutdown(false)}
	case <-ctx.Done():
		s.grpcServer.Stop()
		if s.rpcRegistry == nil {
			return StopResult{}
		}
		return StopResult{Shutdown: s.rpcRegistry.CompleteShutdown(true)}
	}
}

// SyncServingState maps runtime health status to grpc health checks.
func (s *Server) SyncServingState() {
	snapshot := s.state.Snapshot()
	servingStatus := healthpb.HealthCheckResponse_NOT_SERVING
	if snapshot.Status.Ready() {
		servingStatus = healthpb.HealthCheckResponse_SERVING
	}

	s.healthServer.SetServingStatus("", servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeAuditService_ServiceDesc.ServiceName, servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeAiService_ServiceDesc.ServiceName, servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeAiRealtimeService_ServiceDesc.ServiceName, servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeWorkflowService_ServiceDesc.ServiceName, servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeModelService_ServiceDesc.ServiceName, servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeLocalService_ServiceDesc.ServiceName, servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeCognitionService_ServiceDesc.ServiceName, servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeAgentService_ServiceDesc.ServiceName, servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeGrantService_ServiceDesc.ServiceName, servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeAuthService_ServiceDesc.ServiceName, servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeAppService_ServiceDesc.ServiceName, servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeConnectorService_ServiceDesc.ServiceName, servingStatus)
}

// buildCloudConnectorDefs builds cloud connector definitions from config.json providers.
func buildCloudConnectorDefs(cfg config.Config) []connectorservice.CloudConnectorDef {
	if len(cfg.Providers) == 0 {
		return nil
	}
	var defs []connectorservice.CloudConnectorDef
	for configKey, target := range cfg.Providers {
		canonical, ok := config.ResolveCanonicalProviderID(configKey)
		if !ok {
			continue
		}
		apiKey := config.ResolveProviderAPIKey(target)
		if apiKey == "" {
			continue
		}
		endpoint := strings.TrimSpace(target.BaseURL)
		if endpoint == "" {
			endpoint = connectorservice.ResolveEndpoint(canonical, "")
		}
		label := "Cloud " + capitalizeFirst(canonical)
		defs = append(defs, connectorservice.CloudConnectorDef{
			Provider: canonical,
			Endpoint: endpoint,
			APIKey:   apiKey,
			Label:    label,
		})
	}
	return defs
}

func capitalizeFirst(s string) string {
	if s == "" {
		return s
	}
	firstRune, width := utf8.DecodeRuneInString(s)
	if firstRune == utf8.RuneError && width == 0 {
		return s
	}
	return string(unicode.ToUpper(firstRune)) + s[width:]
}

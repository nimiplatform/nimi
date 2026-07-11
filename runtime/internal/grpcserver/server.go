package grpcserver

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appinstallgateway"
	"github.com/nimiplatform/nimi/runtime/internal/appregistry"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/health"
	"github.com/nimiplatform/nimi/runtime/internal/idempotency"
	"github.com/nimiplatform/nimi/runtime/internal/modelregistry"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/providerhealth"
	"github.com/nimiplatform/nimi/runtime/internal/scheduler"
	"github.com/nimiplatform/nimi/runtime/internal/scopecatalog"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	aiservice "github.com/nimiplatform/nimi/runtime/internal/services/ai"
	appservice "github.com/nimiplatform/nimi/runtime/internal/services/app"
	auditservice "github.com/nimiplatform/nimi/runtime/internal/services/audit"
	authservice "github.com/nimiplatform/nimi/runtime/internal/services/auth"
	cognitionservice "github.com/nimiplatform/nimi/runtime/internal/services/cognition"
	connectorservice "github.com/nimiplatform/nimi/runtime/internal/services/connector"
	externalagentservice "github.com/nimiplatform/nimi/runtime/internal/services/externalagent"
	grantservice "github.com/nimiplatform/nimi/runtime/internal/services/grant"
	localservice "github.com/nimiplatform/nimi/runtime/internal/services/localservice"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
	modelservice "github.com/nimiplatform/nimi/runtime/internal/services/model"
	runtimeagentservice "github.com/nimiplatform/nimi/runtime/internal/services/runtimeagent"
	runtimeartifactservice "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	workflowservice "github.com/nimiplatform/nimi/runtime/internal/services/workflow"
	"google.golang.org/grpc"
	grpcHealth "google.golang.org/grpc/health"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
)

// Server wraps the gRPC serving stack for the runtime daemon.
type Server struct {
	addr                 string
	state                *health.State
	logger               *slog.Logger
	grpcServer           *grpc.Server
	protectedServer      *grpc.Server
	installedServer      *grpc.Server
	healthServer         *grpcHealth.Server
	rpcRegistry          *activeRPCRegistry
	aiHealth             *providerhealth.Tracker
	auditStore           *auditlog.Store
	accountService       *accountservice.Service
	authService          *authservice.Service
	aiSvc                *aiservice.Service
	appService           *appservice.Service
	localService         *localservice.Service
	memoryService        *memoryservice.Service
	cognitionService     *cognitionservice.Service
	agentService         *runtimeagentservice.Service
	installedLaunchStore *authservice.InstalledLaunchStore
}

const (
	maxGRPCRecvMessageBytes  = 8 << 20
	maxGRPCSendMessageBytes  = runtimeartifactservice.MaxInlineBytes + (1 << 20)
	maxGRPCConcurrentStreams = 128
	grpcIOBufferBytes        = 32 << 10

	sourceMaterializationRealmJWKSPath = "/api/auth/jwks/source-materialization"
)

type sourceMaterializationWiringDisposition uint8

const (
	sourceMaterializationWiringUnconfigured sourceMaterializationWiringDisposition = iota
	sourceMaterializationWiringReady
	sourceMaterializationWiringRejected
)

type sourceMaterializationWiringConfig struct {
	disposition sourceMaterializationWiringDisposition
	issuer      string
	jwksURL     string
}

func resolveSourceMaterializationWiring(authJWTIssuer, accountRealmBaseURL string) (sourceMaterializationWiringConfig, error) {
	if authJWTIssuer == "" && accountRealmBaseURL == "" {
		return sourceMaterializationWiringConfig{disposition: sourceMaterializationWiringUnconfigured}, nil
	}
	if authJWTIssuer == "" || accountRealmBaseURL == "" {
		return sourceMaterializationWiringConfig{disposition: sourceMaterializationWiringRejected}, fmt.Errorf("source materialization requires Realm issuer and Realm base URL together")
	}
	if authJWTIssuer != strings.TrimSpace(authJWTIssuer) || accountRealmBaseURL != strings.TrimSpace(accountRealmBaseURL) {
		return sourceMaterializationWiringConfig{disposition: sourceMaterializationWiringRejected}, fmt.Errorf("source materialization Realm configuration must not contain surrounding whitespace")
	}

	parsed, err := url.Parse(accountRealmBaseURL)
	if err != nil || !parsed.IsAbs() || parsed.Opaque != "" || parsed.Host == "" || parsed.Hostname() == "" {
		return sourceMaterializationWiringConfig{disposition: sourceMaterializationWiringRejected}, fmt.Errorf("source materialization Realm base URL must be absolute with a host")
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" || strings.Contains(accountRealmBaseURL, "#") {
		return sourceMaterializationWiringConfig{disposition: sourceMaterializationWiringRejected}, fmt.Errorf("source materialization Realm base URL must not contain userinfo, query, or fragment")
	}

	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "https" && !(scheme == "http" && isSourceMaterializationLoopbackHost(parsed.Hostname())) {
		return sourceMaterializationWiringConfig{disposition: sourceMaterializationWiringRejected}, fmt.Errorf("source materialization Realm base URL must use HTTPS outside loopback")
	}

	parsed.Scheme = scheme
	parsed.Path = sourceMaterializationRealmJWKSPath
	parsed.RawPath = ""
	parsed.RawQuery = ""
	parsed.ForceQuery = false
	parsed.Fragment = ""
	parsed.RawFragment = ""
	return sourceMaterializationWiringConfig{
		disposition: sourceMaterializationWiringReady,
		issuer:      authJWTIssuer,
		jwksURL:     parsed.String(),
	}, nil
}

func isSourceMaterializationLoopbackHost(host string) bool {
	host = strings.Trim(strings.ToLower(host), "[]")
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

// ProtectedServiceBindings are supplied only after the OS-specific service
// principal, state root, and secure store have been verified. No field is
// sourced from argv, environment, renderer IPC, or user-writable config.
type ProtectedServiceBindings struct {
	ServiceStateRoot         string
	PlatformAppRegistryPath  string
	PlatformBundledAppsRoot  string
	AccountCustody           accountservice.Custody
	AccountPartition         string
	AccountRealmBaseURL      string
	AccountAuthorizationURL  string
	AccountTokenURL          string
	ConnectorSecrets         connectorservice.SecretStore
	DesktopSessions          *protectedlocal.DesktopSessionManager
	LifecycleIntents         *protectedlocal.LifecycleIntentManager
	InstalledProcessVerifier protectedlocal.InstalledProcessVerifier
	InstalledLaunches        *protectedlocal.InstalledLaunchRegistry
}

func NewNonProduction(cfg config.Config, state *health.State, logger *slog.Logger, version string) (*Server, error) {
	return newServer(cfg, state, logger, version, nil)
}

func NewProtectedService(cfg config.Config, state *health.State, logger *slog.Logger, version string, bindings ProtectedServiceBindings) (*Server, error) {
	stateRoot := filepath.Clean(strings.TrimSpace(bindings.ServiceStateRoot))
	if !filepath.IsAbs(stateRoot) || stateRoot == filepath.VolumeName(stateRoot)+string(filepath.Separator) {
		return nil, fmt.Errorf("protected service state root must be an absolute non-root path")
	}
	if bindings.AccountCustody == nil || strings.TrimSpace(bindings.AccountPartition) == "" || bindings.ConnectorSecrets == nil || bindings.DesktopSessions == nil || bindings.LifecycleIntents == nil {
		return nil, fmt.Errorf("protected service custody, verified account partition, Desktop sessions, and lifecycle intent authority are required")
	}
	registryPath, err := normalizeOptionalProtectedResourcePath("Platform app registry", bindings.PlatformAppRegistryPath)
	if err != nil {
		return nil, err
	}
	bundledAppsRoot, err := normalizeOptionalProtectedResourcePath("Platform bundled apps root", bindings.PlatformBundledAppsRoot)
	if err != nil {
		return nil, err
	}
	if err := bindings.DesktopSessions.ValidateBootScoped(context.Background()); err != nil {
		return nil, fmt.Errorf("validate protected Desktop session authority: %w", err)
	}
	if err := bindings.LifecycleIntents.ValidateBootScoped(context.Background(), bindings.DesktopSessions); err != nil {
		return nil, fmt.Errorf("validate protected lifecycle intent authority: %w", err)
	}
	bindings.ServiceStateRoot = stateRoot
	bindings.PlatformAppRegistryPath = registryPath
	bindings.PlatformBundledAppsRoot = bundledAppsRoot
	cfg.LocalStatePath = filepath.Join(stateRoot, "runtime", "local-state.json")
	// Production catalog/release selection is a native bootstrap binding. The
	// portable config/env fields remain available only to non-production
	// harnesses and cannot select protected app admission or bundled code.
	cfg.AppRegistryPath = registryPath
	cfg.AppBundledArtifactsRoot = bundledAppsRoot
	return newServer(cfg, state, logger, version, &bindings)
}

func normalizeOptionalProtectedResourcePath(label string, value string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", nil
	}
	cleaned := filepath.Clean(trimmed)
	if !filepath.IsAbs(cleaned) || cleaned == filepath.VolumeName(cleaned)+string(filepath.Separator) {
		return "", fmt.Errorf("%s must be an absolute non-root path", label)
	}
	return cleaned, nil
}

func newServer(cfg config.Config, state *health.State, logger *slog.Logger, version string, protected *ProtectedServiceBindings) (*Server, error) {
	addr := cfg.GRPCAddr
	auditStore := auditlog.New(cfg.AuditRingBufferSize, cfg.UsageStatsBufferSize)
	idempotencyStore, err := idempotency.New(24*time.Hour, cfg.IdempotencyCapacity)
	if err != nil {
		return nil, fmt.Errorf("configure idempotency store: %w", err)
	}
	appRegistry := appregistry.New()
	var installedLaunchStore *authservice.InstalledLaunchStore
	var installedLaunchRegistry *protectedlocal.InstalledLaunchRegistry
	if protected != nil {
		installedLaunchStore, err = authservice.OpenInstalledLaunchStore(
			filepath.Join(protected.ServiceStateRoot, "installed-launch.db"),
			protected.DesktopSessions.BootEpoch(),
		)
		if err != nil {
			return nil, fmt.Errorf("open installed launch store: %w", err)
		}
		installedLaunchRegistry = protected.InstalledLaunches
	}
	keepInstalledLaunchStore := false
	defer func() {
		if !keepInstalledLaunchStore && installedLaunchStore != nil {
			_ = installedLaunchStore.Close()
		}
	}()
	nimiAppRegistry, nimiAppReleases, err := loadNimiAppRegistryCatalog(cfg.AppRegistryPath)
	if err != nil {
		return nil, err
	}
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
	capabilityAuthorizer := protectedCapabilityAuthorizer(protectedCarrierOnlyCapabilityAuthorizer{})
	var grantSvc *grantservice.Service
	if protected == nil {
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
		grantSvc = grantservice.NewWithDependencies(logger, appRegistry, scopeCatalog,
			grantservice.WithAuditStore(auditStore),
			grantservice.WithTTLBounds(cfg.SessionTTLMinSeconds, cfg.SessionTTLMaxSeconds),
			grantservice.WithMaxDelegationDepth(cfg.MaxDelegationDepth),
		)
		capabilityAuthorizer = grantSvc
	}
	authOptions := make([]authservice.Option, 0, 1)
	if protected != nil {
		authOptions = append(authOptions, authservice.WithDesktopSessionManager(protected.DesktopSessions))
		authOptions = append(authOptions, authservice.WithInstalledLaunchStore(installedLaunchStore))
	}
	authSvc := authservice.NewWithDependencies(
		logger, appRegistry, auditStore,
		int32(cfg.SessionTTLMinSeconds), int32(cfg.SessionTTLMaxSeconds),
		authOptions...,
	)
	authSvc.SetNimiAppRegistryCatalog(nimiAppRegistry)
	authSvc.SetFirstPartyMigrationLaunchGate(defaultFirstPartyMigrationLaunchGate())
	authSvc.SetDeveloperRegistrationEnabled(cfg.AuthDeveloperRegistrationEnabled)
	var protectedGRPCServer *grpc.Server
	var installedGRPCServer *grpc.Server
	accountSvc := accountservice.New(logger)
	if protected != nil {
		accountSvc = accountservice.NewProduction(logger, accountservice.ProductionConfig{
			RealmBaseURL:        protected.AccountRealmBaseURL,
			AuthorizationURL:    protected.AccountAuthorizationURL,
			TokenURL:            protected.AccountTokenURL,
			CustodyPartition:    protected.AccountPartition,
			Custody:             protected.AccountCustody,
			AppRegistry:         appRegistry,
			AppSessionValidator: authSvc,
		})
	}
	authSvc.SetRuntimeAccountSecurityContextProvider(accountSvc)
	accountSvc.SetInstalledSessionResolver(authSvc)

	// AuthN validator — JWKS mode (K-AUTHN-004). revocationUrl shares the
	// bearer JWT restart config group with issuer/audience/jwksUrl, so the full
	// group must validate together or the chain fails closed (K-AUTHN-006).
	authnValidator, authnErr := authn.NewValidator(cfg.AuthJWTJWKSURL, cfg.AuthJWTIssuer, cfg.AuthJWTAudience)
	if authnErr == nil {
		authnErr = authn.ValidateConfigGroup(cfg.AuthJWTJWKSURL, cfg.AuthJWTIssuer, cfg.AuthJWTAudience, cfg.AuthJWTRevocationURL)
	}
	if authnErr != nil {
		logger.Warn("JWT authn validator init failed; all JWT tokens will be rejected", "error", authnErr)
		authnValidator, _ = authn.NewValidator("", "", "")
	} else {
		authnValidator.SetRevocationURL(cfg.AuthJWTRevocationURL)
	}

	g := grpc.NewServer(
		grpc.MaxRecvMsgSize(maxGRPCRecvMessageBytes),
		grpc.MaxSendMsgSize(maxGRPCSendMessageBytes),
		grpc.MaxConcurrentStreams(maxGRPCConcurrentStreams),
		grpc.ReadBufferSize(grpcIOBufferBytes),
		grpc.WriteBufferSize(grpcIOBufferBytes),
		grpc.ChainUnaryInterceptor(
			newUnaryVersionInterceptor(logger, version),
			newUnaryLifecycleInterceptor(state),
			newUnaryPublicTransportInterceptor(),
			newUnaryActivityInterceptor(rpcRegistry),
			newUnaryProtocolInterceptor(idempotencyStore),
			authn.NewUnaryInterceptor(authnValidator),
			newUnaryAuthzInterceptor(capabilityAuthorizer),
			newUnaryCredentialScrubInterceptor(),
			newUnaryAuditInterceptor(auditStore),
		),
		grpc.ChainStreamInterceptor(
			newStreamVersionInterceptor(logger, version),
			newStreamLifecycleInterceptor(state),
			newStreamPublicTransportInterceptor(),
			newStreamActivityInterceptor(rpcRegistry),
			newStreamProtocolInterceptor(),
			authn.NewStreamInterceptor(authnValidator),
			newStreamAuthzInterceptor(capabilityAuthorizer),
			newStreamCredentialScrubInterceptor(),
			newStreamAuditInterceptor(auditStore),
		),
	)
	healthpb.RegisterHealthServer(g, h)
	runtimev1.RegisterRuntimeAuditServiceServer(g, auditservice.New(state, logger, aiHealth, auditStore))

	connectorBasePath := filepath.Join(filepath.Dir(cfg.LocalStatePath), "connectors")
	connStore := connectorservice.NewConnectorStore(connectorBasePath)
	if protected != nil {
		connectorBasePath = filepath.Join(protected.ServiceStateRoot, "connectors")
		connStore = connectorservice.NewConnectorStoreWithSecretStore(connectorBasePath, protected.ConnectorSecrets)
	}
	if err := connStore.ReconcileStartup(); err != nil {
		return nil, fmt.Errorf("reconcile connector store: %w", err)
	}
	artifactStore, err := runtimeartifactservice.NewDiskStoreForLocalStatePath(cfg.LocalStatePath)
	if err != nil {
		return nil, fmt.Errorf("init runtime artifact store: %w", err)
	}
	var aiSvc *aiservice.Service
	if protected != nil {
		aiSvc, err = aiservice.NewProtected(logger, modelRegistry, aiHealth, auditStore, connStore, cfg)
	} else {
		aiSvc, err = aiservice.New(logger, modelRegistry, aiHealth, auditStore, connStore, cfg)
	}
	if err != nil {
		return nil, fmt.Errorf("init ai service: %w", err)
	}
	aiSvc.SetRuntimeArtifactStore(artifactStore)
	aiSvc.SetModelRegistryPersistencePath(registryPath)
	runtimev1.RegisterRuntimeAiServiceServer(g, aiSvc)
	runtimev1.RegisterRuntimeAiRealtimeServiceServer(g, aiSvc)

	runtimev1.RegisterRuntimeWorkflowServiceServer(g, workflowservice.New(logger)) // Phase 2 Draft
	modelSvc := modelservice.New(logger, modelRegistry)                            // Phase 2 Draft
	modelSvc.SetPersistencePath(registryPath)
	runtimev1.RegisterRuntimeModelServiceServer(g, modelSvc) // Phase 2 Draft
	localSvc, err := localservice.New(logger, auditStore, cfg.LocalStatePath, cfg.LocalAuditCapacity, cfg.LocalModelsPath, cfg.DataRootRef)
	if err != nil {
		return nil, fmt.Errorf("init local service: %w", err)
	}
	if err := localSvc.SetProductVersion(version); err != nil {
		return nil, fmt.Errorf("init local service product version: %w", err)
	}
	localSvc.SetRuntimeAccountProjectionProvider(accountSvc)
	modelSvc.SetLocalModelLister(localSvc)
	runtimev1.RegisterRuntimeLocalServiceServer(g, localSvc)
	aiSvc.SetLocalModelLister(localSvc)
	aiSvc.SetLocalImageProfileResolver(localSvc)
	// K-AIEXEC-007: inject the ai service local execution capability into the
	// localservice executionEvidenceRef minter. The adapter is internal to the
	// runtime and carries no global state.
	localSvc.SetFirstRunLocalExecutor(newFirstRunLocalExecutorAdapter(aiSvc))
	localSvc.SetLocalProviderEndpointSink(aiSvc)
	memorySvc, err := memoryservice.New(logger, cfg)
	if err != nil {
		return nil, fmt.Errorf("init memory service: %w", err)
	}
	memorySvc.SetRuntimeEmbeddingProfileResolver(func(ctx context.Context, snapshot *memoryservice.MemoryEmbeddingTextEmbedIntentSnapshot) memoryservice.MemoryEmbeddingResolvedProfile {
		return resolveRuntimeMemoryEmbeddingProfile(ctx, snapshot, localSvc, connStore, aiSvc.SpeechCatalogResolver())
	})
	memorySvc.SetRuntimeEmbeddingVectorExecutor(aiSvc.EmbedTextsForMemory)
	agentSvc, err := runtimeagentservice.New(logger, cfg.LocalStatePath, memorySvc)
	if err != nil {
		_ = memorySvc.Close()
		return nil, fmt.Errorf("init agent core service: %w", err)
	}
	agentSvc.SetSourceMaterializationProductCommitter(agentSvc)
	if cfg.RuntimeID == "" {
		logger.Warn("source materialization disabled; Runtime identity is not configured")
	} else if err := agentSvc.SetSourceMaterializationRuntimeIdentity(cfg.RuntimeID); err != nil {
		logger.Warn("source materialization disabled; Runtime identity binding failed", "error", err)
	}
	materializationWiring, materializationWiringErr := resolveSourceMaterializationWiring(cfg.AuthJWTIssuer, cfg.AccountRealmBaseURL)
	if materializationWiringErr != nil {
		logger.Warn("source materialization disabled; Realm admission configuration is invalid", "error", materializationWiringErr)
	} else if materializationWiring.disposition == sourceMaterializationWiringUnconfigured {
		logger.Warn("source materialization disabled; Realm admission is not configured")
	} else {
		materializationAdmission, err := runtimeagentservice.NewSourceMaterializationV2Admission(
			materializationWiring.issuer,
			materializationWiring.jwksURL,
			nil,
		)
		if err != nil {
			logger.Warn("source materialization disabled; Realm admission initialization failed", "error", err)
		} else {
			agentSvc.SetSourceMaterializationAdmission(materializationAdmission)
		}
	}
	agentSvc.SetScopedBindingValidator(accountSvc)
	agentSvc.SetAuditStore(auditStore)
	// K-AGCORE-146: Runtime Agent AI Config readiness recomputes on provider health
	// change evidence.
	agentSvc.SetProviderHealthTracker(aiHealth)
	agentSvc.SetRuntimeArtifactStore(artifactStore)
	agentSvc.SetRuntimePrivateAIBridge(runtimeagentservice.NewAIBackedRuntimePrivateAIBridge(aiSvc))
	agentSvc.SetVoiceAssetResolver(runtimeagentservice.NewAIBackedVoiceAssetResolver(aiSvc))
	agentSvc.SetVoiceLipsyncScenarioExecutor(aiSvc, "", runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED)
	memorySvc.SetRuntimeEmbeddingIntentResolver(agentSvc.ResolveMemoryEmbeddingIntent)
	memorySvc.SetMemoryEmbeddingTargetAuthorizer(agentSvc.AuthorizeMemoryEmbeddingTarget)
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
	// The checker looks up the profile descriptor by (targetID, profileID) from the runtime-side
	// profile registry, then calls ResolveProfile to evaluate dependency feasibility.
	profileRegistry := localSvc.GetProfileRegistry()
	aiSvc.SetSchedulerDependencyChecker(func(targetID, profileID, capability string) (bool, string) {
		profile := profileRegistry.LookupProfile(targetID, profileID)
		if profile == nil {
			return true, "" // profile not found — skip, not deny ("unable to evaluate ≠ infeasible")
		}
		resp, err := localSvc.ResolveProfile(context.Background(), &runtimev1.ResolveProfileRequest{
			TargetId:   targetID,
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

	knowledgeAuthorizer := cognitionservice.NewAccountKnowledgeAuthorizer(logger, accountSvc)
	// C-APMEM-001: Cognition owns the app memory/knowledge/skill access
	// policy decision; the realm grant lifecycle decides scope usability
	// through the AppMemoryGrantChecker seam. No real checker is bindable
	// yet: grant.Service token state (internal/services/grant) carries no
	// agent persona dimension and no per-grant realm audit event id, and
	// its validation surfaces (ValidateAppAccessToken /
	// ValidateProtectedCapability) require the caller-held token secret,
	// which the cognition memory wire surface does not carry. Until the
	// realm grant projection wave binds a real checker, the seam stays
	// unbound (nil) and the app-facing memory gate fails closed with
	// deny reason apmem_grant_checker_unbound (C-APMEM-004
	// no-implicit-allow) instead of fake-allowing.
	cognitionSvc, err := cognitionservice.New(logger, cfg, memorySvc, knowledgeAuthorizer, nil)
	if err != nil {
		_ = memorySvc.Close()
		localSvc.Close()
		return nil, fmt.Errorf("init cognition service: %w", err)
	}

	if grantSvc != nil {
		runtimev1.RegisterRuntimeGrantServiceServer(g, grantSvc)
	}
	runtimev1.RegisterRuntimeExternalAgentServiceServer(g, externalagentservice.New(logger))
	runtimev1.RegisterRuntimeAuthServiceServer(g, authSvc)
	runtimev1.RegisterRuntimeAccountServiceServer(g, accountSvc)
	runtimev1.RegisterRuntimeCognitionServiceServer(g, cognitionSvc)
	appInstallRuntime, err := appservice.NewInstallRuntime(
		nimiAppRegistry,
		nimiAppReleases,
		cfg.DataRootRef,
		cfg.AppBundledArtifactsRoot,
		appinstallgateway.NewHTTPSDownloader(),
		appinstallgateway.NewArchiveUnpacker(),
	)
	if err != nil {
		_ = memorySvc.Close()
		localSvc.Close()
		return nil, fmt.Errorf("init Nimi App install runtime: %w", err)
	}
	appOptions := []appservice.Option{
		appservice.WithSessionValidator(authSvc),
		appservice.WithScopedBindingValidator(accountSvc),
		appservice.WithAppStorageDataRoot(cfg.DataRootRef),
		appservice.WithInstallRuntime(appInstallRuntime),
		appservice.WithRuntimeAppRegistry(appRegistry),
		appservice.WithRuntimeAccountProjectionProvider(accountSvc),
		appservice.WithOpenAppReadinessVerifier(appservice.NewAccountProjectionOpenAppReadinessVerifier(accountSvc)),
	}
	if protected != nil {
		appOptions = append(appOptions,
			appservice.WithLifecycleIntentManager(protected.LifecycleIntents),
			appservice.WithInstalledLaunchStore(installedLaunchStore),
			appservice.WithInstalledLaunchProcessBinding(installedLaunchRegistry, protected.InstalledProcessVerifier),
		)
	}
	appSvc := appservice.New(logger, appOptions...)
	if protected != nil {
		protectedGRPCServer = newProtectedDesktopRPCServer(authSvc, accountSvc, appSvc, protected.DesktopSessions)
		installedGRPCServer = newProtectedInstalledRPCServer(authSvc)
	}
	appSvc.RegisterInternalConsumer("runtime.agent.internal.chat_track_sidecar", agentSvc.ConsumeChatTrackSidecarAppMessage)
	appSvc.RegisterInternalConsumer("runtime.agent", agentSvc.ConsumePublicChatAppMessage)
	agentSvc.SetPublicChatAppEmitter(func(ctx context.Context, req *runtimev1.SendAppMessageRequest) (*runtimev1.SendAppMessageResponse, error) {
		if req == nil {
			return appSvc.SendAppMessage(ctx, req)
		}
		return appSvc.SendAppMessage(appservice.WithTrustedInternalCaller(ctx, req.GetFromAppId()), req)
	})
	runtimev1.RegisterRuntimeAppServiceServer(g, appSvc) // Phase 2 Draft

	artifactSvc := runtimeartifactservice.New(artifactStore, logger, runtimeartifactservice.WithInstalledOperationAuthorizer(accountSvc))
	runtimev1.RegisterRuntimeArtifactServiceServer(g, artifactSvc)

	s := &Server{
		addr:                 addr,
		state:                state,
		logger:               logger,
		grpcServer:           g,
		protectedServer:      protectedGRPCServer,
		installedServer:      installedGRPCServer,
		healthServer:         h,
		rpcRegistry:          rpcRegistry,
		aiHealth:             aiHealth,
		auditStore:           auditStore,
		accountService:       accountSvc,
		authService:          authSvc,
		aiSvc:                aiSvc,
		appService:           appSvc,
		localService:         localSvc,
		memoryService:        memorySvc,
		cognitionService:     cognitionSvc,
		agentService:         agentSvc,
		installedLaunchStore: installedLaunchStore,
	}
	s.SyncServingState()
	keepInstalledLaunchStore = true
	return s, nil
}

func (s *Server) AIHealthTracker() *providerhealth.Tracker {
	return s.aiHealth
}

func (s *Server) AuditStore() *auditlog.Store {
	return s.auditStore
}

func (s *Server) AccountService() *accountservice.Service {
	return s.accountService
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

// ServeProtected serves the dedicated native Desktop control transport. The
// listener must yield only connections wrapped after OS peer verification.
func (s *Server) ServeProtected(listener net.Listener) error {
	if s == nil || s.protectedServer == nil {
		return fmt.Errorf("protected Desktop gRPC server is unavailable")
	}
	if listener == nil {
		return fmt.Errorf("protected Desktop listener is required")
	}
	if err := s.protectedServer.Serve(listener); err != nil {
		return fmt.Errorf("serve protected Desktop gRPC: %w", err)
	}
	return nil
}

// ServeVerifiedNativeDesktop serves protected Desktop gRPC only after the
// native listener has minted an opaque OS-verified connection carrier.
func (s *Server) ServeVerifiedNativeDesktop(listener net.Listener) error {
	if listener == nil {
		return fmt.Errorf("verified native Desktop listener is required")
	}
	return s.ServeProtected(&nativeVerifiedDesktopListener{Listener: listener})
}

func (s *Server) ServeVerifiedNativeInstalled(listener net.Listener) error {
	if s == nil || s.installedServer == nil {
		return fmt.Errorf("protected installed gRPC server is unavailable")
	}
	if listener == nil {
		return fmt.Errorf("verified native installed listener is required")
	}
	if err := s.installedServer.Serve(&nativeVerifiedInstalledListener{Listener: listener}); err != nil {
		return fmt.Errorf("serve protected installed gRPC: %w", err)
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
	defer func() {
		if s.installedLaunchStore != nil {
			_ = s.installedLaunchStore.Close()
		}
	}()
	if s.rpcRegistry != nil {
		s.rpcRegistry.BeginShutdown()
	}
	done := make(chan struct{})
	go func() {
		if s.protectedServer != nil {
			s.protectedServer.GracefulStop()
		}
		if s.installedServer != nil {
			s.installedServer.GracefulStop()
		}
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
		if s.protectedServer != nil {
			s.protectedServer.Stop()
		}
		if s.installedServer != nil {
			s.installedServer.Stop()
		}
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
	s.healthServer.SetServingStatus(runtimev1.RuntimeExternalAgentService_ServiceDesc.ServiceName, servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeAuthService_ServiceDesc.ServiceName, servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeAccountService_ServiceDesc.ServiceName, servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeAppService_ServiceDesc.ServiceName, servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeConnectorService_ServiceDesc.ServiceName, servingStatus)
}

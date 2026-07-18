package grpcserver

import (
	"context"
	"fmt"
	"log/slog"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appregistry"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/health"
	"github.com/nimiplatform/nimi/runtime/internal/idempotency"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/modelregistry"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/providerhealth"
	"github.com/nimiplatform/nimi/runtime/internal/scheduler"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	aiservice "github.com/nimiplatform/nimi/runtime/internal/services/ai"
	appservice "github.com/nimiplatform/nimi/runtime/internal/services/app"
	auditservice "github.com/nimiplatform/nimi/runtime/internal/services/audit"
	authservice "github.com/nimiplatform/nimi/runtime/internal/services/auth"
	cognitionservice "github.com/nimiplatform/nimi/runtime/internal/services/cognition"
	connectorservice "github.com/nimiplatform/nimi/runtime/internal/services/connector"
	externalagentservice "github.com/nimiplatform/nimi/runtime/internal/services/externalagent"
	localservice "github.com/nimiplatform/nimi/runtime/internal/services/localservice"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
	modelservice "github.com/nimiplatform/nimi/runtime/internal/services/model"
	runtimeagentservice "github.com/nimiplatform/nimi/runtime/internal/services/runtimeagent"
	runtimeartifactservice "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	runtimecontrolservice "github.com/nimiplatform/nimi/runtime/internal/services/runtimecontrol"
	workflowservice "github.com/nimiplatform/nimi/runtime/internal/services/workflow"
	"google.golang.org/grpc"
	grpcHealth "google.golang.org/grpc/health"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
)

// Server wraps the gRPC serving stack for the runtime daemon.
type Server struct {
	addr                  string
	state                 *health.State
	logger                *slog.Logger
	grpcServer            *grpc.Server
	protectedServer       *grpc.Server
	localAppServer        *grpc.Server
	healthServer          *grpcHealth.Server
	rpcRegistry           *activeRPCRegistry
	aiHealth              *providerhealth.Tracker
	auditStore            *auditlog.Store
	accountService        *accountservice.Service
	authService           *authservice.Service
	aiSvc                 *aiservice.Service
	appService            *appservice.Service
	localService          *localservice.Service
	memoryService         *memoryservice.Service
	cognitionService      *cognitionservice.Service
	agentService          *runtimeagentservice.Service
	localDevelopmentStore interface{ Close() error }
	localAppKernel        *localappkernel.Kernel
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
	LocalOSUserSID           string
	AccountRealmBaseURL      string
	AccountAuthorizationURL  string
	AccountTokenURL          string
	ConnectorSecrets         connectorservice.SecretStore
	DesktopSessions          *protectedlocal.DesktopSessionManager
	LocalAppLaunches         *protectedlocal.LocalAppLaunchRegistry
	LocalDevelopmentVerifier protectedlocal.LocalDevelopmentProcessVerifier
	RuntimeRestartRequester  runtimecontrolservice.RestartRequester
}

func NewNonProduction(cfg config.Config, state *health.State, logger *slog.Logger, version string) (*Server, error) {
	return newServer(cfg, state, logger, version, nil)
}

func NewProtectedService(cfg config.Config, state *health.State, logger *slog.Logger, version string, bindings ProtectedServiceBindings) (*Server, error) {
	stateRoot := filepath.Clean(strings.TrimSpace(bindings.ServiceStateRoot))
	if !filepath.IsAbs(stateRoot) || stateRoot == filepath.VolumeName(stateRoot)+string(filepath.Separator) {
		return nil, fmt.Errorf("protected service state root must be an absolute non-root path")
	}
	if bindings.AccountCustody == nil || strings.TrimSpace(bindings.AccountPartition) == "" || strings.TrimSpace(bindings.LocalOSUserSID) == "" || bindings.ConnectorSecrets == nil || bindings.DesktopSessions == nil || bindings.LocalAppLaunches == nil || bindings.LocalDevelopmentVerifier == nil || bindings.RuntimeRestartRequester == nil {
		return nil, fmt.Errorf("protected service custody, verified account partition, Desktop sessions, local-app launches, and local-development verifier are required")
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
	var localDevelopmentStore *appservice.LocalDevelopmentStore
	var localAppKernel *localappkernel.Kernel
	if protected != nil {
		developmentStore, developmentErr := appservice.OpenLocalDevelopmentStore(
			filepath.Join(protected.ServiceStateRoot, "local-development.db"),
			protected.DesktopSessions.BootEpoch(),
		)
		if developmentErr != nil {
			return nil, fmt.Errorf("open local-development store: %w", developmentErr)
		}
		localDevelopmentStore = developmentStore
		verifiedSID, sidErr := localappkernel.ValidateVerifiedInteractiveUserSID(protected.LocalOSUserSID)
		if sidErr != nil {
			return nil, fmt.Errorf("validate protected interactive-user SID: %w", sidErr)
		}
		kernel, kernelErr := localappkernel.OpenSQLite(
			context.Background(),
			filepath.Join(protected.ServiceStateRoot, "local-app-kernel.db"),
			verifiedSID,
			localappkernel.Options{},
		)
		if kernelErr != nil {
			return nil, fmt.Errorf("open local-app kernel: %w", kernelErr)
		}
		localAppKernel = kernel
	}
	keepLocalDevelopmentStore := false
	defer func() {
		if !keepLocalDevelopmentStore && localDevelopmentStore != nil {
			_ = localDevelopmentStore.Close()
		}
		if !keepLocalDevelopmentStore && localAppKernel != nil {
			_ = localAppKernel.Close()
		}
	}()
	nimiAppRegistry, _, err := loadNimiAppRegistryCatalog(cfg.AppRegistryPath)
	if err != nil {
		return nil, err
	}
	registryPath := modelregistry.ResolvePersistencePath()
	if protected != nil {
		registryPath = filepath.Join(protected.ServiceStateRoot, "runtime", "model-registry.json")
	}
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
	authOptions := make([]authservice.Option, 0, 1)
	if protected != nil {
		authOptions = append(authOptions, authservice.WithDesktopSessionManager(protected.DesktopSessions))
	}
	authSvc := authservice.NewWithDependencies(
		logger, appRegistry, auditStore,
		int32(cfg.SessionTTLMinSeconds), int32(cfg.SessionTTLMaxSeconds),
		authOptions...,
	)
	authSvc.SetNimiAppRegistryCatalog(nimiAppRegistry)
	authSvc.SetFirstPartyMigrationLaunchGate(defaultFirstPartyMigrationLaunchGate())
	var protectedGRPCServer *grpc.Server
	var localAppGRPCServer *grpc.Server
	accountSvc := accountservice.New(logger)
	if protected != nil {
		localAppGrantControl := newLocalAppGrantControlBridge(protected.DesktopSessions)
		accountSvc = accountservice.NewProduction(logger, accountservice.ProductionConfig{
			RealmBaseURL:         protected.AccountRealmBaseURL,
			AuthorizationURL:     protected.AccountAuthorizationURL,
			TokenURL:             protected.AccountTokenURL,
			CustodyPartition:     protected.AccountPartition,
			Custody:              protected.AccountCustody,
			AppRegistry:          appRegistry,
			AppSessionValidator:  authSvc,
			LocalAppKernel:       localAppKernel,
			LocalAppGrantControl: localAppGrantControl,
			AuditStore:           auditStore,
		})
	}
	authSvc.SetRuntimeAccountSecurityContextProvider(accountSvc)
	runtimeControlSvc := runtimecontrolservice.New(nil, nil)
	if protected != nil {
		runtimeControlSvc = runtimecontrolservice.New(protected.DesktopSessions, protected.RuntimeRestartRequester)
	}

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
	auditSvc := auditservice.New(state, logger, aiHealth, auditStore)
	runtimev1.RegisterRuntimeAuditServiceServer(g, auditSvc)

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
	serviceConfigPath, err := config.ServiceOwnedConfigPath(cfg.LocalStatePath)
	if err != nil {
		return nil, fmt.Errorf("resolve service-owned Runtime config path: %w", err)
	}
	localSvc.SetProductControlDataRootConfigWriter(func(dataRootRef string) (bool, error) {
		return config.WriteServiceOwnedDataRoot(serviceConfigPath, dataRootRef)
	})
	if protected != nil {
		if err := localSvc.SetProductControlRoot(protected.ServiceStateRoot); err != nil {
			return nil, fmt.Errorf("bind protected product-control root: %w", err)
		}
		if cfg.NonReleaseDevKernelCheckpoint != nil {
			proposal, err := resolveProtectedProductControlDataRootProposal(protected.LocalOSUserSID, cfg.NonReleaseDevKernelCheckpoint)
			if err != nil {
				return nil, fmt.Errorf("resolve non-release Product Control data-root proposal: %w", err)
			}
			if err := localSvc.SetProductControlDataRootProposal(proposal); err != nil {
				return nil, fmt.Errorf("bind non-release Product Control data-root proposal: %w", err)
			}
		}
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
	if cfg.RuntimeID == "" {
		logger.Warn("source materialization disabled; Runtime identity is not configured")
	} else if err := agentSvc.SetSourceMaterializationRuntimeIdentity(cfg.RuntimeID); err != nil {
		logger.Warn("source materialization disabled; Runtime identity binding failed", "error", err)
	}
	materializationWiring, materializationWiringErr := resolveSourceMaterializationWiring(cfg.AuthJWTIssuer, cfg.AccountRealmBaseURL)
	if materializationWiringErr != nil {
		logger.Warn("source materialization disabled; Realm admission configuration is invalid", "error", materializationWiringErr)
	} else if materializationWiring.disposition == sourceMaterializationWiringUnconfigured {
		logger.Warn("source materialization disabled; Realm acquisition is not configured")
	} else {
		materializationIssuer, err := newAccountRealmSourceMaterializationIssuer(accountSvc, materializationWiring.issuer)
		if err != nil {
			logger.Warn("source materialization disabled; Realm acquisition initialization failed", "error", err)
		} else {
			agentSvc.SetRealmSourceMaterializationIssuer(materializationIssuer)
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
	if acceptance := cfg.NonReleaseDevKernelCheckpoint; acceptance != nil {
		if protected == nil {
			agentSvc.Close()
			_ = memorySvc.Close()
			return nil, fmt.Errorf("dev-kernel checkpoint seed requires the fixed protected service")
		}
		seededAgent, seedErr := agentSvc.EnsureDevKernelCheckpointSeed(context.Background(), runtimeagentservice.DevKernelCheckpointSeed{
			OwnerUserID:      acceptance.PrimaryAccountID,
			LocalAgentRef:    acceptance.LocalAgentRef,
			RuntimeSourceRef: acceptance.RuntimeSourceRef,
			DisplayName:      acceptance.AgentDisplayName,
		})
		if seedErr != nil {
			agentSvc.Close()
			_ = memorySvc.Close()
			return nil, fmt.Errorf("seed non-release dev-kernel RuntimeAgent: %w", seedErr)
		}
		logger.Info("non-release dev-kernel RuntimeAgent seed ready",
			"local_agent_ref", seededAgent.GetLocalAgentRef(),
			"owner_user_id", seededAgent.GetOwnerUserId(),
		)
	}
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

	runtimev1.RegisterRuntimeExternalAgentServiceServer(g, externalagentservice.New(logger))
	runtimev1.RegisterRuntimeAuthServiceServer(g, authSvc)
	runtimev1.RegisterRuntimeServiceControlServiceServer(g, runtimeControlSvc)
	runtimev1.RegisterRuntimeAccountServiceServer(g, accountSvc)
	runtimev1.RegisterRuntimeCognitionServiceServer(g, cognitionSvc)
	appOptions := []appservice.Option{
		appservice.WithSessionValidator(authSvc),
		appservice.WithScopedBindingValidator(accountSvc),
		appservice.WithLocalAppConversationScopeValidator(agentSvc),
		appservice.WithLocalAppOperationAuthorizer(accountSvc),
		appservice.WithAppStorageDataRoot(cfg.DataRootRef),
		appservice.WithRuntimeAccountProjectionProvider(accountSvc),
	}
	if protected != nil {
		appOptions = append(appOptions,
			appservice.WithLocalDevelopmentAuthority(localDevelopmentStore, protected.LocalAppLaunches, protected.LocalDevelopmentVerifier, artifactStore),
			appservice.WithLocalAppKernel(localAppKernel),
		)
	}
	appSvc := appservice.New(logger, appOptions...)
	if protected != nil {
		if err := appSvc.ReconcileLocalDevelopmentKernel(context.Background()); err != nil {
			return nil, fmt.Errorf("reconcile local-development authority with local-app kernel: %w", err)
		}
	}
	authSvc.SetLocalAppSessionOpener(appSvc)
	accountSvc.SetLocalAppSessionResolver(appSvc)
	accountSvc.SetAccountAuthorityRevoker(appSvc)
	artifactSvc := runtimeartifactservice.New(artifactStore, logger, runtimeartifactservice.WithLocalAppOperationAuthorizer(accountSvc))
	if protected != nil {
		protectedGRPCServer = newProtectedDesktopRPCServer(runtimeControlSvc, authSvc, accountSvc, auditSvc, localSvc, aiSvc, agentSvc, connSvc, appSvc, appSvc, protected.DesktopSessions)
		localAppGRPCServer = newProtectedLocalAppRPCServer(runtimeControlSvc, authSvc, accountSvc, appSvc, artifactSvc, agentSvc)
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
	runtimev1.RegisterRuntimeDevelopmentServiceServer(g, appSvc)

	runtimev1.RegisterRuntimeArtifactServiceServer(g, artifactSvc)

	s := &Server{
		addr:                  addr,
		state:                 state,
		logger:                logger,
		grpcServer:            g,
		protectedServer:       protectedGRPCServer,
		localAppServer:        localAppGRPCServer,
		healthServer:          h,
		rpcRegistry:           rpcRegistry,
		aiHealth:              aiHealth,
		auditStore:            auditStore,
		accountService:        accountSvc,
		authService:           authSvc,
		aiSvc:                 aiSvc,
		appService:            appSvc,
		localService:          localSvc,
		memoryService:         memorySvc,
		cognitionService:      cognitionSvc,
		agentService:          agentSvc,
		localDevelopmentStore: localDevelopmentStore,
		localAppKernel:        localAppKernel,
	}
	s.SyncServingState()
	keepLocalDevelopmentStore = true
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

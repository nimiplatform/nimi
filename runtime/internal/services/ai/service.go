package ai

import (
	"context"
	"fmt"
	"log/slog"
	"path/filepath"
	"strings"
	"time"

	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/aiconfig"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/remoteexecution"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeidentity"
	"github.com/nimiplatform/nimi/runtime/internal/scheduler"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"github.com/nimiplatform/nimi/runtime/internal/videomedia"
)

const (
	// minStreamChunkBytes is the minimum buffered bytes before flushing a
	// streaming text delta to the client. (K-STREAM-006)
	minStreamChunkBytes                           = 32
	defaultGenerateTimeout                        = 30 * time.Second
	defaultTextGenerateJobTimeout                 = 120 * time.Second
	defaultStreamFirstTimeout                     = 60 * time.Second
	defaultStreamIdleTimeout                      = 30 * time.Second
	defaultStreamTotalTimeout                     = 120 * time.Second
	defaultEmbedTimeout                           = 20 * time.Second
	defaultGenerateImageTimeout                   = 120 * time.Second
	defaultGenerateVideoTimeout                   = 300 * time.Second
	defaultSynthesizeTimeout                      = 45 * time.Second
	defaultTranscribeTimeout                      = 90 * time.Second
	defaultLocalSpeechJobTimeout                  = 15 * time.Minute
	defaultGenerateMusicTimeout                   = 300 * time.Second
	defaultVoiceAssetDeleteReconciliationInterval = 15 * time.Second
)

// Service implements RuntimeAiService with deterministic in-memory behavior.
type Service struct {
	runtimev1.UnimplementedRuntimeAiServiceServer
	runtimev1.UnimplementedRuntimeAiRealtimeServiceServer
	logger                                 *slog.Logger
	config                                 Config
	audit                                  *auditlog.Store
	scheduler                              *scheduler.Scheduler
	scenarioJobs                           *scenarioJobStore
	realtimeSessions                       *realtimeSessionStore
	voiceAssets                            *voiceAssetStore
	runtimeArtifacts                       runtimeartifact.Store
	runtimeCustodyIssuer                   *capabilitydriver.RuntimeCustodyIssuer
	aiConfigStore                          aiconfig.Store
	spendDisclosureReporter                SpendDisclosureReporter
	connStore                              *connector.ConnectorStore
	localExecution                         localexecution.Resolver
	localTextHost                          localexecution.TextExecutionHost
	localImageHost                         localexecution.ImageExecutionHost
	localMusicHost                         localexecution.MusicExecutionHost
	localVideoHost                         localexecution.VideoExecutionHost
	localSpeechHost                        localexecution.SpeechExecutionHost
	localImageJobOrder                     localMediaSubmissionOrder
	localMusicJobOrder                     localMediaSubmissionOrder
	localVideoJobOrder                     localMediaSubmissionOrder
	localSpeechJobOrder                    localSpeechSubmissionOrder
	localMusicStagingRoot                  string
	localSpeechStagingRoot                 string
	localVideoMedia                        videomedia.Pipeline
	capabilityDrivers                      *capabilitydriver.Registry
	cloudTextDrivers                       *capabilitydriver.CloudTextRegistry
	cloudEmbedDrivers                      *capabilitydriver.CloudEmbedRegistry
	cloudMediaDrivers                      *capabilitydriver.CloudMediaRegistry
	cloudProvider                          *nimillm.CloudProvider
	cloudTextProvider                      provider
	remoteTextHost                         remoteexecution.TextHost
	remoteEmbedHost                        remoteexecution.EmbedHost
	remoteMediaHost                        remoteexecution.MediaHost
	runtimeAccountProjection               runtimeAccountProjectionProvider
	speechCatalog                          *catalog.Resolver
	allowLoopback                          bool
	streamFirstPacketTimeout               time.Duration
	streamIdleTimeout                      time.Duration
	voiceAssetDeleteReconciliationInterval time.Duration
}

type runtimeAccountProjectionProvider interface {
	AuthenticatedRuntimeProjection(context.Context) (*runtimev1.AccountProjection, bool)
}

// New creates a Service with all dependencies.
func New(logger *slog.Logger, auditStore *auditlog.Store, connStore *connector.ConnectorStore, daemonCfg config.Config) (*Service, error) {
	effectiveCfg := loadConfigFromEnv()
	if daemonCfg.AIHTTPTimeoutSeconds > 0 {
		effectiveCfg.AIHTTPTimeout = time.Duration(daemonCfg.AIHTTPTimeoutSeconds) * time.Second
	}
	effectiveCfg.EnforceEndpointSecurity = true
	effectiveCfg.AllowLoopbackEndpoint = daemonCfg.AllowLoopbackProviderEndpoint
	for providerID, target := range daemonCfg.Providers {
		creds := effectiveCfg.CloudProviders[providerID]
		if strings.TrimSpace(creds.BaseURL) == "" {
			creds.BaseURL = strings.TrimSpace(target.BaseURL)
		}
		if strings.TrimSpace(creds.APIKey) == "" {
			creds.APIKey = strings.TrimSpace(config.ResolveProviderAPIKey(target))
		}
		if strings.TrimSpace(creds.BaseURL) != "" || strings.TrimSpace(creds.APIKey) != "" {
			effectiveCfg.CloudProviders[providerID] = creds
		}
	}
	return newService(logger, auditStore, connStore, effectiveCfg, daemonCfg, strings.TrimSpace(daemonCfg.ModelCatalogCustomDir))
}

// NewProtected creates the production protected-service AI surface. Provider
// endpoints and credentials are deliberately absent from this constructor:
// remote execution resolves them through the Runtime-owned connector store.
func NewProtected(logger *slog.Logger, auditStore *auditlog.Store, connStore *connector.ConnectorStore, daemonCfg config.Config) (*Service, error) {
	if connStore == nil {
		return nil, fmt.Errorf("protected AI service requires Runtime-owned connector resolver")
	}
	effectiveCfg := Config{
		AIHTTPTimeout:           defaultAIHTTPTimeout,
		EnforceEndpointSecurity: true,
	}.normalized()
	if daemonCfg.AIHTTPTimeoutSeconds > 0 {
		effectiveCfg.AIHTTPTimeout = time.Duration(daemonCfg.AIHTTPTimeoutSeconds) * time.Second
	}
	return newService(logger, auditStore, connStore, effectiveCfg, daemonCfg, "")
}

func newService(logger *slog.Logger, auditStore *auditlog.Store, connStore *connector.ConnectorStore, effectiveCfg Config, daemonCfg config.Config, customCatalogDir string) (*Service, error) {
	globalConc := daemonCfg.GlobalConcurrencyLimit
	if globalConc <= 0 {
		globalConc = 8
	}
	perAppConc := daemonCfg.PerAppConcurrencyLimit
	if perAppConc <= 0 {
		perAppConc = 2
	}
	svc, err := newFromProviderConfig(logger, auditStore, connStore, effectiveCfg, globalConc, perAppConc)
	if err != nil {
		return nil, err
	}
	voiceAssets, err := newVoiceAssetStoreForLocalStatePath(daemonCfg.LocalStatePath)
	if err != nil {
		return nil, fmt.Errorf("init voice asset store: %w", err)
	}
	svc.voiceAssets = voiceAssets
	scenarioJobs, err := newScenarioJobStoreForLocalStatePathBeforeStartupPrune(daemonCfg.LocalStatePath)
	if err != nil {
		return nil, fmt.Errorf("init scenario job store: %w", err)
	}
	svc.scenarioJobs = scenarioJobs
	if localStatePath := strings.TrimSpace(daemonCfg.LocalStatePath); localStatePath != "" {
		svc.localMusicStagingRoot = filepath.Join(filepath.Dir(localStatePath), "music-staging")
		svc.localSpeechStagingRoot = filepath.Join(filepath.Dir(localStatePath), "speech-staging")
	}
	// Provider-persistent voice publication spans the VoiceAsset content store
	// and the primary ScenarioJob owner. Reconcile its private pending records
	// only after both durable stores have loaded, and before the Service becomes
	// reachable: a completed primary Job promotes the exact captured result;
	// every other pending record remains non-public and is removed.
	if err := voiceAssets.reconcilePendingPublications(scenarioJobs); err != nil {
		return nil, fmt.Errorf("reconcile pending voice publications: %w", err)
	}
	if err := svc.releaseRecoveredTerminalCloudCredentialCustody(); err != nil {
		return nil, err
	}
	if err := scenarioJobs.pruneRecoveredDurableState(); err != nil {
		return nil, fmt.Errorf("prune recovered scenario job state: %w", err)
	}
	if logger != nil {
		for _, diagnostic := range scenarioJobs.IsolationDiagnostics() {
			logger.Warn(
				"ScenarioJob durable state was isolated",
				"reason_code", diagnostic.ReasonCode,
				"level", diagnostic.Level,
				"section", diagnostic.Section,
				"record_index", diagnostic.RecordIndex,
				"record_id", diagnostic.RecordID,
				"quarantine_path", diagnostic.QuarantinePath,
				"detail", diagnostic.Message,
			)
		}
	}
	voiceCatalog, err := catalog.NewResolver(catalog.ResolverConfig{
		Logger:    logger,
		CustomDir: strings.TrimSpace(customCatalogDir),
	})
	if err != nil {
		return nil, fmt.Errorf("init catalog: %w", err)
	}
	svc.speechCatalog = voiceCatalog
	return svc, nil
}

// newFromProviderConfig is an internal constructor used by New and tests.
func newFromProviderConfig(logger *slog.Logger, auditStore *auditlog.Store, connStore *connector.ConnectorStore, cfg Config, globalConc int, perAppConc int) (*Service, error) {
	cfg = cfg.normalized()
	if globalConc <= 0 {
		globalConc = 8
	}
	if perAppConc <= 0 {
		perAppConc = 2
	}
	realtimeSessions := newRealtimeSessionStore()
	realtimeSessions.setDropReporter(func(sessionID string, event *runtimev1.RealtimeEvent) {
		if logger == nil || event == nil {
			return
		}
		logger.Warn(
			"realtime event dropped because reader channel is full",
			"session_id", strings.TrimSpace(sessionID),
			"event_type", event.GetEventType().String(),
			"sequence", event.GetSequence(),
		)
	})
	cloudProvider := nimillm.NewCloudProvider(cfg.toCloudConfig())
	remoteCloudConfig := cfg.toCloudConfig()
	// Remote cloud execution may receive credentials only from request-scoped
	// current-account Connector Host resolution; configured probe credentials are
	// deliberately absent from the shared transport instance.
	remoteCloudConfig.Providers = nil
	remoteCloudTransport := nimillm.NewCloudProvider(remoteCloudConfig)
	hostAudit := auditStore
	if hostAudit == nil {
		// Unit/in-process construction still receives an auditable Host seam;
		// production always supplies the unified Runtime audit store.
		hostAudit = auditlog.New(256, 256)
	}
	svc := &Service{
		logger:                                 logger,
		config:                                 cfg,
		audit:                                  auditStore,
		scheduler:                              scheduler.New(scheduler.Config{GlobalConcurrency: globalConc, PerAppConcurrency: perAppConc, StarvationThreshold: 30 * time.Second}),
		scenarioJobs:                           newScenarioJobStore(),
		realtimeSessions:                       realtimeSessions,
		voiceAssets:                            newVoiceAssetStore(),
		runtimeArtifacts:                       runtimeartifact.NewMemoryStore(),
		runtimeCustodyIssuer:                   capabilitydriver.NewRuntimeCustodyIssuer(),
		aiConfigStore:                          aiconfig.NewMemoryStore(),
		capabilityDrivers:                      capabilitydriver.NewProductionRegistry(),
		cloudTextDrivers:                       capabilitydriver.NewProductionCloudTextRegistry(),
		cloudEmbedDrivers:                      capabilitydriver.NewProductionCloudEmbedRegistry(),
		cloudMediaDrivers:                      capabilitydriver.NewProductionCloudMediaRegistry(),
		cloudProvider:                          cloudProvider,
		cloudTextProvider:                      remoteCloudTransport,
		remoteTextHost:                         remoteexecution.NewProviderTextHost(connStore, remoteCloudTransport, hostAudit, cfg.AllowLoopbackEndpoint),
		remoteEmbedHost:                        remoteexecution.NewProviderEmbedHost(connStore, remoteCloudTransport, hostAudit, cfg.AllowLoopbackEndpoint),
		remoteMediaHost:                        remoteexecution.NewProviderMediaHost(connStore, remoteCloudTransport, hostAudit, cfg.AllowLoopbackEndpoint),
		connStore:                              connStore,
		allowLoopback:                          cfg.AllowLoopbackEndpoint,
		streamFirstPacketTimeout:               defaultStreamFirstTimeout,
		streamIdleTimeout:                      defaultStreamIdleTimeout,
		voiceAssetDeleteReconciliationInterval: defaultVoiceAssetDeleteReconciliationInterval,
	}
	voiceCatalog, err := catalog.NewResolver(catalog.ResolverConfig{Logger: logger})
	if err != nil {
		return nil, fmt.Errorf("init default speech catalog: %w", err)
	}
	svc.speechCatalog = voiceCatalog
	return svc, nil
}

// SetLocalExecutionResolver wires the machine Loadout owner into job-time
// composition. It is independent from legacy LocalAsset listing and lifecycle
// APIs.
func (s *Service) SetLocalExecutionResolver(resolver localexecution.Resolver) {
	if s != nil {
		s.localExecution = resolver
	}
}

// SetLocalTextExecutionHost wires the native substrate executor. The Host does
// not participate in route or selection decisions.
func (s *Service) SetLocalTextExecutionHost(host localexecution.TextExecutionHost) {
	if s != nil {
		s.localTextHost = host
	}
}

// SetLocalImageExecutionHost wires the Runtime-private serial image substrate
// executor. The Host never participates in route, selection, or binding truth.
func (s *Service) SetLocalImageExecutionHost(host localexecution.ImageExecutionHost) {
	if s != nil {
		s.localImageHost = host
	}
}

func (s *Service) SetLocalMusicExecutionHost(host localexecution.MusicExecutionHost) {
	if s != nil {
		s.localMusicHost = host
	}
}

// SetLocalVideoExecutionHost wires the Runtime-private video substrate. The
// Host receives only immutable Driver plans and never resolves route or model
// selection.
func (s *Service) SetLocalVideoExecutionHost(host localexecution.VideoExecutionHost) {
	if s != nil {
		s.localVideoHost = host
	}
}

// SetLocalSpeechExecutionHost wires the supervised Qwen3 speech substrate.
// The Host receives only exact immutable Driver plans and owns no selection or
// route truth.
func (s *Service) SetLocalSpeechExecutionHost(host localexecution.SpeechExecutionHost) {
	if s != nil {
		s.localSpeechHost = host
	}
}

// SetLocalVideoMediaPipeline wires the private ffmpeg/ffprobe owner used only
// after a raw AV candidate has been produced.
func (s *Service) SetLocalVideoMediaPipeline(pipeline videomedia.Pipeline) {
	if s != nil {
		s.localVideoMedia = pipeline
	}
}

// SetRemoteTextExecutionHost replaces the Remote Host transport seam. The Host
// never participates in route, implementation, or target selection.
func (s *Service) SetRemoteTextExecutionHost(host remoteexecution.TextHost) {
	if s != nil && host != nil {
		s.remoteTextHost = host
	}
}

// SetRemoteEmbedExecutionHost replaces the Remote Host transport seam. The
// Host never participates in route, implementation, or target selection.
func (s *Service) SetRemoteEmbedExecutionHost(host remoteexecution.EmbedHost) {
	if s != nil && host != nil {
		s.remoteEmbedHost = host
	}
}

// SetRemoteMediaExecutionHost replaces the Remote Host transport seam. The
// Host never participates in route, implementation, target, or dialect
// selection.
func (s *Service) SetRemoteMediaExecutionHost(host remoteexecution.MediaHost) {
	if s != nil && host != nil {
		s.remoteMediaHost = host
	}
}

// SetRuntimeArtifactStore wires the generic by-id artifact byte store used by
// RuntimeArtifactService. Producers write before emitting ids to consumers.
func (s *Service) SetRuntimeArtifactStore(store runtimeartifact.Store) {
	s.runtimeArtifacts = store
}

// SetAIConfigStore replaces the constructor's process-local store with the
// Runtime persistence owner during startup. The service is not serving calls
// when this wiring occurs.
func (s *Service) SetAIConfigStore(store aiconfig.Store) {
	if s == nil || store == nil {
		return
	}
	s.aiConfigStore = store
}

// SetRuntimeAccountProjectionProvider binds protected bundled consumers to
// Runtime-owned account truth. Renderer-provided subject ids are never used as
// scenario-job authority.
func (s *Service) SetRuntimeAccountProjectionProvider(provider runtimeAccountProjectionProvider) {
	s.runtimeAccountProjection = provider
}

// RegisterSchedulerDenialCheck adds a K-SCHED-004 denial check to the scheduler.
// Called during daemon bootstrap after device profile collection is available.
func (s *Service) RegisterSchedulerDenialCheck(check scheduler.DenialCheck) {
	if s.scheduler != nil {
		s.scheduler.RegisterDenialCheck(check)
	}
}

// SetSchedulerResourceAssessor injects the resource snapshot provider for
// Phase 2+ risk assessment (K-SCHED-005).
func (s *Service) SetSchedulerResourceAssessor(assessor scheduler.ResourceAssessor) {
	if s.scheduler != nil {
		s.scheduler.SetResourceAssessor(assessor)
	}
}

// SetSchedulerRiskThresholds sets configurable risk thresholds on the scheduler (K-SCHED-005).
func (s *Service) SetSchedulerRiskThresholds(thresholds scheduler.RiskThresholds) {
	if s.scheduler != nil {
		s.scheduler.SetRiskThresholds(thresholds)
	}
}

// SetSchedulerDependencyChecker injects the K-SCHED-004 dependency feasibility checker.
func (s *Service) SetSchedulerDependencyChecker(checker scheduler.DependencyFeasibilityChecker) {
	if s.scheduler != nil {
		s.scheduler.SetDependencyFeasibilityChecker(checker)
	}
}

func (s *Service) ResolvePublicChatTextBinding(
	ctx context.Context,
	routeHint runtimev1.RoutePolicy,
	modelID string,
) (runtimev1.RoutePolicy, string, error) {
	if s == nil || s.cloudTextProvider == nil {
		return runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	if routeHint == runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
		selected, ok := localexecution.SelectedLocalExecutionFromContext(ctx, capabilitydriver.LlamaCapabilityContract)
		if !ok {
			return runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
		}
		if !validSelectedTextExecution(selected) {
			return runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED)
		}
		resolved := strings.TrimSpace(selected.DisplayName)
		if resolved == "" {
			resolved = strings.TrimSpace(selected.LoadoutID)
		}
		return runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL, resolved, nil
	}
	if routeHint == runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
		return runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED, "", missingAIConfigRouteError()
	}
	rawModel := strings.TrimSpace(modelID)
	if rawModel == "" {
		return runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
	if routeHint != runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD {
		return runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED, "", missingAIConfigRouteError()
	}
	return runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD, rawModel, nil
}

type publicChatTextContextMetadataResolution struct {
	contextWindow  uint64
	catalogVersion string
	modelRevision  string
	provider       string
	targetRef      *runtimeidentity.Target
	release        func()
}

// ResolvePublicChatTextContextMetadata resolves the context metadata used by
// Runtime Agent. Local metadata is derived from the selected configuration's
// portable Driver config and exact content identities, never a resident worker.
func (s *Service) ResolvePublicChatTextContextMetadata(
	ctx context.Context,
	route runtimev1.RoutePolicy,
	modelID string,
	targetRef *runtimeidentity.Target,
) (uint64, string, string, string, *runtimeidentity.Target, error) {
	resolved, err := s.resolvePublicChatTextContextMetadataLease(ctx, route, modelID, targetRef)
	if err != nil {
		return 0, "", "", "", nil, err
	}
	if resolved.release != nil {
		resolved.release()
	}
	return resolved.contextWindow, resolved.catalogVersion, resolved.modelRevision, resolved.provider, resolved.targetRef, nil
}

// ResolvePublicChatTextContextMetadataLease preserves the existing ownership
// shape for Cloud metadata. Local selection is an immutable job-time snapshot;
// it has no worker lease or durable target.
func (s *Service) ResolvePublicChatTextContextMetadataLease(
	ctx context.Context,
	route runtimev1.RoutePolicy,
	modelID string,
	targetRef *runtimeidentity.Target,
) (uint64, string, string, string, *runtimeidentity.Target, func(), error) {
	resolved, err := s.resolvePublicChatTextContextMetadataLease(ctx, route, modelID, targetRef)
	if err != nil {
		return 0, "", "", "", nil, nil, err
	}
	return resolved.contextWindow, resolved.catalogVersion, resolved.modelRevision, resolved.provider, resolved.targetRef, resolved.release, nil
}

func (s *Service) resolvePublicChatTextContextMetadataLease(
	ctx context.Context,
	route runtimev1.RoutePolicy,
	modelID string,
	targetRef *runtimeidentity.Target,
) (publicChatTextContextMetadataResolution, error) {
	if route == runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
		if targetRef != nil && targetRef.Valid() {
			return publicChatTextContextMetadataResolution{}, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CAPABILITY_MISMATCH)
		}
		return s.resolveSelectedLocalTextContextMetadata(ctx)
	}
	if s == nil || s.speechCatalog == nil {
		return publicChatTextContextMetadataResolution{}, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_MODULE_CONFIG_INVALID)
	}
	provider := ""
	resolvedModelID := strings.TrimSpace(modelID)
	resolvedTargetRef := targetRef.Clone()
	switch route {
	case runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD:
		var cloud *runtimeidentity.CloudTarget
		if targetRef != nil {
			cloud = targetRef.GetCloud()
		}
		if cloud == nil {
			return publicChatTextContextMetadataResolution{}, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		provider = strings.TrimSpace(cloud.Provider)
		if providerModelID := strings.TrimSpace(cloud.ProviderModelID); providerModelID != "" {
			resolvedModelID = providerModelID
		}
	default:
		return publicChatTextContextMetadataResolution{}, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	if resolvedTargetRef == nil || !resolvedTargetRef.Valid() {
		return publicChatTextContextMetadataResolution{}, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_MODULE_CONFIG_INVALID, grpcerr.ReasonOptions{
			Message: "runtime target reference is invalid",
		})
	}
	release := func() {}
	releaseOnFailure := func(err error) (publicChatTextContextMetadataResolution, error) {
		return publicChatTextContextMetadataResolution{}, err
	}
	metadata, catalogErr := s.speechCatalog.ResolveTextContextMetadataForSubject(
		catalogSubjectUserIDFromContext(ctx),
		provider,
		resolvedModelID,
	)
	if catalogErr != nil {
		return releaseOnFailure(grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_MODULE_CONFIG_INVALID, catalogErr, grpcerr.ReasonOptions{
			ActionHint: "add_model_context_window_to_runtime_catalog",
			Message:    "runtime target catalog metadata could not be resolved",
		}))
	}
	return publicChatTextContextMetadataResolution{
		contextWindow:  metadata.ContextWindowTokens,
		catalogVersion: metadata.CatalogVersion,
		modelRevision:  metadata.ModelRevision,
		provider:       metadata.Provider,
		targetRef:      resolvedTargetRef,
		release:        release,
	}, nil
}

// CloudProvider returns the underlying cloud provider for cross-service wiring (e.g., ConnectorService probe).
func (s *Service) CloudProvider() *nimillm.CloudProvider {
	if s == nil {
		return nil
	}
	return s.cloudProvider
}

// SpeechCatalogResolver exposes the runtime speech catalog resolver for other
// runtime services (for example connector config surfaces).
func (s *Service) SpeechCatalogResolver() *catalog.Resolver {
	return s.speechCatalog
}

func (s *Service) RunVoiceAssetDeleteReconciliationLoop(ctx context.Context) {
	if s == nil {
		return
	}
	interval := s.voiceAssetDeleteReconciliationInterval
	if interval <= 0 {
		interval = defaultVoiceAssetDeleteReconciliationInterval
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.reconcilePendingVoiceAssetDeletes(ctx, "", "", maxVoiceAssetReconciliationSweep)
		}
	}
}

func (s *Service) recordStreamSimulation(appID string, subjectUserID string, requestedModelID string, resolvedModelID string) {
	if s.audit == nil {
		return
	}
	payload, _ := structpb.NewStruct(map[string]any{
		"requestedModelId": strings.TrimSpace(requestedModelID),
		"resolvedModelId":  strings.TrimSpace(resolvedModelID),
	})
	s.audit.AppendEvent(&runtimev1.AuditEventRecord{
		AuditId:       ulid.Make().String(),
		AppId:         strings.TrimSpace(appID),
		SubjectUserId: strings.TrimSpace(subjectUserID),
		Domain:        "runtime.ai",
		Operation:     "stream_simulated",
		ReasonCode:    runtimev1.ReasonCode_ACTION_EXECUTED,
		TraceId:       ulid.Make().String(),
		Timestamp:     timestamppb.New(time.Now().UTC()),
		Payload:       payload,
	})
}

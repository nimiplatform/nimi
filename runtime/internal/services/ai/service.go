package ai

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/modelregistry"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/providerhealth"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeidentity"
	"github.com/nimiplatform/nimi/runtime/internal/scheduler"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
)

const (
	// minStreamChunkBytes is the minimum buffered bytes before flushing a
	// streaming text delta to the client. (K-STREAM-006)
	minStreamChunkBytes                           = 32
	defaultGenerateTimeout                        = 120 * time.Second
	defaultStreamFirstTimeout                     = 60 * time.Second
	defaultStreamIdleTimeout                      = 30 * time.Second
	defaultStreamTotalTimeout                     = 120 * time.Second
	defaultEmbedTimeout                           = 20 * time.Second
	defaultGenerateImageTimeout                   = 120 * time.Second
	defaultGenerateVideoTimeout                   = 300 * time.Second
	defaultSynthesizeTimeout                      = 45 * time.Second
	defaultTranscribeTimeout                      = 90 * time.Second
	defaultGenerateMusicTimeout                   = 300 * time.Second
	defaultVoiceAssetDeleteReconciliationInterval = 15 * time.Second
)

// Service implements RuntimeAiService with deterministic in-memory behavior.
type Service struct {
	runtimev1.UnimplementedRuntimeAiServiceServer
	runtimev1.UnimplementedRuntimeAiRealtimeServiceServer
	logger                                 *slog.Logger
	config                                 Config
	selector                               *routeSelector
	audit                                  *auditlog.Store
	registry                               *modelregistry.Registry
	registryPath                           string
	scheduler                              *scheduler.Scheduler
	scenarioJobs                           *scenarioJobStore
	realtimeSessions                       *realtimeSessionStore
	voiceAssets                            *voiceAssetStore
	runtimeArtifacts                       runtimeartifact.Store
	spendDisclosureReporter                SpendDisclosureReporter
	connStore                              *connector.ConnectorStore
	localModel                             localModelLister
	localImageProfile                      localImageProfileResolver
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
func New(logger *slog.Logger, registry *modelregistry.Registry, aiHealth *providerhealth.Tracker, auditStore *auditlog.Store, connStore *connector.ConnectorStore, daemonCfg config.Config) (*Service, error) {
	effectiveCfg := loadConfigFromEnv()
	if daemonCfg.AIHTTPTimeoutSeconds > 0 {
		effectiveCfg.AIHTTPTimeout = time.Duration(daemonCfg.AIHTTPTimeoutSeconds) * time.Second
	}
	effectiveCfg.EnforceEndpointSecurity = true
	effectiveCfg.AllowLoopbackEndpoint = daemonCfg.AllowLoopbackProviderEndpoint
	effectiveCfg.DefaultLocalTextModel = strings.TrimSpace(daemonCfg.DefaultLocalTextModel)
	effectiveCfg.DefaultCloudProvider = strings.TrimSpace(daemonCfg.DefaultCloudProvider)
	if effectiveCfg.ProviderDefaultModels == nil {
		effectiveCfg.ProviderDefaultModels = map[string]string{}
	}
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
		if defaultModel := strings.TrimSpace(target.DefaultModel); defaultModel != "" {
			effectiveCfg.ProviderDefaultModels[providerID] = defaultModel
		}
	}
	return newService(logger, registry, aiHealth, auditStore, connStore, effectiveCfg, daemonCfg, strings.TrimSpace(daemonCfg.ModelCatalogCustomDir))
}

// NewProtected creates the production protected-service AI surface. Provider
// endpoints and credentials are deliberately absent from this constructor:
// remote execution resolves them through the Runtime-owned connector store.
func NewProtected(logger *slog.Logger, registry *modelregistry.Registry, aiHealth *providerhealth.Tracker, auditStore *auditlog.Store, connStore *connector.ConnectorStore, daemonCfg config.Config) (*Service, error) {
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
	return newService(logger, registry, aiHealth, auditStore, connStore, effectiveCfg, daemonCfg, "")
}

func newService(logger *slog.Logger, registry *modelregistry.Registry, aiHealth *providerhealth.Tracker, auditStore *auditlog.Store, connStore *connector.ConnectorStore, effectiveCfg Config, daemonCfg config.Config, customCatalogDir string) (*Service, error) {
	globalConc := daemonCfg.GlobalConcurrencyLimit
	if globalConc <= 0 {
		globalConc = 8
	}
	perAppConc := daemonCfg.PerAppConcurrencyLimit
	if perAppConc <= 0 {
		perAppConc = 2
	}
	svc, err := newFromProviderConfig(logger, registry, aiHealth, auditStore, connStore, effectiveCfg, globalConc, perAppConc)
	if err != nil {
		return nil, err
	}
	voiceAssets, err := newVoiceAssetStoreForLocalStatePath(daemonCfg.LocalStatePath)
	if err != nil {
		return nil, fmt.Errorf("init voice asset store: %w", err)
	}
	svc.voiceAssets = voiceAssets
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
func newFromProviderConfig(logger *slog.Logger, registry *modelregistry.Registry, aiHealth *providerhealth.Tracker, auditStore *auditlog.Store, connStore *connector.ConnectorStore, cfg Config, globalConc int, perAppConc int) (*Service, error) {
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
	svc := &Service{
		logger:                                 logger,
		config:                                 cfg,
		selector:                               newRouteSelectorWithRegistry(cfg, registry, aiHealth),
		audit:                                  auditStore,
		registry:                               registry,
		scheduler:                              scheduler.New(scheduler.Config{GlobalConcurrency: globalConc, PerAppConcurrency: perAppConc, StarvationThreshold: 30 * time.Second}),
		scenarioJobs:                           newScenarioJobStore(),
		realtimeSessions:                       realtimeSessions,
		voiceAssets:                            newVoiceAssetStore(),
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

func (s *Service) SetModelRegistryPersistencePath(path string) {
	s.registryPath = strings.TrimSpace(path)
}

// SetLocalModelLister wires RuntimeLocalService for local model availability checks.
func (s *Service) SetLocalModelLister(localSvc localModelLister) {
	s.localModel = localSvc
}

// SetRuntimeArtifactStore wires the generic by-id artifact byte store used by
// RuntimeArtifactService. Producers write before emitting ids to consumers.
func (s *Service) SetRuntimeArtifactStore(store runtimeartifact.Store) {
	s.runtimeArtifacts = store
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

// SetLocalImageProfileResolver wires RuntimeLocalService for dynamic
// managed media profile materialization.
func (s *Service) SetLocalImageProfileResolver(resolver localImageProfileResolver) {
	s.localImageProfile = resolver
}

func (s *Service) ResolvePublicChatTextBinding(
	ctx context.Context,
	routeHint runtimev1.RoutePolicy,
	modelID string,
) (runtimev1.RoutePolicy, string, error) {
	if s == nil || s.selector == nil {
		return runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	routeDecision, modelResolved, err := s.selector.resolveCommittedBindingRouteModel(routeHint, modelID)
	if err != nil {
		return runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED, "", err
	}
	return routeDecision, modelResolved, nil
}

// ResolvePublicChatTextContextMetadata returns the catalog-owned capacity,
// revision identity, and durable target for the exact text route used by
// Runtime Agent context composition. An alias-bound local route is resolved to
// its selected Runtime-owned asset and frozen as a v2 target. Malformed or
// unresolvable targets and missing catalog capacity fail closed; callers must
// not substitute a default window or target.
func (s *Service) ResolvePublicChatTextContextMetadata(
	ctx context.Context,
	route runtimev1.RoutePolicy,
	modelID string,
	targetRef *runtimev1.RuntimeDurableTargetRef,
) (uint64, string, string, string, *runtimev1.RuntimeDurableTargetRef, error) {
	if s == nil || s.speechCatalog == nil {
		return 0, "", "", "", nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_MODULE_CONFIG_INVALID)
	}
	provider := ""
	resolvedModelID := strings.TrimSpace(modelID)
	resolvedTargetRef := cloneRuntimeDurableTargetRef(targetRef)
	switch route {
	case runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL:
		provider = "local"
		requestedLocalModelID := ""
		if targetRef != nil {
			localTarget := targetRef.GetLocalRuntime()
			if localTarget == nil {
				return 0, "", "", "", nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
			}
			requestedLocalModelID = strings.TrimSpace(localTarget.GetProfileBindingId())
		}
		if requestedLocalModelID == "" {
			requestedLocalModelID = resolvedModelID
		}
		plan, resolveErr := s.prepareLocalModelExecutionPlan(ctx, requestedLocalModelID, nil, runtimev1.Modal_MODAL_TEXT, nil)
		if resolveErr != nil {
			return 0, "", "", "", nil, resolveErr
		}
		if plan != nil && plan.selected != nil {
			if logicalModelID := strings.TrimSpace(plan.selected.GetLogicalModelId()); logicalModelID != "" {
				resolvedModelID = logicalModelID
			} else if assetID := strings.TrimSpace(plan.selected.GetAssetId()); assetID != "" {
				resolvedModelID = assetID
			}
			if resolvedTargetRef == nil {
				localAssetID := strings.TrimSpace(plan.selected.GetLocalAssetId())
				if localAssetID == "" {
					return 0, "", "", "", nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_MODULE_CONFIG_INVALID)
				}
				resolvedTargetRef = &runtimev1.RuntimeDurableTargetRef{
					Target: &runtimev1.RuntimeDurableTargetRef_LocalRuntime{
						LocalRuntime: &runtimev1.RuntimeDurableLocalTargetRef{
							Version: "v2",
							Ref: &runtimev1.RuntimeDurableLocalTargetRef_ProfileBindingId{
								ProfileBindingId: "local-runtime:" + localAssetID,
							},
						},
					},
				}
			}
		}
	case runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD:
		var cloud *runtimev1.RuntimeDurableCloudTargetRef
		if targetRef != nil {
			cloud = targetRef.GetCloud()
		}
		if cloud == nil {
			return 0, "", "", "", nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		provider = strings.TrimSpace(cloud.GetProvider())
		if providerModelID := strings.TrimSpace(cloud.GetProviderModelId()); providerModelID != "" {
			resolvedModelID = providerModelID
		}
	default:
		return 0, "", "", "", nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	if err := runtimeidentity.ValidateDurableTargetRef(resolvedTargetRef); err != nil {
		return 0, "", "", "", nil, grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_MODULE_CONFIG_INVALID, err, grpcerr.ReasonOptions{
			Message: "runtime target reference is invalid",
		})
	}
	metadata, err := s.speechCatalog.ResolveTextContextMetadataForSubject(
		catalogSubjectUserIDFromContext(ctx),
		provider,
		resolvedModelID,
	)
	if err != nil {
		return 0, "", "", "", nil, grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_MODULE_CONFIG_INVALID, err, grpcerr.ReasonOptions{
			ActionHint: "add_model_context_window_to_runtime_catalog",
			Message:    "runtime target catalog metadata could not be resolved",
		})
	}
	return metadata.ContextWindowTokens, metadata.CatalogVersion, metadata.ModelRevision, metadata.Provider, resolvedTargetRef, nil
}

// SetLocalProviderEndpoint hot-swaps the in-process local provider backend
// endpoint after the daemon bootstraps a managed engine.
func (s *Service) SetLocalProviderEndpoint(providerID string, endpoint string, apiKey string) {
	if s == nil || s.selector == nil {
		return
	}
	local, ok := s.selector.local.(*localProvider)
	if !ok || local == nil {
		return
	}

	creds := nimillm.ProviderCredentials{
		BaseURL: strings.TrimSpace(endpoint),
		APIKey:  strings.TrimSpace(apiKey),
	}
	local.setBackend(providerID, newLocalBackend("local-"+strings.TrimSpace(providerID), creds, s.config))
}

// CloudProvider returns the underlying cloud provider for cross-service wiring (e.g., ConnectorService probe).
func (s *Service) CloudProvider() *nimillm.CloudProvider {
	return s.selector.cloudProvider
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

func (s *Service) recordStreamFallbackSimulated(appID string, subjectUserID string, requestedModelID string, resolvedModelID string) {
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
		Operation:     "stream_fallback_simulated",
		ReasonCode:    runtimev1.ReasonCode_ACTION_EXECUTED,
		TraceId:       ulid.Make().String(),
		Timestamp:     timestamppb.New(time.Now().UTC()),
		Payload:       payload,
	})
}

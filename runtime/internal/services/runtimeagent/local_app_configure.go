package runtimeagent

import (
	"context"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aicapabilities"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	localservice "github.com/nimiplatform/nimi/runtime/internal/services/localservice"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

const localAppRouteOptionLimit = 512

type localAppRouteOptionInventory interface {
	ListLocalAssets(context.Context, *runtimev1.ListLocalAssetsRequest) (*runtimev1.ListLocalAssetsResponse, error)
}

type runtimeAgentDurableLocalTargetResolver interface {
	ResolveDurableLocalTarget(
		context.Context,
		*runtimev1.RuntimeDurableLocalTargetRef,
		string,
	) (*runtimev1.RuntimeResolvedLocalExecutionBinding, *runtimev1.LocalAssetRecord, error)
}

type runtimeAgentDurableLocalComponentTargetResolver interface {
	ResolveDurableLocalComponentTarget(
		context.Context,
		*runtimev1.RuntimeDurableLocalTargetRef,
		string,
	) (*runtimev1.RuntimeResolvedLocalExecutionBinding, *runtimev1.LocalAssetRecord, error)
}

type runtimeAgentDurableLocalImageTargetMaterializer interface {
	ValidateDurableLocalImageTargetComponents(
		context.Context,
		*runtimev1.RuntimeDurableLocalTargetRef,
		[]localservice.DurableLocalComponentSelection,
	) error
	MaterializeDurableLocalImageTarget(
		context.Context,
		*runtimev1.RuntimeDurableLocalTargetRef,
		[]localservice.DurableLocalComponentSelection,
	) (*runtimev1.RuntimeDurableLocalTargetRef, error)
}

type runtimeAgentDurableLocalImageTargetRebinder interface {
	MaterializeDurableLocalImageTargetFromCommitted(
		context.Context,
		*runtimev1.RuntimeDurableLocalTargetRef,
		*runtimev1.RuntimeDurableLocalTargetRef,
		[]localservice.DurableLocalComponentSelection,
	) (*runtimev1.RuntimeDurableLocalTargetRef, error)
}

type runtimeAgentAIProfileDescriptorPreparer interface {
	PrepareProfileRuntimeDescriptorForAIConfig(
		context.Context,
		[]byte,
	) (*localservice.ProfileRuntimeDescriptorPrepareResult, error)
}

type localAppCloudRouteOptionInventory interface {
	ListConnectors(context.Context, *runtimev1.ListConnectorsRequest) (*runtimev1.ListConnectorsResponse, error)
	ListConnectorModels(context.Context, *runtimev1.ListConnectorModelsRequest) (*runtimev1.ListConnectorModelsResponse, error)
}

func (s *Service) SetLocalAppRouteOptionInventory(inventory localAppRouteOptionInventory) {
	if s == nil {
		return
	}
	s.localAppRouteOptionsMu.Lock()
	s.localAppRouteOptions = inventory
	s.localTargetResolver = nil
	s.profileDescriptorPreparer = nil
	if resolver, ok := inventory.(runtimeAgentDurableLocalTargetResolver); ok {
		s.localTargetResolver = resolver
	}
	if preparer, ok := inventory.(runtimeAgentAIProfileDescriptorPreparer); ok {
		s.profileDescriptorPreparer = preparer
	}
	s.localAppRouteOptionsMu.Unlock()
}

func (s *Service) SetLocalAppCloudRouteOptionInventory(inventory localAppCloudRouteOptionInventory) {
	if s == nil {
		return
	}
	s.localAppRouteOptionsMu.Lock()
	s.localAppCloudOptions = inventory
	s.localAppRouteOptionsMu.Unlock()
}

func localAppConfigurePermissionFailure(reason runtimev1.ReasonCode, permissionReason string) error {
	metadata := map[string]string{"permission_id": "agents.configure"}
	if permissionReason != "" {
		metadata["permission_reason"] = permissionReason
	}
	return grpcerr.WithReasonCodeOptions(codes.PermissionDenied, reason, grpcerr.ReasonOptions{Metadata: metadata})
}

func (s *Service) authorizedLocalAppConfigureAgent(ctx context.Context, operation accountservice.LocalAppOperation, handle string) (accountservice.LocalAppCallerDecision, *agentEntry, localAgentIdentity, error) {
	decision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
	if !ok || decision.Operation != operation || decision.OperationCapability != "agents.configure" ||
		handle == "" || handle != strings.TrimSpace(handle) || strings.TrimSpace(decision.LocalAgentID) == "" {
		return accountservice.LocalAppCallerDecision{}, nil, localAgentIdentity{}, localAppConfigurePermissionFailure(runtimev1.ReasonCode_LOCAL_APP_PERMISSION_DENIED, "denied")
	}
	entry, err := s.agentByID(decision.LocalAgentID)
	if err != nil || entry == nil || entry.Agent == nil || strings.TrimSpace(entry.Agent.GetOwnerUserId()) != decision.AccountID {
		return accountservice.LocalAppCallerDecision{}, nil, localAgentIdentity{}, localAppConfigurePermissionFailure(runtimev1.ReasonCode_LOCAL_APP_PERMISSION_DENIED, "denied")
	}
	identity, err := validateLocalAgentIdentity(entry.Agent.GetOwnerUserId(), entry.Agent.GetRuntimeSourceRef(), entry.Agent.GetLocalAgentRef())
	if err != nil || identity.OwnerUserID != decision.AccountID {
		return accountservice.LocalAppCallerDecision{}, nil, localAgentIdentity{}, localAppConfigurePermissionFailure(runtimev1.ReasonCode_LOCAL_APP_PERMISSION_DENIED, "denied")
	}
	return decision, entry, identity, nil
}

func (s *Service) GetLocalAppAgentConfigurationSnapshot(ctx context.Context, req *runtimev1.GetLocalAppAgentConfigurationSnapshotRequest) (*runtimev1.LocalAppAgentConfigurationSnapshotResponse, error) {
	if req == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	decision, _, _, err := s.authorizedLocalAppConfigureAgent(ctx, accountservice.LocalAppOperationConfigurationSnapshot, req.GetAgentHandle())
	if err != nil {
		return nil, err
	}
	projection, err := s.localAppAIConfigProjection(ctx, decision.LocalAgentID)
	if err != nil {
		return nil, err
	}
	return &runtimev1.LocalAppAgentConfigurationSnapshotResponse{Projection: projection}, nil
}

func (s *Service) UpdateLocalAppAgentConfiguration(ctx context.Context, req *runtimev1.UpdateLocalAppAgentConfigurationRequest) (*runtimev1.LocalAppAgentUpdateConfigurationResponse, error) {
	if req == nil || req.GetExpectedConfigurationRevision() == 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	decision, entry, identity, err := s.authorizedLocalAppConfigureAgent(ctx, accountservice.LocalAppOperationUpdateConfiguration, req.GetAgentHandle())
	if err != nil {
		return nil, err
	}
	current, err := s.committedRuntimeAgentAIConfigByAgentInstanceID(identity.LocalAgentRef)
	if err != nil {
		return nil, err
	}
	intents, err := localAppAIConfigIntentsToRuntime(req.GetIntents(), current.GetIntents())
	if err != nil {
		return nil, err
	}
	intents, err = s.materializeLocalAppCloudRouteTargets(ctx, intents)
	if err != nil {
		return nil, err
	}
	intents, err = s.materializeLocalAppLocalRouteTargets(ctx, intents)
	if err != nil {
		return nil, err
	}
	intents, err = s.materializeLocalAppComponentTargets(ctx, intents)
	if err != nil {
		return nil, err
	}
	privateContext := &runtimev1.AgentRequestContext{
		AppId: decision.AppID, SubjectUserId: decision.AccountID, OwnerUserId: identity.OwnerUserID,
		RuntimeSourceRef: entry.Agent.GetRuntimeSourceRef(), LocalAgentRef: identity.LocalAgentRef,
	}
	if _, err := s.upsertRuntimeAgentAIConfig(
		privateContext,
		req.GetExpectedConfigurationRevision(),
		intents,
		runtimeProfileOriginFromLocalApp(req.GetProfileOrigin()),
	); err != nil {
		return nil, err
	}
	projection, err := s.localAppAIConfigProjection(ctx, identity.LocalAgentRef)
	if err != nil {
		return nil, err
	}
	return &runtimev1.LocalAppAgentUpdateConfigurationResponse{Projection: projection}, nil
}

func (s *Service) GetLocalAppAgentReadinessSnapshot(ctx context.Context, req *runtimev1.GetLocalAppAgentReadinessSnapshotRequest) (*runtimev1.LocalAppAgentReadinessSnapshotResponse, error) {
	if req == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	decision, _, _, err := s.authorizedLocalAppConfigureAgent(ctx, accountservice.LocalAppOperationReadinessSnapshot, req.GetAgentHandle())
	if err != nil {
		return nil, err
	}
	config, err := s.committedRuntimeAgentAIConfigByAgentInstanceID(decision.LocalAgentID)
	if err != nil {
		return nil, err
	}
	readiness, err := s.localAppReadinessProjection(decision.LocalAgentID, config.GetRevision())
	if err != nil {
		return nil, err
	}
	return &runtimev1.LocalAppAgentReadinessSnapshotResponse{Projection: readiness}, nil
}

func (s *Service) localAppAIConfigProjection(ctx context.Context, localAgentRef string) (*runtimev1.LocalAppAgentAIConfigProjection, error) {
	config, err := s.committedRuntimeAgentAIConfigByAgentInstanceID(localAgentRef)
	if err != nil {
		return nil, err
	}
	readiness, err := s.localAppReadinessProjection(localAgentRef, config.GetRevision())
	if err != nil {
		return nil, err
	}
	intents := make([]*runtimev1.LocalAppAgentAIConfigIntent, 0, len(config.GetIntents()))
	for _, intent := range config.GetIntents() {
		provider := strings.TrimSpace(intent.GetProvider())
		model := s.localAppLogicalModelForIntent(ctx, intent)
		if cloud := intent.GetTargetRef().GetCloud(); cloud != nil {
			if provider == "" {
				provider = strings.TrimSpace(cloud.GetProvider())
			}
			if cloud.GetProviderModelId() != "" {
				model = strings.TrimSpace(cloud.GetProviderModelId())
			}
		}
		if model == "" {
			continue
		}
		normalizedSelectedParams, paramsValid := normalizeRuntimeAgentAIConfigSelectedParams(
			strings.TrimSpace(intent.GetCapability()),
			intent.GetSelectedParams(),
		)
		if !paramsValid {
			// Historical private identities are never forwarded through the
			// Local App carrier. Omit the unsafe or capability-invalid intent
			// rather than letting the renderer discover it after projection.
			continue
		}
		intents = append(intents, &runtimev1.LocalAppAgentAIConfigIntent{
			Capability: intent.GetCapability(), Provider: provider, LogicalModelId: model,
			RoutePolicy: intent.GetRoutePolicy(), SelectedParams: normalizedSelectedParams,
			SelectedComponents: s.localAppAIConfigComponentProjections(ctx, intent.GetSelectedComponents()),
		})
	}
	routeOptions, err := s.localAppModelRouteOptions(ctx, config, readiness)
	if err != nil {
		return nil, err
	}
	return &runtimev1.LocalAppAgentAIConfigProjection{
		Capabilities: localAppCapabilitiesFromReadiness(readiness), Intents: intents,
		Readiness: readiness.GetCapabilities(), ConfigurationRevision: config.GetRevision(),
		RouteOptions: routeOptions, ScopeOwnerId: localAgentRef,
		ProfileOrigin: localAppProfileOriginFromRuntime(config.GetProfileOrigin()),
	}, nil
}

func localAppProfileOriginFromRuntime(
	origin *runtimev1.RuntimeAgentAIProfileOrigin,
) *runtimev1.LocalAppAgentAIProfileOrigin {
	if origin == nil {
		return nil
	}
	return &runtimev1.LocalAppAgentAIProfileOrigin{
		ProfileId: origin.GetProfileId(),
		Title:     origin.GetTitle(),
		AppliedAt: cloneTimestamp(origin.GetAppliedAt()),
	}
}

func runtimeProfileOriginFromLocalApp(
	origin *runtimev1.LocalAppAgentAIProfileOrigin,
) *runtimev1.RuntimeAgentAIProfileOrigin {
	if origin == nil {
		return nil
	}
	return &runtimev1.RuntimeAgentAIProfileOrigin{
		ProfileId: origin.GetProfileId(),
		Title:     origin.GetTitle(),
		AppliedAt: cloneTimestamp(origin.GetAppliedAt()),
	}
}

func localAppCapabilitiesFromReadiness(
	readiness *runtimev1.LocalAppAgentReadinessProjection,
) []string {
	if readiness == nil {
		return nil
	}
	out := make([]string, 0, len(readiness.GetCapabilities()))
	seen := make(map[string]struct{}, len(readiness.GetCapabilities()))
	for _, item := range readiness.GetCapabilities() {
		capability := strings.TrimSpace(item.GetCapability())
		if capability == "" {
			continue
		}
		if _, duplicate := seen[capability]; duplicate {
			continue
		}
		seen[capability] = struct{}{}
		out = append(out, capability)
	}
	return out
}

func (s *Service) localAppModelRouteOptions(
	ctx context.Context,
	config *runtimev1.RuntimeAgentAIConfig,
	readiness *runtimev1.LocalAppAgentReadinessProjection,
) ([]*runtimev1.LocalAppAgentRouteOption, error) {
	options := make(map[string]*runtimev1.LocalAppAgentRouteOption)
	capabilityAvailability := make(map[string]runtimev1.LocalAppAgentRouteOptionAvailability, len(readiness.GetCapabilities()))
	for _, item := range readiness.GetCapabilities() {
		if item == nil {
			continue
		}
		switch item.GetState() {
		case runtimev1.LocalAppAgentReadinessState_LOCAL_APP_AGENT_READINESS_STATE_READY:
			capabilityAvailability[strings.TrimSpace(item.GetCapability())] = runtimev1.LocalAppAgentRouteOptionAvailability_LOCAL_APP_AGENT_ROUTE_OPTION_AVAILABILITY_READY
		case runtimev1.LocalAppAgentReadinessState_LOCAL_APP_AGENT_READINESS_STATE_CONFIGURED_UNVERIFIED:
			capabilityAvailability[strings.TrimSpace(item.GetCapability())] = runtimev1.LocalAppAgentRouteOptionAvailability_LOCAL_APP_AGENT_ROUTE_OPTION_AVAILABILITY_INSTALLED
		}
	}
	for _, intent := range config.GetIntents() {
		capability := strings.TrimSpace(intent.GetCapability())
		model := s.localAppLogicalModelForIntent(ctx, intent)
		availability := capabilityAvailability[capability]
		if capability == "" || model == "" || availability == runtimev1.LocalAppAgentRouteOptionAvailability_LOCAL_APP_AGENT_ROUTE_OPTION_AVAILABILITY_UNSPECIFIED ||
			intent.GetRoutePolicy() != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
			continue
		}
		addLocalAppRouteOption(options, &runtimev1.LocalAppAgentRouteOption{
			Capability:     capability,
			LogicalModelId: model,
			RoutePolicy:    runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			Label:          model,
			Availability:   availability,
		})
	}

	s.localAppRouteOptionsMu.RLock()
	inventory := s.localAppRouteOptions
	s.localAppRouteOptionsMu.RUnlock()
	if inventory != nil {
		for _, statusFilter := range []runtimev1.LocalAssetStatus{
			runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
			runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
		} {
			pageToken := ""
			for len(options) < localAppRouteOptionLimit {
				response, err := inventory.ListLocalAssets(ctx, &runtimev1.ListLocalAssetsRequest{
					StatusFilter: statusFilter,
					PageSize:     200,
					PageToken:    pageToken,
				})
				if err != nil {
					return nil, err
				}
				for _, asset := range response.GetAssets() {
					model := strings.TrimSpace(asset.GetLogicalModelId())
					if model == "" || asset.GetDurableTargetRef().GetRef() == nil {
						continue
					}
					label := strings.TrimSpace(asset.GetDisplayName())
					if label == "" {
						label = model
					}
					availability := runtimev1.LocalAppAgentRouteOptionAvailability_LOCAL_APP_AGENT_ROUTE_OPTION_AVAILABILITY_INSTALLED
					if asset.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
						availability = runtimev1.LocalAppAgentRouteOptionAvailability_LOCAL_APP_AGENT_ROUTE_OPTION_AVAILABILITY_READY
					}
					for _, rawCapability := range asset.GetCapabilities() {
						capability, normalizeErr := aicapabilities.NormalizeCatalogCapability(rawCapability)
						if normalizeErr != nil || !isAdmittedRuntimeAgentAIConfigCapability(capability) ||
							!localAppLocalAssetSelectableForNewBinding(asset, capability) {
							continue
						}
						addLocalAppRouteOption(options, &runtimev1.LocalAppAgentRouteOption{
							Capability:     capability,
							LogicalModelId: model,
							RoutePolicy:    runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
							Label:          label,
							Availability:   availability,
						})
						if len(options) >= localAppRouteOptionLimit {
							break
						}
					}
				}
				pageToken = strings.TrimSpace(response.GetNextPageToken())
				if pageToken == "" {
					break
				}
			}
		}
	}

	cloudCandidates, err := s.localAppCloudRouteCandidates(ctx)
	if err != nil {
		return nil, err
	}
	for _, candidate := range cloudCandidates {
		if len(options) >= localAppRouteOptionLimit {
			break
		}
		addLocalAppRouteOption(options, candidate.option)
	}

	out := make([]*runtimev1.LocalAppAgentRouteOption, 0, len(options))
	for _, option := range options {
		out = append(out, option)
	}
	sort.Slice(out, func(i, j int) bool {
		left := out[i]
		right := out[j]
		if left.GetCapability() != right.GetCapability() {
			return left.GetCapability() < right.GetCapability()
		}
		if left.GetRoutePolicy() != right.GetRoutePolicy() {
			return left.GetRoutePolicy() < right.GetRoutePolicy()
		}
		if left.GetProvider() != right.GetProvider() {
			return left.GetProvider() < right.GetProvider()
		}
		return left.GetLogicalModelId() < right.GetLogicalModelId()
	})
	return out, nil
}

type localAppCloudRouteCandidate struct {
	option    *runtimev1.LocalAppAgentRouteOption
	targetRef *runtimev1.RuntimeDurableTargetRef
}

func (s *Service) localAppCloudRouteCandidates(ctx context.Context) ([]localAppCloudRouteCandidate, error) {
	s.localAppRouteOptionsMu.RLock()
	inventory := s.localAppCloudOptions
	s.localAppRouteOptionsMu.RUnlock()
	if inventory == nil {
		return nil, nil
	}

	candidates := make([]localAppCloudRouteCandidate, 0)
	seen := make(map[string]struct{})
	connectorPageToken := ""
	for len(candidates) < localAppRouteOptionLimit {
		connectors, err := inventory.ListConnectors(ctx, &runtimev1.ListConnectorsRequest{
			PageSize:     200,
			PageToken:    connectorPageToken,
			KindFilter:   runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
			StatusFilter: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
		})
		if err != nil {
			return nil, err
		}
		for _, connector := range connectors.GetConnectors() {
			connectorID := strings.TrimSpace(connector.GetConnectorId())
			provider := strings.TrimSpace(connector.GetProvider())
			if connectorID == "" || provider == "" ||
				connector.GetKind() != runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED ||
				connector.GetStatus() != runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE {
				continue
			}
			modelPageToken := ""
			for len(candidates) < localAppRouteOptionLimit {
				models, err := inventory.ListConnectorModels(ctx, &runtimev1.ListConnectorModelsRequest{
					ConnectorId: connectorID,
					PageSize:    200,
					PageToken:   modelPageToken,
				})
				if err != nil {
					return nil, err
				}
				for _, model := range models.GetModels() {
					providerModelID := strings.TrimSpace(model.GetProviderModelId())
					remoteModelCatalogID := strings.TrimSpace(model.GetRemoteModelCatalogId())
					modelProvider := strings.TrimSpace(model.GetProvider())
					if !model.GetAvailable() || providerModelID == "" || remoteModelCatalogID == "" ||
						(modelProvider != "" && modelProvider != provider) {
						continue
					}
					label := strings.TrimSpace(model.GetModelLabel())
					if label == "" {
						label = providerModelID
					}
					for _, rawCapability := range model.GetCapabilities() {
						capability, normalizeErr := aicapabilities.NormalizeCatalogCapability(rawCapability)
						if normalizeErr != nil || !isAdmittedRuntimeAgentAIConfigCapability(capability) {
							continue
						}
						key := strings.Join([]string{capability, provider, providerModelID}, "\x00")
						if _, duplicate := seen[key]; duplicate {
							continue
						}
						seen[key] = struct{}{}
						candidates = append(candidates, localAppCloudRouteCandidate{
							option: &runtimev1.LocalAppAgentRouteOption{
								Capability: capability, Provider: provider, LogicalModelId: providerModelID,
								RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD, Label: label,
								Availability: runtimev1.LocalAppAgentRouteOptionAvailability_LOCAL_APP_AGENT_ROUTE_OPTION_AVAILABILITY_READY,
							},
							targetRef: &runtimev1.RuntimeDurableTargetRef{
								Target: &runtimev1.RuntimeDurableTargetRef_Cloud{
									Cloud: &runtimev1.RuntimeDurableCloudTargetRef{
										Version: "v2", ConnectorId: connectorID, RemoteModelCatalogId: remoteModelCatalogID,
										ProviderModelId: providerModelID, Provider: provider,
									},
								},
							},
						})
						if len(candidates) >= localAppRouteOptionLimit {
							break
						}
					}
					if len(candidates) >= localAppRouteOptionLimit {
						break
					}
				}
				modelPageToken = strings.TrimSpace(models.GetNextPageToken())
				if modelPageToken == "" {
					break
				}
			}
			if len(candidates) >= localAppRouteOptionLimit {
				break
			}
		}
		connectorPageToken = strings.TrimSpace(connectors.GetNextPageToken())
		if connectorPageToken == "" {
			break
		}
	}
	return candidates, nil
}

func (s *Service) materializeLocalAppCloudRouteTargets(
	ctx context.Context,
	intents []*runtimev1.RuntimeAgentAIConfigIntent,
) ([]*runtimev1.RuntimeAgentAIConfigIntent, error) {
	needsMaterialization := false
	for _, intent := range intents {
		if intent.GetRoutePolicy() == runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD && intent.GetTargetRef().GetTarget() == nil {
			needsMaterialization = true
			break
		}
	}
	if !needsMaterialization {
		return intents, nil
	}
	candidates, err := s.localAppCloudRouteCandidates(ctx)
	if err != nil {
		return nil, err
	}
	byRoute := make(map[string]*runtimev1.RuntimeDurableTargetRef, len(candidates))
	for _, candidate := range candidates {
		key := strings.Join([]string{
			strings.TrimSpace(candidate.option.GetCapability()),
			strings.TrimSpace(candidate.option.GetProvider()),
			strings.TrimSpace(candidate.option.GetLogicalModelId()),
		}, "\x00")
		byRoute[key] = candidate.targetRef
	}
	out := append([]*runtimev1.RuntimeAgentAIConfigIntent(nil), intents...)
	for index, intent := range intents {
		if intent.GetRoutePolicy() != runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD || intent.GetTargetRef().GetTarget() != nil {
			continue
		}
		key := strings.Join([]string{
			strings.TrimSpace(intent.GetCapability()),
			strings.TrimSpace(intent.GetProvider()),
			strings.TrimSpace(intent.GetModelId()),
		}, "\x00")
		targetRef := byRoute[key]
		if targetRef == nil {
			return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
		}
		materialized := proto.Clone(intent).(*runtimev1.RuntimeAgentAIConfigIntent)
		materialized.TargetRef = proto.Clone(targetRef).(*runtimev1.RuntimeDurableTargetRef)
		out[index] = materialized
	}
	return out, nil
}

func (s *Service) materializeLocalAppLocalRouteTargets(
	ctx context.Context,
	intents []*runtimev1.RuntimeAgentAIConfigIntent,
) ([]*runtimev1.RuntimeAgentAIConfigIntent, error) {
	needsMaterialization := false
	for _, intent := range intents {
		if intent.GetRoutePolicy() == runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL &&
			intent.GetTargetRef().GetTarget() == nil {
			needsMaterialization = true
			break
		}
	}
	if !needsMaterialization {
		return intents, nil
	}

	s.localAppRouteOptionsMu.RLock()
	inventory := s.localAppRouteOptions
	s.localAppRouteOptionsMu.RUnlock()
	if inventory == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	}

	type localRouteKey struct {
		capability string
		model      string
	}
	matches := make(map[localRouteKey]map[string]*runtimev1.LocalAssetRecord)
	for _, statusFilter := range []runtimev1.LocalAssetStatus{
		runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
		runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
	} {
		pageToken := ""
		for {
			response, err := inventory.ListLocalAssets(ctx, &runtimev1.ListLocalAssetsRequest{
				StatusFilter: statusFilter,
				PageSize:     200,
				PageToken:    pageToken,
			})
			if err != nil {
				return nil, err
			}
			for _, asset := range response.GetAssets() {
				model := strings.TrimSpace(asset.GetLogicalModelId())
				localAssetID := strings.TrimSpace(asset.GetLocalAssetId())
				if model == "" || localAssetID == "" || asset.GetDurableTargetRef().GetRef() == nil {
					continue
				}
				for _, rawCapability := range asset.GetCapabilities() {
					capability, normalizeErr := aicapabilities.NormalizeCatalogCapability(rawCapability)
					if normalizeErr != nil || !isAdmittedRuntimeAgentAIConfigCapability(capability) ||
						!localAppLocalAssetSelectableForNewBinding(asset, capability) {
						continue
					}
					key := localRouteKey{capability: capability, model: model}
					if matches[key] == nil {
						matches[key] = make(map[string]*runtimev1.LocalAssetRecord)
					}
					matches[key][localAssetID] = asset
				}
			}
			pageToken = strings.TrimSpace(response.GetNextPageToken())
			if pageToken == "" {
				break
			}
		}
	}

	out := append([]*runtimev1.RuntimeAgentAIConfigIntent(nil), intents...)
	for index, intent := range intents {
		if intent.GetRoutePolicy() != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL ||
			intent.GetTargetRef().GetTarget() != nil {
			continue
		}
		key := localRouteKey{
			capability: strings.TrimSpace(intent.GetCapability()),
			model:      strings.TrimSpace(intent.GetModelId()),
		}
		candidates := matches[key]
		if len(candidates) != 1 {
			return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
		}
		var selected *runtimev1.LocalAssetRecord
		for _, asset := range candidates {
			selected = asset
		}
		materialized := proto.Clone(intent).(*runtimev1.RuntimeAgentAIConfigIntent)
		materialized.TargetRef = &runtimev1.RuntimeDurableTargetRef{
			Target: &runtimev1.RuntimeDurableTargetRef_LocalRuntime{
				LocalRuntime: proto.Clone(selected.GetDurableTargetRef()).(*runtimev1.RuntimeDurableLocalTargetRef),
			},
		}
		out[index] = materialized
	}
	return out, nil
}

func localAppLocalAssetSelectableForNewBinding(
	asset *runtimev1.LocalAssetRecord,
	capability string,
) bool {
	if asset == nil || asset.GetDurableTargetRef().GetRef() == nil {
		return false
	}
	assetStatus := asset.GetStatus()
	targetStatus := asset.GetDurableTargetStatus()
	if targetStatus == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNSPECIFIED {
		targetStatus = assetStatus
	}
	if runtimeAgentAIConfigCapabilityRequiresActiveLocalTarget(capability) {
		return assetStatus == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE &&
			targetStatus == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE
	}
	return (assetStatus == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE ||
		assetStatus == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED) &&
		(targetStatus == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE ||
			targetStatus == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED)
}

func (s *Service) localAppLogicalModelForIntent(
	ctx context.Context,
	intent *runtimev1.RuntimeAgentAIConfigIntent,
) string {
	if intent == nil {
		return ""
	}
	if cloud := intent.GetTargetRef().GetCloud(); cloud != nil {
		return strings.TrimSpace(cloud.GetProviderModelId())
	}
	if local := intent.GetTargetRef().GetLocalRuntime(); local != nil {
		s.localAppRouteOptionsMu.RLock()
		resolver := s.localTargetResolver
		s.localAppRouteOptionsMu.RUnlock()
		if resolver == nil {
			return ""
		}
		binding, _, err := resolver.ResolveDurableLocalTarget(ctx, local, strings.TrimSpace(intent.GetCapability()))
		if err != nil || binding == nil {
			return ""
		}
		return strings.TrimSpace(binding.GetResolvedModelId())
	}
	if intent.GetRoutePolicy() != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
		return strings.TrimSpace(intent.GetModelId())
	}
	model := strings.TrimSpace(intent.GetModelId())
	if model == "" {
		return ""
	}
	s.localAppRouteOptionsMu.RLock()
	inventory := s.localAppRouteOptions
	s.localAppRouteOptionsMu.RUnlock()
	if inventory == nil {
		return ""
	}
	pageToken := ""
	for {
		response, err := inventory.ListLocalAssets(ctx, &runtimev1.ListLocalAssetsRequest{
			PageSize:  200,
			PageToken: pageToken,
		})
		if err != nil {
			return ""
		}
		for _, asset := range response.GetAssets() {
			if strings.TrimSpace(asset.GetLogicalModelId()) == model &&
				localAppAssetSupportsCapability(asset, strings.TrimSpace(intent.GetCapability())) {
				return model
			}
		}
		pageToken = strings.TrimSpace(response.GetNextPageToken())
		if pageToken == "" {
			return ""
		}
	}
}

func localAppAssetSupportsCapability(asset *runtimev1.LocalAssetRecord, capability string) bool {
	if asset == nil {
		return false
	}
	for _, rawCapability := range asset.GetCapabilities() {
		normalized, err := aicapabilities.NormalizeCatalogCapability(rawCapability)
		if err == nil && normalized == capability {
			return true
		}
	}
	return false
}

func addLocalAppRouteOption(
	options map[string]*runtimev1.LocalAppAgentRouteOption,
	option *runtimev1.LocalAppAgentRouteOption,
) {
	if option == nil {
		return
	}
	key := strings.Join([]string{
		strings.TrimSpace(option.GetCapability()),
		option.GetRoutePolicy().String(),
		strings.TrimSpace(option.GetProvider()),
		strings.TrimSpace(option.GetLogicalModelId()),
	}, "\x00")
	if key == "\x00\x00\x00" {
		return
	}
	if existing := options[key]; existing != nil {
		selected := existing
		if existing.GetAvailability() != runtimev1.LocalAppAgentRouteOptionAvailability_LOCAL_APP_AGENT_ROUTE_OPTION_AVAILABILITY_READY &&
			option.GetAvailability() == runtimev1.LocalAppAgentRouteOptionAvailability_LOCAL_APP_AGENT_ROUTE_OPTION_AVAILABILITY_READY {
			selected = option
		}
		labelSource := option
		if selected == option {
			labelSource = existing
		}
		if !localAppRouteOptionHasDisplayLabel(selected) && localAppRouteOptionHasDisplayLabel(labelSource) {
			selected = proto.Clone(selected).(*runtimev1.LocalAppAgentRouteOption)
			selected.Label = strings.TrimSpace(labelSource.GetLabel())
		}
		options[key] = selected
		return
	}
	options[key] = option
}

func localAppRouteOptionHasDisplayLabel(option *runtimev1.LocalAppAgentRouteOption) bool {
	if option == nil {
		return false
	}
	label := strings.TrimSpace(option.GetLabel())
	return label != "" && label != strings.TrimSpace(option.GetLogicalModelId())
}

func (s *Service) localAppReadinessProjection(localAgentRef string, revision uint64) (*runtimev1.LocalAppAgentReadinessProjection, error) {
	snapshot, err := s.currentRuntimeAgentAIConfigReadinessSnapshot(localAgentRef)
	if err != nil {
		return nil, err
	}
	if snapshot == nil || snapshot.GetConfigRevision() != revision {
		return nil, status.Error(codes.Unavailable, "runtime agent readiness projection unavailable")
	}
	items := make([]*runtimev1.LocalAppAgentCapabilityReadiness, 0, len(snapshot.GetCapabilities()))
	for _, item := range snapshot.GetCapabilities() {
		state := runtimev1.LocalAppAgentReadinessState_LOCAL_APP_AGENT_READINESS_STATE_FAILED
		switch item.GetState() {
		case runtimev1.RuntimeAgentAIConfigReadinessState_RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_READY:
			state = runtimev1.LocalAppAgentReadinessState_LOCAL_APP_AGENT_READINESS_STATE_READY
		case runtimev1.RuntimeAgentAIConfigReadinessState_RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_NOT_CONFIGURED:
			state = runtimev1.LocalAppAgentReadinessState_LOCAL_APP_AGENT_READINESS_STATE_BLOCKED
		case runtimev1.RuntimeAgentAIConfigReadinessState_RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_UNAVAILABLE:
			state = runtimev1.LocalAppAgentReadinessState_LOCAL_APP_AGENT_READINESS_STATE_UNAVAILABLE
		case runtimev1.RuntimeAgentAIConfigReadinessState_RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_CONFIGURED_UNVERIFIED:
			state = runtimev1.LocalAppAgentReadinessState_LOCAL_APP_AGENT_READINESS_STATE_CONFIGURED_UNVERIFIED
		}
		items = append(items, &runtimev1.LocalAppAgentCapabilityReadiness{
			Capability: item.GetCapability(), State: state, Reason: item.GetReasonCode(), ObservedAt: cloneTimestamp(item.GetProbedAt()),
		})
	}
	return &runtimev1.LocalAppAgentReadinessProjection{Capabilities: items, ConfigurationRevision: revision}, nil
}

func localAppAIConfigIntentsToRuntime(
	input []*runtimev1.LocalAppAgentAIConfigIntent,
	current []*runtimev1.RuntimeAgentAIConfigIntent,
) ([]*runtimev1.RuntimeAgentAIConfigIntent, error) {
	if len(input) == 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	currentByCapability := make(map[string]*runtimev1.RuntimeAgentAIConfigIntent, len(current))
	for _, intent := range current {
		if intent == nil {
			continue
		}
		currentByCapability[strings.TrimSpace(intent.GetCapability())] = intent
	}
	seen := make(map[string]struct{}, len(input))
	out := make([]*runtimev1.RuntimeAgentAIConfigIntent, 0, len(input))
	for _, item := range input {
		if item == nil {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		capability, err := aicapabilities.NormalizeCatalogCapability(item.GetCapability())
		if err != nil || !isAdmittedRuntimeAgentAIConfigCapability(capability) {
			return nil, grpcerr.WithReasonCode(codes.Unimplemented, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
		}
		if _, duplicate := seen[capability]; duplicate {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		seen[capability] = struct{}{}
		normalizedSelectedParams, paramsValid := normalizeRuntimeAgentAIConfigSelectedParams(
			capability,
			item.GetSelectedParams(),
		)
		if !paramsValid {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		provider := strings.TrimSpace(item.GetProvider())
		model := strings.TrimSpace(item.GetLogicalModelId())
		route := item.GetRoutePolicy()
		if model == "" || (route != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL && route != runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD) ||
			(route == runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL && provider != "") ||
			(route == runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD && provider == "") {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		committed := currentByCapability[capability]
		components, err := localAppAIConfigComponentsToRuntime(
			capability,
			item.GetSelectedComponents(),
			committed.GetSelectedComponents(),
		)
		if err != nil {
			return nil, err
		}
		next := &runtimev1.RuntimeAgentAIConfigIntent{
			Capability:         capability,
			Provider:           provider,
			ModelId:            model,
			RoutePolicy:        route,
			SelectedParams:     normalizedSelectedParams,
			SelectedComponents: components,
		}
		if localAppAIConfigIdentityMatchesRuntimeIntent(item, committed) {
			next = proto.Clone(committed).(*runtimev1.RuntimeAgentAIConfigIntent)
			next.Capability = capability
			next.Provider = provider
			next.ModelId = model
			next.RoutePolicy = route
			next.SelectedParams = normalizedSelectedParams
			next.SelectedComponents = components
		}
		out = append(out, next)
	}
	return out, nil
}

func localAppAIConfigIdentityMatchesRuntimeIntent(
	next *runtimev1.LocalAppAgentAIConfigIntent,
	current *runtimev1.RuntimeAgentAIConfigIntent,
) bool {
	if next == nil || current == nil ||
		next.GetRoutePolicy() != current.GetRoutePolicy() ||
		strings.TrimSpace(next.GetCapability()) != strings.TrimSpace(current.GetCapability()) {
		return false
	}
	nextProvider := strings.TrimSpace(next.GetProvider())
	nextModel := strings.TrimSpace(next.GetLogicalModelId())
	currentProvider := strings.TrimSpace(current.GetProvider())
	currentModel := strings.TrimSpace(current.GetModelId())
	if cloud := current.GetTargetRef().GetCloud(); cloud != nil {
		if currentProvider == "" {
			currentProvider = strings.TrimSpace(cloud.GetProvider())
		}
		if strings.TrimSpace(cloud.GetProviderModelId()) != "" {
			currentModel = strings.TrimSpace(cloud.GetProviderModelId())
		}
	}
	return nextProvider == currentProvider && nextModel == currentModel
}

func (s *Service) GetLocalAppAgentAutonomySnapshot(ctx context.Context, req *runtimev1.GetLocalAppAgentAutonomySnapshotRequest) (*runtimev1.LocalAppAgentAutonomySnapshotResponse, error) {
	if req == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	_, entry, _, err := s.authorizedLocalAppConfigureAgent(ctx, accountservice.LocalAppOperationAutonomySnapshot, req.GetAgentHandle())
	if err != nil {
		return nil, err
	}
	return &runtimev1.LocalAppAgentAutonomySnapshotResponse{Projection: localAppAutonomyProjection(entry.Agent.GetAutonomy())}, nil
}

func (s *Service) UpdateLocalAppAgentAutonomy(ctx context.Context, req *runtimev1.UpdateLocalAppAgentAutonomyRequest) (*runtimev1.LocalAppAgentUpdateAutonomyResponse, error) {
	if req == nil || req.GetExpectedAutonomyRevision() == 0 || req.GetIntent() == nil ||
		(req.GetIntent().Enabled == nil && req.GetIntent().Config == nil) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	_, _, identity, err := s.authorizedLocalAppConfigureAgent(ctx, accountservice.LocalAppOperationUpdateAutonomy, req.GetAgentHandle())
	if err != nil {
		return nil, err
	}
	var config *runtimev1.AgentAutonomyConfig
	if req.GetIntent().Config != nil {
		config, err = runtimeAutonomyConfigFromLocalApp(req.GetIntent().GetConfig())
		if err != nil {
			return nil, err
		}
	}
	autonomy, err := s.updateAgentAutonomyCAS(identity, req.GetExpectedAutonomyRevision(), agentAutonomyMutationIntent{
		enabled: req.GetIntent().Enabled,
		config:  config,
	})
	if err != nil {
		if status.Code(err) == codes.NotFound || status.Code(err) == codes.FailedPrecondition {
			return nil, localAppConfigurePermissionFailure(runtimev1.ReasonCode_LOCAL_APP_PERMISSION_DENIED, "denied")
		}
		return nil, err
	}
	return &runtimev1.LocalAppAgentUpdateAutonomyResponse{Projection: localAppAutonomyProjection(autonomy)}, nil
}

func runtimeAutonomyConfigFromLocalApp(input *runtimev1.LocalAppAgentAutonomyConfig) (*runtimev1.AgentAutonomyConfig, error) {
	if input == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	return validateAgentAutonomyMutationConfig(&runtimev1.AgentAutonomyConfig{
		DailyTokenBudget: input.GetDailyTokenBudget(), MaxTokensPerHook: input.GetMaxTokensPerHook(),
		MinHookInterval: input.GetMinHookInterval(), SuspendUntil: input.GetSuspendUntil(), Mode: runtimev1.AgentAutonomyMode(input.GetMode()),
	})
}

func localAppAutonomyProjection(input *runtimev1.AgentAutonomyState) *runtimev1.LocalAppAgentAutonomyProjection {
	if input == nil {
		return nil
	}
	config := input.GetConfig()
	var projectedConfig *runtimev1.LocalAppAgentAutonomyConfig
	if config != nil {
		projectedConfig = &runtimev1.LocalAppAgentAutonomyConfig{
			DailyTokenBudget: config.GetDailyTokenBudget(), MaxTokensPerHook: config.GetMaxTokensPerHook(),
			MinHookInterval: config.GetMinHookInterval(), SuspendUntil: cloneTimestamp(config.GetSuspendUntil()),
			Mode: runtimev1.LocalAppAgentAutonomyMode(config.GetMode()),
		}
	}
	return &runtimev1.LocalAppAgentAutonomyProjection{
		Enabled: input.GetEnabled(), Config: projectedConfig, UsedTokensInWindow: input.GetUsedTokensInWindow(),
		WindowStartedAt: cloneTimestamp(input.GetWindowStartedAt()), BudgetExhausted: input.GetBudgetExhausted(),
		SuspendedUntil: cloneTimestamp(input.GetSuspendedUntil()), AutonomyRevision: input.GetRevision(),
	}
}

func (s *Service) GetLocalAppAgentPresentationSnapshot(ctx context.Context, req *runtimev1.GetLocalAppAgentPresentationSnapshotRequest) (*runtimev1.LocalAppAgentPresentationSnapshotResponse, error) {
	if req == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	_, entry, _, err := s.authorizedLocalAppConfigureAgent(ctx, accountservice.LocalAppOperationPresentationSnapshot, req.GetAgentHandle())
	if err != nil {
		return nil, err
	}
	return &runtimev1.LocalAppAgentPresentationSnapshotResponse{Projection: localAppPresentationProjection(entry.Agent.GetPresentationProfile(), entry.Agent.GetPreviousPresentationProfile(), entry.Agent.GetPresentationProfileRevision())}, nil
}

func (s *Service) CommitLocalAppAgentPresentation(ctx context.Context, req *runtimev1.CommitLocalAppAgentPresentationRequest) (*runtimev1.LocalAppAgentCommitPresentationResponse, error) {
	if req == nil || req.GetIntent() == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	decision, _, identity, err := s.authorizedLocalAppConfigureAgent(ctx, accountservice.LocalAppOperationCommitPresentation, req.GetAgentHandle())
	if err != nil {
		return nil, err
	}
	profile, previous, revision, err := s.commitAgentPresentation(ctx, identity, decision.AppID, req.GetExpectedPresentationRevision(), agentPresentationMutation{
		profile: localAppPresentationIntentProfile(req.GetIntent()), importedAssets: req.GetImportedAssets(),
	})
	if err != nil {
		return nil, err
	}
	return &runtimev1.LocalAppAgentCommitPresentationResponse{Projection: localAppPresentationProjection(profile, previous, revision)}, nil
}

func localAppPresentationIntentProfile(input *runtimev1.LocalAppAgentPresentationIntent) *runtimev1.AgentPresentationProfile {
	if input == nil {
		return nil
	}
	return &runtimev1.AgentPresentationProfile{
		BackendKind: input.GetBackendKind(), AvatarAssetRef: input.GetAvatarAssetRef(), ExpressionProfileRef: input.GetExpressionProfileRef(),
		IdlePreset: input.GetIdlePreset(), InteractionPolicyRef: input.GetInteractionPolicyRef(), DefaultVoiceReference: input.GetDefaultVoiceReference(),
		AvatarAutoplay: input.GetAvatarAutoplay(), BackgroundAssetRef: input.GetBackgroundAssetRef(),
	}
}

func localAppPresentationProjection(profile, previous *runtimev1.AgentPresentationProfile, revision uint64) *runtimev1.LocalAppAgentPresentationProjection {
	cloned := clonePresentationProfile(profile)
	voice := ""
	if cloned != nil {
		voice = cloned.GetDefaultVoiceReference()
	}
	return &runtimev1.LocalAppAgentPresentationProjection{
		Profile: cloned, PreviousProfile: clonePresentationProfile(previous),
		DefaultVoiceReference: voice, PresentationRevision: revision,
	}
}

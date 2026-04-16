package localservice

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localrouting"
	"github.com/nimiplatform/nimi/runtime/internal/pagination"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
)

func resolveServiceInstallEndpoint(requestEndpoint string, modelEndpoint string) string {
	if endpoint := strings.TrimSpace(requestEndpoint); endpoint != "" {
		return endpoint
	}
	return strings.TrimSpace(modelEndpoint)
}

func (s *Service) ListLocalServices(_ context.Context, req *runtimev1.ListLocalServicesRequest) (*runtimev1.ListLocalServicesResponse, error) {
	statusFilter := req.GetStatusFilter()
	s.mu.RLock()
	services := make([]*runtimev1.LocalServiceDescriptor, 0, len(s.services)+1)
	for _, service := range s.services {
		if statusFilter != runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_UNSPECIFIED && service.GetStatus() != statusFilter {
			continue
		}
		services = append(services, cloneServiceDescriptor(service))
	}
	if managed := s.managedImageBackendServiceLocked(); managed != nil {
		if statusFilter == runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_UNSPECIFIED || managed.GetStatus() == statusFilter {
			services = append(services, managed)
		}
	}
	s.mu.RUnlock()
	sort.Slice(services, func(i, j int) bool {
		return services[i].GetServiceId() < services[j].GetServiceId()
	})
	filterDigest := pagination.FilterDigest(statusFilter.String())
	start, end, next, err := resolvePageBounds(req.GetPageToken(), filterDigest, req.GetPageSize(), 50, 200, len(services))
	if err != nil {
		return nil, err
	}
	return &runtimev1.ListLocalServicesResponse{
		Services:      services[start:end],
		NextPageToken: next,
	}, nil
}

func (s *Service) InstallLocalService(_ context.Context, req *runtimev1.InstallLocalServiceRequest) (*runtimev1.InstallLocalServiceResponse, error) {
	serviceID := strings.TrimSpace(req.GetServiceId())
	if serviceID == "" {
		serviceID = "svc_" + ulid.Make().String()
	}
	if isManagedImageBackendServiceID(serviceID) {
		return nil, managedImageBackendServiceMutationError(serviceID)
	}
	localModelID := strings.TrimSpace(req.GetLocalModelId())
	if localModelID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE)
	}

	now := nowISO()
	s.mu.Lock()
	defer s.mu.Unlock()

	model := cloneLocalAsset(s.assets[localModelID])
	if model == nil || model.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_REMOVED {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE)
	}
	modelMode := normalizeRuntimeMode(s.assetRuntimeModes[localModelID])

	engine := defaultString(strings.TrimSpace(req.GetEngine()), model.GetEngine())
	if !strings.EqualFold(engine, model.GetEngine()) {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_MODEL_PROVIDER_MISMATCH)
	}

	for existingID, existing := range s.services {
		if existing == nil {
			continue
		}
		if existing.GetStatus() == runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_REMOVED {
			continue
		}
		if existing.GetLocalModelId() == localModelID && existingID != serviceID {
			return nil, grpcerr.WithReasonCode(codes.AlreadyExists, runtimev1.ReasonCode_AI_LOCAL_SERVICE_ALREADY_INSTALLED)
		}
	}

	if existing := cloneServiceDescriptor(s.services[serviceID]); existing != nil && existing.GetStatus() != runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_REMOVED {
		if existing.GetLocalModelId() != localModelID {
			return nil, grpcerr.WithReasonCode(codes.AlreadyExists, runtimev1.ReasonCode_AI_LOCAL_SERVICE_ALREADY_INSTALLED)
		}
		return &runtimev1.InstallLocalServiceResponse{Service: existing}, nil
	}

	capabilities := normalizeStringSlice(req.GetCapabilities())
	if len(capabilities) == 0 {
		capabilities = normalizeStringSlice(model.GetCapabilities())
	}
	if len(capabilities) == 0 {
		capabilities = []string{"chat"}
	}
	serviceMode := modelMode
	if strings.TrimSpace(req.GetEndpoint()) != "" {
		serviceMode = runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT
	}
	modelEndpoint := effectiveEndpointForRuntimeMode(engine, modelMode, model.GetEndpoint(), s.managedEndpointForEngineLocked(engine))
	endpoint := resolveServiceInstallEndpoint(strings.TrimSpace(req.GetEndpoint()), modelEndpoint)
	if normalizeRuntimeMode(serviceMode) == runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT && strings.TrimSpace(endpoint) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_ENDPOINT_REQUIRED)
	}

	service := &runtimev1.LocalServiceDescriptor{
		ServiceId:    serviceID,
		Title:        defaultString(strings.TrimSpace(req.GetTitle()), serviceID),
		Engine:       engine,
		ArtifactType: "binary",
		Endpoint:     storedEndpointForRuntimeMode(serviceMode, endpoint, s.managedEndpointForEngineLocked(engine)),
		Capabilities: capabilities,
		LocalModelId: localModelID,
		Status:       runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_INSTALLED,
		InstalledAt:  now,
		UpdatedAt:    now,
	}
	s.services[service.GetServiceId()] = cloneServiceDescriptor(service)
	s.setServiceRuntimeModeLocked(service.GetServiceId(), serviceMode)
	s.appendRuntimeAuditLocked(&runtimev1.LocalAuditEvent{
		Id:         "audit_" + ulid.Make().String(),
		EventType:  "service_install_completed",
		OccurredAt: now,
		Source:     "local",
		Detail:     service.GetServiceId(),
	})
	return &runtimev1.InstallLocalServiceResponse{Service: service}, nil
}

func (s *Service) StartLocalService(ctx context.Context, req *runtimev1.StartLocalServiceRequest) (*runtimev1.StartLocalServiceResponse, error) {
	serviceID := strings.TrimSpace(req.GetServiceId())
	if serviceID == "" {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE, grpcerr.ReasonOptions{
			Message:    "service id is required",
			ActionHint: "select_local_service",
		})
	}
	if isManagedImageBackendServiceID(serviceID) {
		return nil, managedImageBackendServiceMutationError(serviceID)
	}
	current := s.serviceByID(serviceID)
	if current == nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.NotFound, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE, grpcerr.ReasonOptions{
			Message:    fmt.Sprintf("local service %s not found", serviceID),
			ActionHint: "select_installed_local_service",
		})
	}
	if current.GetStatus() == runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_REMOVED {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_SERVICE_INVALID_TRANSITION)
	}

	profile := collectDeviceProfile()
	warnings := startupCompatibilityWarnings(current.GetEngine(), profile)

	if current.GetStatus() != runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_ACTIVE {
		activated, err := s.updateServiceStatus(
			serviceID,
			runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_ACTIVE,
			appendWarnings("service active", warnings),
		)
		if err != nil {
			return nil, err
		}
		current = activated
	}

	probeEndpoint := s.serviceProbeEndpoint(current)
	bootstrapErr := s.bootstrapEngineIfManaged(ctx, current.GetEngine(), s.serviceRuntimeMode(current.GetServiceId()), probeEndpoint)
	probe := s.probeEndpoint(ctx, current.GetEngine(), probeEndpoint)
	if probe.healthy {
		s.resetServiceRecovery(serviceID)
		latest := s.serviceByID(serviceID)
		if latest == nil {
			return nil, grpcerr.WithReasonCodeOptions(codes.NotFound, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE, grpcerr.ReasonOptions{
				Message:    fmt.Sprintf("local service %s not found", serviceID),
				ActionHint: "select_installed_local_service",
			})
		}
		return &runtimev1.StartLocalServiceResponse{Service: latest}, nil
	}

	failures, _ := s.serviceRecoveryFailure(serviceID, time.Now().UTC())
	detail := appendWarnings(defaultString(probe.detail, "service probe failed"), warnings)
	detail = sanitizedServiceProbeDetail(detail, s.serviceRuntimeMode(serviceID), bootstrapErr)
	detail = fmt.Sprintf("%s; consecutive_failures=%d", detail, failures)
	unhealthy, err := s.updateServiceStatus(serviceID, runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_UNHEALTHY, detail)
	if err != nil {
		return nil, err
	}
	return &runtimev1.StartLocalServiceResponse{Service: unhealthy}, nil
}

func (s *Service) StopLocalService(_ context.Context, req *runtimev1.StopLocalServiceRequest) (*runtimev1.StopLocalServiceResponse, error) {
	serviceID := strings.TrimSpace(req.GetServiceId())
	if serviceID == "" {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE, grpcerr.ReasonOptions{
			Message:    "service id is required",
			ActionHint: "select_local_service",
		})
	}
	if isManagedImageBackendServiceID(serviceID) {
		return nil, managedImageBackendServiceMutationError(serviceID)
	}
	current := s.serviceByID(serviceID)
	if current == nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.NotFound, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE, grpcerr.ReasonOptions{
			Message:    fmt.Sprintf("local service %s not found", serviceID),
			ActionHint: "select_installed_local_service",
		})
	}
	svc, err := s.updateServiceStatus(serviceID, runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_INSTALLED, "service stopped")
	if err != nil {
		return nil, err
	}
	return &runtimev1.StopLocalServiceResponse{Service: svc}, nil
}

func (s *Service) CheckLocalServiceHealth(ctx context.Context, req *runtimev1.CheckLocalServiceHealthRequest) (*runtimev1.CheckLocalServiceHealthResponse, error) {
	target := strings.TrimSpace(req.GetServiceId())
	s.mu.RLock()
	services := make([]*runtimev1.LocalServiceDescriptor, 0, len(s.services)+1)
	for _, service := range s.services {
		if target != "" && service.GetServiceId() != target {
			continue
		}
		services = append(services, cloneServiceDescriptor(service))
	}
	if managed := s.managedImageBackendServiceLocked(); managed != nil {
		if target == "" || managed.GetServiceId() == target {
			services = append(services, managed)
		}
	}
	s.mu.RUnlock()
	if target != "" && len(services) == 0 {
		return nil, grpcerr.WithReasonCodeOptions(codes.NotFound, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE, grpcerr.ReasonOptions{
			Message:    fmt.Sprintf("local service %s not found", target),
			ActionHint: "select_installed_local_service",
		})
	}

	healthRows := make([]*runtimev1.LocalServiceDescriptor, 0, len(services))
	for _, service := range services {
		if service == nil {
			continue
		}
		if isManagedImageBackendServiceID(service.GetServiceId()) {
			healthRows = append(healthRows, service)
			continue
		}
		serviceID := strings.TrimSpace(service.GetServiceId())
		switch service.GetStatus() {
		case runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_ACTIVE:
			probeEndpoint := s.serviceProbeEndpoint(service)
			bootstrapErr := s.bootstrapEngineIfManaged(ctx, service.GetEngine(), s.serviceRuntimeMode(serviceID), probeEndpoint)
			probe := s.probeEndpoint(ctx, service.GetEngine(), probeEndpoint)
			if probe.healthy {
				s.resetServiceRecovery(serviceID)
				healthRows = append(healthRows, service)
				continue
			}
			failures, interval := s.serviceRecoveryFailure(serviceID, time.Now().UTC())
			detail := sanitizedServiceProbeDetail(defaultString(probe.detail, "service probe failed"), s.serviceRuntimeMode(serviceID), bootstrapErr)
			detail = fmt.Sprintf("%s; consecutive_failures=%d; next_probe_in=%s", detail, failures, interval.String())
			transitioned, err := s.updateServiceStatus(serviceID, runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_UNHEALTHY, detail)
			if err != nil {
				return nil, err
			}
			healthRows = append(healthRows, transitioned)
		case runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_UNHEALTHY:
			probeEndpoint := s.serviceProbeEndpoint(service)
			bootstrapErr := s.bootstrapEngineIfManaged(ctx, service.GetEngine(), s.serviceRuntimeMode(serviceID), probeEndpoint)
			probe := s.probeEndpoint(ctx, service.GetEngine(), probeEndpoint)
			if probe.healthy {
				successes := s.serviceRecoverySuccess(serviceID, time.Now().UTC())
				if successes >= localRecoverySuccessThreshold {
					recovered, err := s.updateServiceStatus(serviceID, runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_ACTIVE, "service active")
					if err != nil {
						return nil, err
					}
					s.resetServiceRecovery(serviceID)
					healthRows = append(healthRows, recovered)
				} else {
					health := cloneServiceDescriptor(service)
					detail := sanitizedServiceProbeDetail(fmt.Sprintf("recovery probe succeeded (%d/%d)", successes, localRecoverySuccessThreshold), s.serviceRuntimeMode(serviceID), nil)
					health.Detail = detail
					health.ReasonCode = projectionReasonCodeForEngine(service.GetEngine(), detail)
					healthRows = append(healthRows, health)
				}
				continue
			}
			failures, interval := s.serviceRecoveryFailure(serviceID, time.Now().UTC())
			health := cloneServiceDescriptor(service)
			detail := sanitizedServiceProbeDetail(defaultString(probe.detail, "service probe failed"), s.serviceRuntimeMode(serviceID), bootstrapErr)
			health.Detail = fmt.Sprintf("%s; consecutive_failures=%d; next_probe_in=%s", detail, failures, interval.String())
			health.ReasonCode = projectionReasonCodeForEngine(service.GetEngine(), health.GetDetail())
			healthRows = append(healthRows, health)
		case runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_REMOVED:
			s.resetServiceRecovery(serviceID)
			health := cloneServiceDescriptor(service)
			health.Detail = defaultString(health.GetDetail(), "service removed")
			healthRows = append(healthRows, health)
		default:
			s.resetServiceRecovery(serviceID)
			health := cloneServiceDescriptor(service)
			health.Detail = defaultString(health.GetDetail(), "service idle")
			healthRows = append(healthRows, health)
		}
	}
	sort.Slice(healthRows, func(i, j int) bool {
		return healthRows[i].GetServiceId() < healthRows[j].GetServiceId()
	})
	return &runtimev1.CheckLocalServiceHealthResponse{Services: healthRows}, nil
}

func (s *Service) RemoveLocalService(_ context.Context, req *runtimev1.RemoveLocalServiceRequest) (*runtimev1.RemoveLocalServiceResponse, error) {
	serviceID := strings.TrimSpace(req.GetServiceId())
	if serviceID == "" {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE, grpcerr.ReasonOptions{
			Message:    "service id is required",
			ActionHint: "select_local_service",
		})
	}
	if isManagedImageBackendServiceID(serviceID) {
		return nil, managedImageBackendServiceMutationError(serviceID)
	}
	current := s.serviceByID(serviceID)
	if current == nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.NotFound, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE, grpcerr.ReasonOptions{
			Message:    fmt.Sprintf("local service %s not found", serviceID),
			ActionHint: "select_installed_local_service",
		})
	}
	svc, err := s.updateServiceStatus(serviceID, runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_REMOVED, "service removed")
	if err != nil {
		return nil, err
	}
	return &runtimev1.RemoveLocalServiceResponse{Service: svc}, nil
}

func isManagedImageBackendServiceID(serviceID string) bool {
	return strings.EqualFold(strings.TrimSpace(serviceID), managedImageBackendServiceID)
}

func managedImageBackendServiceMutationError(serviceID string) error {
	return grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_SERVICE_INVALID_TRANSITION, grpcerr.ReasonOptions{
		Message:    fmt.Sprintf("local service %s is daemon-managed", strings.TrimSpace(serviceID)),
		ActionHint: "manage_managed_image_backend_from_runtime_config",
	})
}

func (s *Service) managedImageBackendServiceLocked() *runtimev1.LocalServiceDescriptor {
	if !s.managedMediaBackendConfigured {
		return nil
	}
	status := s.managedMediaBackendStatus
	if status == runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_UNSPECIFIED {
		status = runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_INSTALLED
	}
	endpoint := strings.TrimSpace(s.managedMediaBackendAddress)
	if endpoint != "" && !strings.Contains(endpoint, "://") {
		endpoint = "grpc://" + endpoint
	}
	installedAt := strings.TrimSpace(s.managedMediaBackendInstalledAt)
	if installedAt == "" {
		installedAt = nowISO()
	}
	updatedAt := strings.TrimSpace(s.managedMediaBackendUpdatedAt)
	if updatedAt == "" {
		updatedAt = installedAt
	}
	return &runtimev1.LocalServiceDescriptor{
		ServiceId:    managedImageBackendServiceID,
		Title:        managedImageBackendServiceTitle,
		Engine:       "media",
		ArtifactType: "binary",
		Endpoint:     endpoint,
		Capabilities: []string{"image"},
		Status:       status,
		Detail:       strings.TrimSpace(s.managedMediaBackendDetail),
		InstalledAt:  installedAt,
		UpdatedAt:    updatedAt,
	}
}

func (s *Service) ListNodeCatalog(ctx context.Context, req *runtimev1.ListNodeCatalogRequest) (*runtimev1.ListNodeCatalogResponse, error) {
	capabilityFilter := strings.ToLower(strings.TrimSpace(req.GetCapability()))
	serviceFilter := strings.TrimSpace(req.GetServiceId())
	providerFilter := strings.ToLower(strings.TrimSpace(req.GetProvider()))
	typeFilter := strings.ToLower(strings.TrimSpace(req.GetTypeFilter()))
	deviceProfile := collectDeviceProfile()

	s.mu.RLock()
	services := make([]*runtimev1.LocalServiceDescriptor, 0, len(s.services))
	for _, service := range s.services {
		services = append(services, cloneServiceDescriptor(service))
	}
	models := make(map[string]*runtimev1.LocalAssetRecord, len(s.assets))
	for localModelID, model := range s.assets {
		models[localModelID] = cloneLocalAsset(model)
	}
	s.mu.RUnlock()

	nodes := make([]*runtimev1.LocalNodeDescriptor, 0, len(services)*2)
	probeCache := make(map[string]endpointProbeResult)
	for _, service := range services {
		if serviceFilter != "" && service.GetServiceId() != serviceFilter {
			continue
		}
		if service.GetStatus() != runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_ACTIVE {
			continue
		}
		provider := strings.ToLower(defaultString(service.GetEngine(), "llama"))
		if providerFilter != "" && provider != providerFilter {
			continue
		}
		capabilities := service.GetCapabilities()
		if len(capabilities) == 0 {
			capabilities = []string{"chat"}
		}
		for _, capability := range capabilities {
			if capabilityFilter != "" && strings.ToLower(capability) != capabilityFilter {
				continue
			}
			available := true
			adapter := adapterForProviderCapability(provider, capability)
			apiPath := apiPathForProviderCapability(provider, capability)
			if typeFilter != "" && !strings.Contains(strings.ToLower(adapter), typeFilter) {
				continue
			}
			reasonCode := ""
			policyGate := ""
			availabilityDetail := ""
			if localrouting.IsKnownProvider(provider) && isKnownLocalCapability(capability) && !localrouting.ProviderSupportsCapability(provider, capability) {
				available = false
				reasonCode = runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED.String()
				policyGate = unsupportedProviderCapabilityPolicyGate(provider, capability)
			}
			if available && provider == "media" && capabilityRequiresNodeProbe(provider, capability) {
				model := models[strings.TrimSpace(service.GetLocalModelId())]
				var probe endpointProbeResult
				endpoint := s.serviceProbeEndpoint(service)
				if model != nil {
					endpoint = s.effectiveLocalModelEndpoint(model)
				}
				if cached, ok := probeCache[endpoint]; ok {
					probe = cached
				} else {
					probe = s.probeEndpoint(ctx, provider, endpoint)
					probeCache[endpoint] = probe
				}
				if model == nil || !providerCapabilityProbeSucceeded(provider, model, probe) {
					available = false
					reasonCode = runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE.String()
					policyGate = provider + ".capability_probe.missing"
					if model == nil {
						availabilityDetail = provider + " capability probe requires an installed local model"
					} else {
						availabilityDetail = providerCapabilityProbeFailureDetail(provider, model, probe)
					}
				}
			}
			if available && isCustomCapability(capability) && missingCustomInvokeProfile(service, models) {
				available = false
				reasonCode = runtimev1.ReasonCode_AI_LOCAL_MODEL_PROFILE_MISSING.String()
				policyGate = "custom.invoke_profile.missing"
			}
			nodeID := fmt.Sprintf("%s:%s", service.GetServiceId(), strings.ToLower(strings.TrimSpace(capability)))
			hints := buildNodeProviderHints(service, provider, capability, adapter, policyGate, available, deviceProfile)
			if hints != nil {
				if strings.TrimSpace(availabilityDetail) != "" {
					hints.Extra["availability_detail"] = availabilityDetail
				}
			}
			nodes = append(nodes, &runtimev1.LocalNodeDescriptor{
				NodeId:        nodeID,
				Title:         fmt.Sprintf("%s %s node", service.GetTitle(), capability),
				ServiceId:     service.GetServiceId(),
				Capabilities:  []string{capability},
				Provider:      provider,
				Adapter:       adapter,
				Backend:       provider,
				BackendSource: "runtime",
				Available:     available,
				ReasonCode:    reasonCode,
				ProviderHints: hints,
				PolicyGate:    policyGate,
				ApiPath:       apiPath,
				ReadOnly:      false,
			})
		}
	}
	sort.Slice(nodes, func(i, j int) bool {
		typeI := strings.ToLower(strings.TrimSpace(nodes[i].GetAdapter()))
		typeJ := strings.ToLower(strings.TrimSpace(nodes[j].GetAdapter()))
		if typeI != typeJ {
			return typeI < typeJ
		}
		return nodes[i].GetNodeId() < nodes[j].GetNodeId()
	})
	filterDigest := pagination.FilterDigest(capabilityFilter, serviceFilter, providerFilter, typeFilter)
	start, end, next, err := resolvePageBounds(req.GetPageToken(), filterDigest, req.GetPageSize(), 50, 200, len(nodes))
	if err != nil {
		return nil, err
	}
	return &runtimev1.ListNodeCatalogResponse{
		Nodes:         nodes[start:end],
		NextPageToken: next,
	}, nil
}

func unsupportedProviderCapabilityPolicyGate(provider string, capability string) string {
	normalizedProvider := strings.ToLower(strings.TrimSpace(provider))
	switch localrouting.NormalizeCapability(capability) {
	case "image.generate":
		return normalizedProvider + ".image.unsupported"
	case "video.generate":
		return normalizedProvider + ".video.unsupported"
	case "text.embed":
		return normalizedProvider + ".embed.unsupported"
	case "audio.synthesize", "audio.understand":
		return normalizedProvider + ".audio.unsupported"
	case "music.generate":
		return normalizedProvider + ".music.unsupported"
	default:
		return normalizedProvider + ".text.unsupported"
	}
}

func isKnownLocalCapability(capability string) bool {
	switch localrouting.NormalizeCapability(capability) {
	case "text.generate", "text.embed", "image.generate", "image.edit", "video.generate", "i2v", "image.understand", "audio.understand", "music.generate",
		"audio.synthesize", "audio.transcribe", "voice_workflow.tts_v2v", "voice_workflow.tts_t2v":
		return true
	default:
		return false
	}
}

func capabilityRequiresNodeProbe(provider string, capability string) bool {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case "media":
		switch strings.ToLower(strings.TrimSpace(capability)) {
		case "image", "image.generate", "image.edit", "video", "video.generate", "i2v":
			return true
		default:
			return false
		}
	default:
		return false
	}
}

func providerCapabilityProbeSucceeded(provider string, model *runtimev1.LocalAssetRecord, probe endpointProbeResult) bool {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case "media":
		return mediaModelProbeSucceeded(model, probe)
	default:
		return probe.healthy
	}
}

func providerCapabilityProbeFailureDetail(provider string, model *runtimev1.LocalAssetRecord, probe endpointProbeResult) string {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case "media":
		return mediaModelProbeFailureDetail(model, probe)
	default:
		return defaultString(probe.detail, "provider capability probe failed")
	}
}

func isCustomCapability(capability string) bool {
	normalized := strings.ToLower(strings.TrimSpace(capability))
	if normalized == "" {
		return false
	}
	return normalized == "custom" || strings.HasPrefix(normalized, "custom.") || strings.HasPrefix(normalized, "custom/")
}

func missingCustomInvokeProfile(service *runtimev1.LocalServiceDescriptor, models map[string]*runtimev1.LocalAssetRecord) bool {
	localModelID := strings.TrimSpace(service.GetLocalModelId())
	if localModelID == "" {
		return true
	}
	model, ok := models[localModelID]
	if !ok || model == nil {
		return true
	}
	return strings.TrimSpace(model.GetLocalInvokeProfileId()) == ""
}

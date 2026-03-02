package localruntime

import (
	"context"
	"fmt"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
)

func (s *Service) ListLocalServices(context.Context, *runtimev1.ListLocalServicesRequest) (*runtimev1.ListLocalServicesResponse, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	services := make([]*runtimev1.LocalServiceDescriptor, 0, len(s.services))
	for _, service := range s.services {
		services = append(services, cloneServiceDescriptor(service))
	}
	sort.Slice(services, func(i, j int) bool {
		if services[i].GetInstalledAt() == services[j].GetInstalledAt() {
			return services[i].GetServiceId() < services[j].GetServiceId()
		}
		return services[i].GetInstalledAt() > services[j].GetInstalledAt()
	})
	return &runtimev1.ListLocalServicesResponse{Services: services}, nil
}

func (s *Service) InstallLocalService(_ context.Context, req *runtimev1.InstallLocalServiceRequest) (*runtimev1.InstallLocalServiceResponse, error) {
	serviceID := strings.TrimSpace(req.GetServiceId())
	if serviceID == "" {
		serviceID = "svc_" + ulid.Make().String()
	}
	now := nowISO()
	service := &runtimev1.LocalServiceDescriptor{
		ServiceId:    serviceID,
		Title:        defaultString(strings.TrimSpace(req.GetTitle()), serviceID),
		Engine:       defaultString(strings.TrimSpace(req.GetEngine()), "localai"),
		ArtifactType: "binary",
		Endpoint:     defaultString(strings.TrimSpace(req.GetEndpoint()), defaultServiceEndpoint),
		Capabilities: normalizeStringSlice(req.GetCapabilities()),
		LocalModelId: strings.TrimSpace(req.GetLocalModelId()),
		Status:       runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_INSTALLED,
		InstalledAt:  now,
		UpdatedAt:    now,
	}
	if len(service.GetCapabilities()) == 0 {
		service.Capabilities = []string{"chat"}
	}

	s.mu.Lock()
	s.services[service.GetServiceId()] = cloneServiceDescriptor(service)
	s.appendRuntimeAuditLocked(&runtimev1.LocalAuditEvent{
		Id:         "audit_" + ulid.Make().String(),
		EventType:  "service_install_completed",
		OccurredAt: now,
		Source:     "local-runtime",
		Detail:     service.GetServiceId(),
	})
	s.mu.Unlock()
	return &runtimev1.InstallLocalServiceResponse{Service: service}, nil
}

func (s *Service) StartLocalService(_ context.Context, req *runtimev1.StartLocalServiceRequest) (*runtimev1.StartLocalServiceResponse, error) {
	svc, err := s.updateServiceStatus(req.GetServiceId(), runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_ACTIVE, "service active")
	if err != nil {
		return nil, err
	}
	return &runtimev1.StartLocalServiceResponse{Service: svc}, nil
}

func (s *Service) StopLocalService(_ context.Context, req *runtimev1.StopLocalServiceRequest) (*runtimev1.StopLocalServiceResponse, error) {
	svc, err := s.updateServiceStatus(req.GetServiceId(), runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_INSTALLED, "service stopped")
	if err != nil {
		return nil, err
	}
	return &runtimev1.StopLocalServiceResponse{Service: svc}, nil
}

func (s *Service) CheckLocalServiceHealth(_ context.Context, req *runtimev1.CheckLocalServiceHealthRequest) (*runtimev1.CheckLocalServiceHealthResponse, error) {
	target := strings.TrimSpace(req.GetServiceId())
	s.mu.RLock()
	defer s.mu.RUnlock()
	services := make([]*runtimev1.LocalServiceDescriptor, 0, len(s.services))
	for _, service := range s.services {
		if target != "" && service.GetServiceId() != target {
			continue
		}
		health := cloneServiceDescriptor(service)
		switch health.GetStatus() {
		case runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_ACTIVE:
			health.Detail = "service healthy"
		case runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_UNHEALTHY:
			health.Detail = defaultString(health.GetDetail(), "service unhealthy")
		case runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_REMOVED:
			health.Detail = "service removed"
		default:
			health.Detail = "service idle"
		}
		services = append(services, health)
	}
	sort.Slice(services, func(i, j int) bool {
		return services[i].GetServiceId() < services[j].GetServiceId()
	})
	return &runtimev1.CheckLocalServiceHealthResponse{Services: services}, nil
}

func (s *Service) RemoveLocalService(_ context.Context, req *runtimev1.RemoveLocalServiceRequest) (*runtimev1.RemoveLocalServiceResponse, error) {
	svc, err := s.updateServiceStatus(req.GetServiceId(), runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_REMOVED, "service removed")
	if err != nil {
		return nil, err
	}
	return &runtimev1.RemoveLocalServiceResponse{Service: svc}, nil
}

func (s *Service) ListNodeCatalog(_ context.Context, req *runtimev1.ListNodeCatalogRequest) (*runtimev1.ListNodeCatalogResponse, error) {
	capabilityFilter := strings.ToLower(strings.TrimSpace(req.GetCapability()))
	serviceFilter := strings.TrimSpace(req.GetServiceId())
	providerFilter := strings.ToLower(strings.TrimSpace(req.GetProvider()))
	deviceProfile := collectDeviceProfile()

	s.mu.RLock()
	defer s.mu.RUnlock()

	nodes := make([]*runtimev1.LocalNodeDescriptor, 0, len(s.services)*2)
	for _, service := range s.services {
		if serviceFilter != "" && service.GetServiceId() != serviceFilter {
			continue
		}
		provider := strings.ToLower(defaultString(service.GetEngine(), "localai"))
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
			available := service.GetStatus() != runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_REMOVED
			adapter := adapterForProviderCapability(provider, capability)
			apiPath := apiPathForProviderCapability(provider, capability)
			reasonCode := ""
			policyGate := ""
			if provider == "nexa" && strings.EqualFold(strings.TrimSpace(capability), "video") {
				available = false
				reasonCode = runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED.String()
				policyGate = "nexa.video.unsupported"
			}
			nodeID := fmt.Sprintf("node_%s_%s", slug(service.GetServiceId()), slug(capability))
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
				ProviderHints: buildNodeProviderHints(service, provider, capability, adapter, policyGate, available, deviceProfile),
				PolicyGate:    policyGate,
				ApiPath:       apiPath,
				ReadOnly:      false,
			})
		}
	}
	sort.Slice(nodes, func(i, j int) bool {
		return nodes[i].GetNodeId() < nodes[j].GetNodeId()
	})
	return &runtimev1.ListNodeCatalogResponse{Nodes: nodes}, nil
}

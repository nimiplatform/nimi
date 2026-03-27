package localservice

import (
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/oklog/ulid/v2"
)

// validModelTransitions defines the allowed state machine transitions per K-LOCAL-005.
var validModelTransitions = map[runtimev1.LocalModelStatus][]runtimev1.LocalModelStatus{
	runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_INSTALLED: {
		runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE,
		runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_REMOVED,
	},
	runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE: {
		runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY,
		runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_INSTALLED,
		runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_REMOVED,
	},
	runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY: {
		runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE,
		runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_INSTALLED,
		runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_REMOVED,
	},
}

// validServiceTransitions defines the allowed state machine transitions per K-LOCAL-005.
var validServiceTransitions = map[runtimev1.LocalServiceStatus][]runtimev1.LocalServiceStatus{
	runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_INSTALLED: {
		runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_ACTIVE,
		runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_REMOVED,
	},
	runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_ACTIVE: {
		runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_UNHEALTHY,
		runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_INSTALLED,
		runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_REMOVED,
	},
	runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_UNHEALTHY: {
		runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_ACTIVE,
		runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_INSTALLED,
		runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_REMOVED,
	},
}

func isValidModelTransition(from, to runtimev1.LocalModelStatus) bool {
	for _, allowed := range validModelTransitions[from] {
		if allowed == to {
			return true
		}
	}
	return false
}

func isValidServiceTransition(from, to runtimev1.LocalServiceStatus) bool {
	for _, allowed := range validServiceTransitions[from] {
		if allowed == to {
			return true
		}
	}
	return false
}

func (s *Service) updateModelStatus(localModelID string, status runtimev1.LocalModelStatus, detail string) (*runtimev1.LocalModelRecord, error) {
	id := strings.TrimSpace(localModelID)
	if id == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	now := nowISO()
	s.mu.Lock()
	defer s.mu.Unlock()
	current := cloneLocalModel(s.models[id])
	if current == nil {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	if !isValidModelTransition(current.GetStatus(), status) {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_INVALID_TRANSITION)
	}
	current.Status = status
	current.UpdatedAt = now
	current.HealthDetail = detail
	s.models[id] = cloneLocalModel(current)
	if status == runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_REMOVED {
		delete(s.modelRuntimeModes, id)
	}
	if status != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY {
		delete(s.modelProbeState, id)
	}
	s.appendRuntimeAuditLocked(&runtimev1.LocalAuditEvent{
		Id:           "audit_" + ulid.Make().String(),
		EventType:    "runtime_model_status_changed",
		OccurredAt:   now,
		Source:       "local",
		ModelId:      current.GetModelId(),
		LocalModelId: current.GetLocalModelId(),
		Detail:       detail,
	})
	return current, nil
}

func (s *Service) updateServiceStatus(serviceID string, status runtimev1.LocalServiceStatus, detail string) (*runtimev1.LocalServiceDescriptor, error) {
	id := strings.TrimSpace(serviceID)
	if id == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE)
	}
	now := nowISO()
	s.mu.Lock()
	defer s.mu.Unlock()
	current := cloneServiceDescriptor(s.services[id])
	if current == nil {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE)
	}
	if !isValidServiceTransition(current.GetStatus(), status) {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_SERVICE_INVALID_TRANSITION)
	}
	current.Status = status
	current.UpdatedAt = now
	current.Detail = detail
	s.services[id] = cloneServiceDescriptor(current)
	if status == runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_REMOVED {
		delete(s.serviceRuntimeModes, id)
	}
	if status != runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_UNHEALTHY {
		delete(s.serviceProbeState, id)
	}
	s.appendRuntimeAuditLocked(&runtimev1.LocalAuditEvent{
		Id:         "audit_" + ulid.Make().String(),
		EventType:  "runtime_service_status_changed",
		OccurredAt: now,
		Source:     "local",
		Detail:     detail,
		Payload: toStruct(map[string]any{
			"serviceId": current.GetServiceId(),
			"status":    current.GetStatus().String(),
		}),
	})
	return current, nil
}

func (s *Service) resolveCatalogItem(req *runtimev1.ResolveModelInstallPlanRequest) *runtimev1.LocalCatalogModelDescriptor {
	itemID := strings.TrimSpace(req.GetItemId())
	templateID := strings.TrimSpace(req.GetTemplateId())
	modelID := strings.TrimSpace(req.GetModelId())
	repo := strings.TrimSpace(req.GetRepo())
	source := strings.TrimSpace(req.GetSource())
	for _, item := range s.catalog {
		if itemID != "" && item.GetItemId() == itemID {
			return item
		}
		if templateID != "" && item.GetTemplateId() == templateID {
			return item
		}
		if modelID != "" && item.GetModelId() == modelID {
			if repo == "" || item.GetRepo() == repo {
				if source == "" || strings.EqualFold(source, item.GetSource()) {
					return item
				}
			}
		}
	}
	return nil
}

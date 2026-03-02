package localruntime

import (
	"context"
	"fmt"
	"strings"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
)

func (s *Service) ListLocalAudits(_ context.Context, req *runtimev1.ListLocalAuditsRequest) (*runtimev1.ListLocalAuditsResponse, error) {
	limit := int(req.GetLimit())
	if limit <= 0 {
		limit = 200
	}
	s.mu.RLock()
	source := make([]*runtimev1.LocalAuditEvent, len(s.audits))
	for i, event := range s.audits {
		source[i] = cloneLocalAuditEvent(event)
	}
	s.mu.RUnlock()

	eventTypes := make(map[string]bool)
	for _, item := range req.GetEventTypes() {
		normalized := strings.TrimSpace(item)
		if normalized != "" {
			eventTypes[normalized] = true
		}
	}
	if eventType := strings.TrimSpace(req.GetEventType()); eventType != "" {
		eventTypes[eventType] = true
	}

	filtered := make([]*runtimev1.LocalAuditEvent, 0, limit)
	for _, event := range source {
		if !matchesLocalAuditFilter(event, req, eventTypes) {
			continue
		}
		filtered = append(filtered, event)
		if len(filtered) >= limit {
			break
		}
	}
	return &runtimev1.ListLocalAuditsResponse{Events: filtered}, nil
}

func (s *Service) AppendInferenceAudit(_ context.Context, req *runtimev1.AppendInferenceAuditRequest) (*runtimev1.Ack, error) {
	event := &runtimev1.LocalAuditEvent{
		Id:           "audit_" + ulid.Make().String(),
		EventType:    strings.TrimSpace(req.GetEventType()),
		OccurredAt:   nowISO(),
		Source:       strings.TrimSpace(req.GetSource()),
		Modality:     strings.TrimSpace(req.GetModality()),
		ReasonCode:   strings.TrimSpace(req.GetReasonCode()),
		Detail:       strings.TrimSpace(req.GetDetail()),
		ModelId:      strings.TrimSpace(req.GetModel()),
		LocalModelId: strings.TrimSpace(req.GetLocalModelId()),
		Payload:      mergeInferencePayload(req),
	}
	if event.GetEventType() == "" {
		event.EventType = "inference_invoked"
	}
	if event.GetDetail() == "" {
		event.Detail = strings.TrimSpace(req.GetProvider())
	}

	s.mu.Lock()
	s.appendRuntimeAuditLocked(event)
	s.mu.Unlock()
	return &runtimev1.Ack{Ok: true, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) AppendRuntimeAudit(_ context.Context, req *runtimev1.AppendRuntimeAuditRequest) (*runtimev1.Ack, error) {
	event := &runtimev1.LocalAuditEvent{
		Id:           "audit_" + ulid.Make().String(),
		EventType:    defaultString(strings.TrimSpace(req.GetEventType()), "runtime_event"),
		OccurredAt:   nowISO(),
		Source:       "local-runtime",
		ReasonCode:   "",
		Detail:       "",
		ModelId:      strings.TrimSpace(req.GetModelId()),
		LocalModelId: strings.TrimSpace(req.GetLocalModelId()),
		Payload:      cloneStruct(req.GetPayload()),
	}
	s.mu.Lock()
	s.appendRuntimeAuditLocked(event)
	s.mu.Unlock()
	return &runtimev1.Ack{Ok: true, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) appendRuntimeAuditLocked(event *runtimev1.LocalAuditEvent) {
	if event == nil {
		return
	}
	copy := cloneLocalAuditEvent(event)
	if copy.GetId() == "" {
		copy.Id = "audit_" + ulid.Make().String()
	}
	if copy.GetOccurredAt() == "" {
		copy.OccurredAt = nowISO()
	}
	s.audits = append([]*runtimev1.LocalAuditEvent{copy}, s.audits...)
	if len(s.audits) > 5000 {
		s.audits = append([]*runtimev1.LocalAuditEvent(nil), s.audits[:5000]...)
	}
	s.persistStateLocked()
	if s.auditStore == nil {
		return
	}

	reasonCode := runtimev1.ReasonCode_ACTION_EXECUTED
	if raw := strings.TrimSpace(copy.GetReasonCode()); raw != "" {
		if parsed, ok := runtimev1.ReasonCode_value[raw]; ok {
			reasonCode = runtimev1.ReasonCode(parsed)
		}
	}
	s.auditStore.AppendEvent(&runtimev1.AuditEventRecord{
		AuditId:       copy.GetId(),
		AppId:         "nimi.desktop",
		Domain:        localRuntimeAuditDomain,
		Operation:     strings.TrimSpace(copy.GetEventType()),
		ReasonCode:    reasonCode,
		TraceId:       ulid.Make().String(),
		Timestamp:     timestamppb.New(time.Now().UTC()),
		Payload:       cloneStruct(copy.GetPayload()),
		CallerKind:    runtimev1.CallerKind_CALLER_KIND_DESKTOP_CORE,
		CallerId:      "runtime.local_runtime.service",
		SurfaceId:     "runtime.local_runtime",
		Capability:    "runtime.local_runtime.audit.append",
		PrincipalId:   "runtime.local_runtime",
		PrincipalType: "runtime_service",
	})
}

func matchesLocalAuditFilter(event *runtimev1.LocalAuditEvent, req *runtimev1.ListLocalAuditsRequest, eventTypes map[string]bool) bool {
	if event == nil {
		return false
	}
	if len(eventTypes) > 0 && !eventTypes[event.GetEventType()] {
		return false
	}
	if source := strings.TrimSpace(req.GetSource()); source != "" && event.GetSource() != source {
		return false
	}
	if modality := strings.TrimSpace(req.GetModality()); modality != "" && event.GetModality() != modality {
		return false
	}
	if localModelID := strings.TrimSpace(req.GetLocalModelId()); localModelID != "" && event.GetLocalModelId() != localModelID {
		return false
	}
	if reasonCode := strings.TrimSpace(req.GetReasonCode()); reasonCode != "" && event.GetReasonCode() != reasonCode {
		return false
	}
	if modID := strings.TrimSpace(req.GetModId()); modID != "" {
		payload := structToMap(event.GetPayload())
		if payloadModID := strings.TrimSpace(fmt.Sprintf("%v", payload["modId"])); payloadModID != modID {
			return false
		}
	}
	if tr := req.GetTimeRange(); tr != nil {
		from := strings.TrimSpace(tr.GetFrom())
		if from != "" && event.GetOccurredAt() < from {
			return false
		}
		to := strings.TrimSpace(tr.GetTo())
		if to != "" && event.GetOccurredAt() > to {
			return false
		}
	}
	return true
}

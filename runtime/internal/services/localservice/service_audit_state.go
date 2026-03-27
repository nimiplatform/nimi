package localservice

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/types/known/timestamppb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/pagination"
	"github.com/oklog/ulid/v2"
)

func (s *Service) ListLocalAudits(_ context.Context, req *runtimev1.ListLocalAuditsRequest) (*runtimev1.ListLocalAuditsResponse, error) {
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

	filtered := make([]*runtimev1.LocalAuditEvent, 0, len(source))
	for _, event := range source {
		if !matchesLocalAuditFilter(event, req, eventTypes) {
			continue
		}
		filtered = append(filtered, event)
	}
	sort.Slice(filtered, func(i, j int) bool {
		if filtered[i].GetOccurredAt() == filtered[j].GetOccurredAt() {
			return filtered[i].GetId() > filtered[j].GetId()
		}
		return filtered[i].GetOccurredAt() > filtered[j].GetOccurredAt()
	})

	pageSize := int(req.GetPageSize())
	if pageSize <= 0 {
		pageSize = 50
	}
	if pageSize > 200 {
		pageSize = 200
	}

	filterDigest := localAuditsFilterDigest(req)
	start, end, next, err := resolvePageBounds(req.GetPageToken(), filterDigest, int32(pageSize), 50, 200, len(filtered))
	if err != nil {
		return nil, err
	}
	return &runtimev1.ListLocalAuditsResponse{
		Events:        filtered[start:end],
		NextPageToken: next,
	}, nil
}

func localAuditsFilterDigest(req *runtimev1.ListLocalAuditsRequest) string {
	timeRangeFrom := ""
	timeRangeTo := ""
	if tr := req.GetTimeRange(); tr != nil {
		timeRangeFrom = strings.TrimSpace(tr.GetFrom())
		timeRangeTo = strings.TrimSpace(tr.GetTo())
	}
	return pagination.FilterDigest(
		strings.TrimSpace(req.GetEventType()),
		strings.Join(req.GetEventTypes(), ","),
		strings.TrimSpace(req.GetSource()),
		strings.TrimSpace(req.GetModality()),
		strings.TrimSpace(req.GetLocalModelId()),
		strings.TrimSpace(req.GetModId()),
		strings.TrimSpace(req.GetReasonCode()),
		strings.TrimSpace(req.GetAppId()),
		strings.TrimSpace(req.GetSubjectUserId()),
		timeRangeFrom,
		timeRangeTo,
	)
}

func (s *Service) AppendInferenceAudit(ctx context.Context, req *runtimev1.AppendInferenceAuditRequest) (*runtimev1.Ack, error) {
	traceID, appID, domain, operation, subjectUserID := localAuditContextEnvelope(
		ctx,
		"append_inference_audit",
		localAuditDomain,
	)
	event := &runtimev1.LocalAuditEvent{
		Id:            "audit_" + ulid.Make().String(),
		EventType:     boundedLocalAuditField(req.GetEventType()),
		OccurredAt:    nowISO(),
		Source:        boundedLocalAuditField(req.GetSource()),
		Modality:      boundedLocalAuditField(req.GetModality()),
		ReasonCode:    boundedLocalAuditField(req.GetReasonCode()),
		Detail:        boundedLocalAuditField(req.GetDetail()),
		ModelId:       boundedLocalAuditField(req.GetModel()),
		LocalModelId:  boundedLocalAuditField(req.GetLocalModelId()),
		Payload:       mergeInferencePayload(req),
		TraceId:       boundedLocalAuditField(traceID),
		AppId:         boundedLocalAuditField(appID),
		Domain:        boundedLocalAuditField(domain),
		Operation:     boundedLocalAuditField(operation),
		SubjectUserId: boundedLocalAuditField(subjectUserID),
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

func (s *Service) AppendRuntimeAudit(ctx context.Context, req *runtimev1.AppendRuntimeAuditRequest) (*runtimev1.Ack, error) {
	traceID, appID, domain, operation, subjectUserID := localAuditContextEnvelope(
		ctx,
		"append_runtime_audit",
		localAuditDomain,
	)
	event := &runtimev1.LocalAuditEvent{
		Id:            "audit_" + ulid.Make().String(),
		EventType:     defaultString(boundedLocalAuditField(req.GetEventType()), "runtime_event"),
		OccurredAt:    nowISO(),
		Source:        "local",
		ReasonCode:    "",
		Detail:        "",
		ModelId:       boundedLocalAuditField(req.GetModelId()),
		LocalModelId:  boundedLocalAuditField(req.GetLocalModelId()),
		Payload:       cloneStruct(req.GetPayload()),
		TraceId:       boundedLocalAuditField(traceID),
		AppId:         boundedLocalAuditField(appID),
		Domain:        boundedLocalAuditField(domain),
		Operation:     boundedLocalAuditField(operation),
		SubjectUserId: boundedLocalAuditField(subjectUserID),
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
	eventCopy := cloneLocalAuditEvent(event)
	if eventCopy.GetId() == "" {
		eventCopy.Id = "audit_" + ulid.Make().String()
	}
	if eventCopy.GetOccurredAt() == "" {
		eventCopy.OccurredAt = nowISO()
	}
	if strings.TrimSpace(eventCopy.GetTraceId()) == "" {
		eventCopy.TraceId = ulid.Make().String()
	}
	if strings.TrimSpace(eventCopy.GetDomain()) == "" {
		eventCopy.Domain = localAuditDomain
	}
	if strings.TrimSpace(eventCopy.GetOperation()) == "" {
		eventCopy.Operation = strings.TrimSpace(eventCopy.GetEventType())
	}
	if strings.TrimSpace(eventCopy.GetOperation()) == "" {
		eventCopy.Operation = "local_runtime_event"
	}
	s.audits = append([]*runtimev1.LocalAuditEvent{eventCopy}, s.audits...)
	capacity := s.effectiveLocalAuditCapacity()
	if len(s.audits) > capacity {
		s.audits = append([]*runtimev1.LocalAuditEvent(nil), s.audits[:capacity]...)
	}
	s.persistStateLocked()
	if s.auditStore == nil {
		return
	}

	reasonCode := runtimev1.ReasonCode_ACTION_EXECUTED
	if raw := strings.TrimSpace(eventCopy.GetReasonCode()); raw != "" {
		if parsed, ok := runtimev1.ReasonCode_value[raw]; ok {
			reasonCode = runtimev1.ReasonCode(parsed)
		}
	}
	s.auditStore.AppendEvent(&runtimev1.AuditEventRecord{
		AuditId:       eventCopy.GetId(),
		AppId:         defaultString(strings.TrimSpace(eventCopy.GetAppId()), "nimi.desktop"),
		SubjectUserId: strings.TrimSpace(eventCopy.GetSubjectUserId()),
		Domain:        defaultString(strings.TrimSpace(eventCopy.GetDomain()), localAuditDomain),
		Operation:     defaultString(strings.TrimSpace(eventCopy.GetOperation()), strings.TrimSpace(eventCopy.GetEventType())),
		ReasonCode:    reasonCode,
		TraceId:       defaultString(strings.TrimSpace(eventCopy.GetTraceId()), ulid.Make().String()),
		Timestamp:     timestamppb.New(time.Now().UTC()),
		Payload:       cloneStruct(eventCopy.GetPayload()),
		CallerKind:    runtimev1.CallerKind_CALLER_KIND_DESKTOP_CORE,
		CallerId:      "runtime.local_runtime.service",
		SurfaceId:     "runtime.local_runtime",
		Capability:    "runtime.local_runtime.audit.append",
		PrincipalId:   "runtime.local_runtime",
		PrincipalType: "runtime_service",
	})
}

const localAuditFieldMaxLen = 1024

func boundedLocalAuditField(value string) string {
	trimmed := strings.TrimSpace(value)
	if len(trimmed) <= localAuditFieldMaxLen {
		return trimmed
	}
	return trimmed[:localAuditFieldMaxLen]
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
	if appID := strings.TrimSpace(req.GetAppId()); appID != "" && event.GetAppId() != appID {
		return false
	}
	if subjectUserID := strings.TrimSpace(req.GetSubjectUserId()); subjectUserID != "" && event.GetSubjectUserId() != subjectUserID {
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

func localAuditContextEnvelope(
	ctx context.Context,
	defaultOperation string,
	defaultDomain string,
) (traceID string, appID string, domain string, operation string, subjectUserID string) {
	md, _ := metadata.FromIncomingContext(ctx)
	traceID = firstMetadataValue(md, "x-nimi-trace-id")
	if traceID == "" {
		traceID = ulid.Make().String()
	}
	appID = firstMetadataValue(md, "x-nimi-app-id")
	domain = firstMetadataValue(md, "x-nimi-domain")
	if domain == "" {
		domain = defaultDomain
	}
	operation = firstMetadataValue(md, "x-nimi-operation")
	if operation == "" {
		operation = defaultOperation
	}
	if identity := authn.IdentityFromContext(ctx); identity != nil {
		subjectUserID = strings.TrimSpace(identity.SubjectUserID)
	}
	if subjectUserID == "" {
		subjectUserID = firstMetadataValue(md, "x-nimi-subject-user-id")
	}
	return traceID, appID, domain, operation, subjectUserID
}

func firstMetadataValue(md metadata.MD, key string) string {
	if md == nil {
		return ""
	}
	values := md.Get(key)
	if len(values) == 0 {
		return ""
	}
	return strings.TrimSpace(values[0])
}

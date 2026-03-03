package localruntime

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
	legacyLimit := int(req.GetLimit())
	if pageSize <= 0 {
		if legacyLimit > 0 {
			pageSize = legacyLimit
		} else {
			pageSize = 50
		}
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
		localRuntimeAuditDomain,
	)
	event := &runtimev1.LocalAuditEvent{
		Id:            "audit_" + ulid.Make().String(),
		EventType:     strings.TrimSpace(req.GetEventType()),
		OccurredAt:    nowISO(),
		Source:        strings.TrimSpace(req.GetSource()),
		Modality:      strings.TrimSpace(req.GetModality()),
		ReasonCode:    strings.TrimSpace(req.GetReasonCode()),
		Detail:        strings.TrimSpace(req.GetDetail()),
		ModelId:       strings.TrimSpace(req.GetModel()),
		LocalModelId:  strings.TrimSpace(req.GetLocalModelId()),
		Payload:       mergeInferencePayload(req),
		TraceId:       traceID,
		AppId:         appID,
		Domain:        domain,
		Operation:     operation,
		SubjectUserId: subjectUserID,
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
		localRuntimeAuditDomain,
	)
	event := &runtimev1.LocalAuditEvent{
		Id:            "audit_" + ulid.Make().String(),
		EventType:     defaultString(strings.TrimSpace(req.GetEventType()), "runtime_event"),
		OccurredAt:    nowISO(),
		Source:        "local-runtime",
		ReasonCode:    "",
		Detail:        "",
		ModelId:       strings.TrimSpace(req.GetModelId()),
		LocalModelId:  strings.TrimSpace(req.GetLocalModelId()),
		Payload:       cloneStruct(req.GetPayload()),
		TraceId:       traceID,
		AppId:         appID,
		Domain:        domain,
		Operation:     operation,
		SubjectUserId: subjectUserID,
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
	if strings.TrimSpace(copy.GetTraceId()) == "" {
		copy.TraceId = ulid.Make().String()
	}
	if strings.TrimSpace(copy.GetDomain()) == "" {
		copy.Domain = localRuntimeAuditDomain
	}
	if strings.TrimSpace(copy.GetOperation()) == "" {
		copy.Operation = strings.TrimSpace(copy.GetEventType())
	}
	if strings.TrimSpace(copy.GetOperation()) == "" {
		copy.Operation = "local_runtime_event"
	}
	s.audits = append([]*runtimev1.LocalAuditEvent{copy}, s.audits...)
	capacity := s.effectiveLocalAuditCapacity()
	if len(s.audits) > capacity {
		s.audits = append([]*runtimev1.LocalAuditEvent(nil), s.audits[:capacity]...)
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
		AppId:         defaultString(strings.TrimSpace(copy.GetAppId()), "nimi.desktop"),
		SubjectUserId: strings.TrimSpace(copy.GetSubjectUserId()),
		Domain:        defaultString(strings.TrimSpace(copy.GetDomain()), localRuntimeAuditDomain),
		Operation:     defaultString(strings.TrimSpace(copy.GetOperation()), strings.TrimSpace(copy.GetEventType())),
		ReasonCode:    reasonCode,
		TraceId:       defaultString(strings.TrimSpace(copy.GetTraceId()), ulid.Make().String()),
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

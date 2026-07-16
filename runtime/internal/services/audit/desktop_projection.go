package audit

import (
	"context"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	desktopAuditMaxFilterBytes = 128
	desktopAuditMaxPageSize    = 100
	desktopAuditMaxWindow      = 7 * 24 * time.Hour
)

// ListDesktopAuditEvents is the exact K-AUDIT-024 Desktop projection. The
// protected transport interceptor performs the live process/session check;
// this method also rejects calls that did not arrive through that context.
func (s *Service) ListDesktopAuditEvents(ctx context.Context, req *runtimev1.ListDesktopAuditEventsRequest) (*runtimev1.ListDesktopAuditEventsResponse, error) {
	if _, ok := protectedlocal.DesktopConnectionFromContext(ctx); !ok {
		s.recordDesktopAuditProjectionRead(ctx, runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)
	}
	if err := validateDesktopAuditRequest(req); err != nil {
		s.recordDesktopAuditProjectionRead(ctx, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		return nil, err
	}
	if s.store == nil {
		return nil, status.Error(codes.Unavailable, "canonical audit store unavailable")
	}

	resp, err := s.store.ListDesktopEvents(req)
	if err != nil {
		reasonCode := runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID
		if strings.TrimSpace(req.GetPageToken()) != "" {
			reasonCode = runtimev1.ReasonCode_PAGE_TOKEN_INVALID
		}
		s.recordDesktopAuditProjectionRead(ctx, reasonCode)
		return nil, err
	}
	s.recordDesktopAuditProjectionRead(ctx, runtimev1.ReasonCode_ACTION_EXECUTED)
	return resp, nil
}

func validateDesktopAuditRequest(req *runtimev1.ListDesktopAuditEventsRequest) error {
	if req == nil || req.GetFromTime() == nil || req.GetToTime() == nil {
		return invalidDesktopAuditRequest()
	}
	if err := req.GetFromTime().CheckValid(); err != nil {
		return invalidDesktopAuditRequest()
	}
	if err := req.GetToTime().CheckValid(); err != nil {
		return invalidDesktopAuditRequest()
	}
	fromTime := req.GetFromTime().AsTime()
	toTime := req.GetToTime().AsTime()
	if fromTime.After(toTime) || toTime.Sub(fromTime) > desktopAuditMaxWindow {
		return invalidDesktopAuditRequest()
	}
	if req.GetPageSize() < 0 || req.GetPageSize() > desktopAuditMaxPageSize {
		return invalidDesktopAuditRequest()
	}
	if _, ok := runtimev1.ReasonCode_name[int32(req.GetReasonCode())]; !ok {
		return invalidDesktopAuditRequest()
	}
	if _, ok := runtimev1.CallerKind_name[int32(req.GetCallerKind())]; !ok {
		return invalidDesktopAuditRequest()
	}
	for _, value := range []string{
		req.GetTraceId(),
		req.GetRequestId(),
		req.GetAppId(),
		req.GetDomain(),
		req.GetOperation(),
	} {
		if !validDesktopAuditFilter(value) {
			return invalidDesktopAuditRequest()
		}
	}
	return nil
}

func validDesktopAuditFilter(value string) bool {
	if value == "" {
		return true
	}
	if len(value) > desktopAuditMaxFilterBytes || strings.TrimSpace(value) != value {
		return false
	}
	for index := 0; index < len(value); index++ {
		char := value[index]
		if (char >= 'a' && char <= 'z') ||
			(char >= 'A' && char <= 'Z') ||
			(char >= '0' && char <= '9') ||
			strings.ContainsRune("._:/-", rune(char)) {
			continue
		}
		return false
	}
	return true
}

func invalidDesktopAuditRequest() error {
	return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
}

func (s *Service) recordDesktopAuditProjectionRead(ctx context.Context, reasonCode runtimev1.ReasonCode) {
	if s.store == nil {
		return
	}
	traceID := strings.TrimSpace(envelope.ParseTraceIDFromContext(ctx))
	if traceID == "" {
		traceID = ulid.Make().String()
	}
	s.store.AppendEvent(&runtimev1.AuditEventRecord{
		RequestId:  traceID,
		AppId:      "nimi.desktop",
		Domain:     "runtime.audit",
		Operation:  "desktop_projection.read",
		ReasonCode: reasonCode,
		TraceId:    traceID,
		Timestamp:  timestamppb.New(time.Now().UTC()),
		CallerKind: runtimev1.CallerKind_CALLER_KIND_DESKTOP_CORE,
		SurfaceId:  "runtime.activity",
		Capability: "runtime.audit.desktop.read",
	})
}

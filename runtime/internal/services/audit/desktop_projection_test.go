package audit

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/health"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/providerhealth"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func newDesktopAuditProjectionService(store *auditlog.Store) *Service {
	return New(
		health.NewState(),
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		providerhealth.New(),
		store,
	)
}

func protectedDesktopAuditContext(traceID string) context.Context {
	ctx := protectedlocal.ContextWithDesktopConnection(context.Background(), &protectedlocal.Connection{})
	return metadata.NewIncomingContext(ctx, metadata.Pairs("x-nimi-trace-id", traceID))
}

func validDesktopAuditProjectionRequest(now time.Time) *runtimev1.ListDesktopAuditEventsRequest {
	return &runtimev1.ListDesktopAuditEventsRequest{
		FromTime: timestamppb.New(now.Add(-time.Hour)),
		ToTime:   timestamppb.New(now.Add(time.Hour)),
		PageSize: 50,
	}
}

func TestListDesktopAuditEventsRequiresProtectedDesktopOrigin(t *testing.T) {
	store := auditlog.New(10, 10)
	svc := newDesktopAuditProjectionService(store)
	_, err := svc.ListDesktopAuditEvents(context.Background(), validDesktopAuditProjectionRequest(time.Now().UTC()))
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("status = %v, want PermissionDenied: %v", status.Code(err), err)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH {
		t.Fatalf("reason = %v, ok=%v, want PROTECTED_ORIGIN_ROLE_MISMATCH", reason, ok)
	}
}

func TestListDesktopAuditEventsRejectsUnboundedFilters(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	tests := []struct {
		name   string
		mutate func(*runtimev1.ListDesktopAuditEventsRequest)
	}{
		{name: "missing from time", mutate: func(req *runtimev1.ListDesktopAuditEventsRequest) { req.FromTime = nil }},
		{name: "missing to time", mutate: func(req *runtimev1.ListDesktopAuditEventsRequest) { req.ToTime = nil }},
		{name: "reversed window", mutate: func(req *runtimev1.ListDesktopAuditEventsRequest) {
			req.FromTime, req.ToTime = req.ToTime, req.FromTime
		}},
		{name: "window over seven days", mutate: func(req *runtimev1.ListDesktopAuditEventsRequest) {
			req.FromTime = timestamppb.New(now.Add(-8 * 24 * time.Hour))
		}},
		{name: "page over limit", mutate: func(req *runtimev1.ListDesktopAuditEventsRequest) { req.PageSize = 101 }},
		{name: "negative page", mutate: func(req *runtimev1.ListDesktopAuditEventsRequest) { req.PageSize = -1 }},
		{name: "arbitrary text filter", mutate: func(req *runtimev1.ListDesktopAuditEventsRequest) { req.Domain = "runtime.agent OR secret" }},
		{name: "reserved caller kind", mutate: func(req *runtimev1.ListDesktopAuditEventsRequest) { req.CallerKind = runtimev1.CallerKind(2) }},
		{name: "unknown reason", mutate: func(req *runtimev1.ListDesktopAuditEventsRequest) { req.ReasonCode = runtimev1.ReasonCode(9999) }},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := validDesktopAuditProjectionRequest(now)
			tc.mutate(req)
			_, err := newDesktopAuditProjectionService(auditlog.New(10, 10)).ListDesktopAuditEvents(
				protectedDesktopAuditContext("trace-invalid"),
				req,
			)
			if status.Code(err) != codes.InvalidArgument {
				t.Fatalf("status = %v, want InvalidArgument: %v", status.Code(err), err)
			}
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID {
				t.Fatalf("reason = %v, ok=%v, want PROTOCOL_ENVELOPE_INVALID", reason, ok)
			}
		})
	}
}

func TestListDesktopAuditEventsProjectsCanonicalStoreAndAuditsRead(t *testing.T) {
	store := auditlog.New(20, 10)
	now := time.Now().UTC().Truncate(time.Second)
	payload, err := structpb.NewStruct(map[string]any{"refresh_token": "not-for-desktop"})
	if err != nil {
		t.Fatalf("NewStruct: %v", err)
	}
	store.AppendEvent(&runtimev1.AuditEventRecord{
		AuditId:       "audit-source",
		RequestId:     "request-source",
		AppId:         "nimi.zhiyu",
		SubjectUserId: "user-sensitive",
		Domain:        "runtime.agent",
		Operation:     "inventory.list",
		ReasonCode:    runtimev1.ReasonCode_ACTION_EXECUTED,
		TraceId:       "trace-source",
		Timestamp:     timestamppb.New(now),
		Payload:       payload,
		CallerKind:    runtimev1.CallerKind_CALLER_KIND_THIRD_PARTY_APP,
		CallerId:      "caller-sensitive",
		PrincipalId:   "principal-sensitive",
		TokenId:       "token-sensitive",
		ConsentId:     "consent-sensitive",
	})

	req := validDesktopAuditProjectionRequest(now)
	req.TraceId = "trace-source"
	resp, err := newDesktopAuditProjectionService(store).ListDesktopAuditEvents(
		protectedDesktopAuditContext("trace-read"),
		req,
	)
	if err != nil {
		t.Fatalf("ListDesktopAuditEvents: %v", err)
	}
	if len(resp.GetEvents()) != 1 {
		t.Fatalf("event count = %d, want 1", len(resp.GetEvents()))
	}
	if got := resp.GetEvents()[0]; got.GetAuditId() != "audit-source" || got.GetTraceId() != "trace-source" {
		t.Fatalf("unexpected projection: %+v", got)
	}

	raw, err := store.ListEvents(&runtimev1.ListAuditEventsRequest{Domain: "runtime.audit"})
	if err != nil {
		t.Fatalf("ListEvents read audit: %v", err)
	}
	if len(raw.GetEvents()) != 1 {
		t.Fatalf("read audit count = %d, want 1", len(raw.GetEvents()))
	}
	readEvent := raw.GetEvents()[0]
	if readEvent.GetTraceId() != "trace-read" || readEvent.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("unexpected read audit event: %+v", readEvent)
	}
	if readEvent.GetPayload() != nil || readEvent.GetSubjectUserId() != "" || readEvent.GetCallerId() != "" || readEvent.GetTokenId() != "" {
		t.Fatalf("read audit copied forbidden query/result material: %+v", readEvent)
	}
}

func TestListDesktopAuditEventsFailsClosedWithoutCanonicalStore(t *testing.T) {
	_, err := newDesktopAuditProjectionService(nil).ListDesktopAuditEvents(
		protectedDesktopAuditContext("trace-no-store"),
		validDesktopAuditProjectionRequest(time.Now().UTC()),
	)
	if status.Code(err) != codes.Unavailable {
		t.Fatalf("status = %v, want Unavailable: %v", status.Code(err), err)
	}
}

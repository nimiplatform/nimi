package auditlog

import (
	"reflect"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestListDesktopEventsAppliesExactFiltersAndWireWhitelist(t *testing.T) {
	store := New(10, 10)
	now := time.Now().UTC().Truncate(time.Second)
	payload, err := structpb.NewStruct(map[string]any{"access_token": "secret-value"})
	if err != nil {
		t.Fatalf("NewStruct: %v", err)
	}
	store.AppendEvent(&runtimev1.AuditEventRecord{
		AuditId:               "audit-1",
		RequestId:             "request-1",
		AppId:                 "nimi.desktop",
		SubjectUserId:         "user-secret",
		Domain:                "runtime.agent",
		Operation:             "inventory.list",
		ReasonCode:            runtimev1.ReasonCode_ACTION_EXECUTED,
		TraceId:               "trace-1",
		Timestamp:             timestamppb.New(now),
		Payload:               payload,
		CallerKind:            runtimev1.CallerKind_CALLER_KIND_DESKTOP_CORE,
		CallerId:              "caller-secret",
		SurfaceId:             "surface-secret",
		PrincipalId:           "principal-secret",
		PrincipalType:         "principal-type-secret",
		ExternalPrincipalType: "external-secret",
		Capability:            "capability-secret",
		TokenId:               "token-secret",
		ParentTokenId:         "parent-token-secret",
		ConsentId:             "consent-secret",
		ConsentVersion:        "consent-version-secret",
		PolicyVersion:         "policy-secret",
		ResourceSelectorHash:  "resource-secret",
		ScopeCatalogVersion:   "scope-secret",
	})

	resp, err := store.ListDesktopEvents(&runtimev1.ListDesktopAuditEventsRequest{
		TraceId:    "trace-1",
		RequestId:  "request-1",
		AppId:      "nimi.desktop",
		Domain:     "runtime.agent",
		Operation:  "inventory.list",
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		CallerKind: runtimev1.CallerKind_CALLER_KIND_DESKTOP_CORE,
		FromTime:   timestamppb.New(now.Add(-time.Minute)),
		ToTime:     timestamppb.New(now.Add(time.Minute)),
		PageSize:   10,
	})
	if err != nil {
		t.Fatalf("ListDesktopEvents: %v", err)
	}
	if len(resp.GetEvents()) != 1 {
		t.Fatalf("event count = %d, want 1", len(resp.GetEvents()))
	}
	event := resp.GetEvents()[0]
	if event.GetAuditId() != "audit-1" || event.GetTraceId() != "trace-1" || event.GetRequestId() != "request-1" {
		t.Fatalf("unexpected projection identifiers: %+v", event)
	}

	fields := event.ProtoReflect().Descriptor().Fields()
	fieldNames := make([]string, 0, fields.Len())
	for index := 0; index < fields.Len(); index++ {
		fieldNames = append(fieldNames, string(fields.Get(index).Name()))
	}
	wantFields := []string{
		"audit_id",
		"request_id",
		"app_id",
		"domain",
		"operation",
		"reason_code",
		"trace_id",
		"timestamp",
		"caller_kind",
	}
	if !reflect.DeepEqual(fieldNames, wantFields) {
		t.Fatalf("DesktopAuditEventProjection fields = %v, want %v", fieldNames, wantFields)
	}
}

func TestListDesktopEventsBindsPageTokenToCompleteFilter(t *testing.T) {
	store := New(10, 10)
	now := time.Now().UTC().Truncate(time.Second)
	for index := 0; index < 2; index++ {
		store.AppendEvent(&runtimev1.AuditEventRecord{
			AuditId:    "audit-" + string(rune('a'+index)),
			AppId:      "nimi.desktop",
			Domain:     "runtime.agent",
			Operation:  "inventory.list",
			ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
			TraceId:    "trace-" + string(rune('a'+index)),
			Timestamp:  timestamppb.New(now.Add(time.Duration(index) * time.Second)),
		})
	}
	request := &runtimev1.ListDesktopAuditEventsRequest{
		Domain:   "runtime.agent",
		FromTime: timestamppb.New(now.Add(-time.Minute)),
		ToTime:   timestamppb.New(now.Add(time.Minute)),
		PageSize: 1,
	}
	first, err := store.ListDesktopEvents(request)
	if err != nil {
		t.Fatalf("first page: %v", err)
	}
	if first.GetNextPageToken() == "" {
		t.Fatal("expected next page token")
	}

	_, err = store.ListDesktopEvents(&runtimev1.ListDesktopAuditEventsRequest{
		Domain:    "runtime.auth",
		FromTime:  request.GetFromTime(),
		ToTime:    request.GetToTime(),
		PageSize:  1,
		PageToken: first.GetNextPageToken(),
	})
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_PAGE_TOKEN_INVALID {
		t.Fatalf("changed filter reason = %v, ok=%v, err=%v", reason, ok, err)
	}
}

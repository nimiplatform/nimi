package auditlog

import (
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestStoreListEventsAndUsage(t *testing.T) {
	store := New(128, 128)
	now := time.Now().UTC().Truncate(time.Minute).Add(5 * time.Second)

	store.AppendEvent(&runtimev1.AuditEventRecord{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		Domain:        "runtime.ai",
		Operation:     "generate",
		ReasonCode:    runtimev1.ReasonCode_ACTION_EXECUTED,
		Timestamp:     timestamppb.New(now),
	})
	store.AppendEvent(&runtimev1.AuditEventRecord{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		Domain:        "runtime.ai",
		Operation:     "embed",
		ReasonCode:    runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT,
		Timestamp:     timestamppb.New(now.Add(time.Second)),
	})

	eventResp := store.ListEvents(&runtimev1.ListAuditEventsRequest{
		AppId:    "nimi.desktop",
		Domain:   "runtime.ai",
		PageSize: 10,
	})
	if got := len(eventResp.GetEvents()); got != 2 {
		t.Fatalf("expected 2 events, got %d", got)
	}

	store.RecordUsage(UsageInput{
		Timestamp:     now,
		AppID:         "nimi.desktop",
		SubjectUserID: "user-001",
		CallerKind:    runtimev1.CallerKind_CALLER_KIND_DESKTOP_CORE,
		CallerID:      "desktop",
		Capability:    "runtime.ai.generate",
		ModelID:       "qwen2.5",
		Success:       true,
		Usage: &runtimev1.UsageStats{
			InputTokens:  10,
			OutputTokens: 20,
			ComputeMs:    30,
		},
	})
	store.RecordUsage(UsageInput{
		Timestamp:     now.Add(10 * time.Second),
		AppID:         "nimi.desktop",
		SubjectUserID: "user-001",
		CallerKind:    runtimev1.CallerKind_CALLER_KIND_DESKTOP_CORE,
		CallerID:      "desktop",
		Capability:    "runtime.ai.generate",
		ModelID:       "qwen2.5",
		Success:       false,
		Usage: &runtimev1.UsageStats{
			InputTokens:  5,
			OutputTokens: 1,
			ComputeMs:    6,
		},
	})

	usageResp := store.ListUsage(&runtimev1.ListUsageStatsRequest{
		AppId:      "nimi.desktop",
		Capability: "runtime.ai.generate",
		Window:     runtimev1.UsageWindow_USAGE_WINDOW_MINUTE,
		PageSize:   10,
	})
	if got := len(usageResp.GetRecords()); got != 1 {
		t.Fatalf("expected 1 usage record, got %d", got)
	}
	record := usageResp.GetRecords()[0]
	if record.GetRequestCount() != 2 {
		t.Fatalf("request count mismatch: %d", record.GetRequestCount())
	}
	if record.GetSuccessCount() != 1 || record.GetErrorCount() != 1 {
		t.Fatalf("success/error mismatch: %d/%d", record.GetSuccessCount(), record.GetErrorCount())
	}
	if record.GetInputTokens() != 15 || record.GetOutputTokens() != 21 {
		t.Fatalf("token aggregation mismatch: in=%d out=%d", record.GetInputTokens(), record.GetOutputTokens())
	}
}

func TestStoreListUsageByCallerKindAndCapability(t *testing.T) {
	store := New(128, 128)
	now := time.Now().UTC().Truncate(time.Minute)

	store.RecordUsage(UsageInput{
		Timestamp:     now,
		AppID:         "nimi.desktop",
		SubjectUserID: "user-001",
		CallerKind:    runtimev1.CallerKind_CALLER_KIND_DESKTOP_CORE,
		CallerID:      "desktop-core",
		Capability:    "runtime.ai.generate",
		Success:       true,
	})
	store.RecordUsage(UsageInput{
		Timestamp:     now,
		AppID:         "nimi.desktop",
		SubjectUserID: "user-001",
		CallerKind:    runtimev1.CallerKind_CALLER_KIND_DESKTOP_MOD,
		CallerID:      "mod-local-chat",
		Capability:    "runtime.ai.generate",
		Success:       true,
	})
	store.RecordUsage(UsageInput{
		Timestamp:     now,
		AppID:         "nimi.desktop",
		SubjectUserID: "user-001",
		CallerKind:    runtimev1.CallerKind_CALLER_KIND_THIRD_PARTY_SERVICE,
		CallerID:      "svc-novelizer",
		Capability:    "runtime.workflow.submit",
		Success:       true,
	})

	desktopCore := store.ListUsage(&runtimev1.ListUsageStatsRequest{
		AppId:      "nimi.desktop",
		CallerKind: runtimev1.CallerKind_CALLER_KIND_DESKTOP_CORE,
		Window:     runtimev1.UsageWindow_USAGE_WINDOW_MINUTE,
	})
	if len(desktopCore.GetRecords()) != 1 {
		t.Fatalf("expected 1 desktop-core record, got=%d", len(desktopCore.GetRecords()))
	}
	if desktopCore.GetRecords()[0].GetCallerId() != "desktop-core" {
		t.Fatalf("unexpected caller id: %s", desktopCore.GetRecords()[0].GetCallerId())
	}

	aiCapability := store.ListUsage(&runtimev1.ListUsageStatsRequest{
		AppId:      "nimi.desktop",
		Capability: "runtime.ai.generate",
		Window:     runtimev1.UsageWindow_USAGE_WINDOW_MINUTE,
	})
	if len(aiCapability.GetRecords()) != 2 {
		t.Fatalf("expected 2 runtime.ai.generate records, got=%d", len(aiCapability.GetRecords()))
	}
}

func TestListEventsPageSizeDefault50(t *testing.T) {
	store := New(500, 100)
	for i := 0; i < 60; i++ {
		payload, _ := structpb.NewStruct(map[string]any{"i": float64(i)})
		store.AppendEvent(&runtimev1.AuditEventRecord{
			Domain:    "test",
			Operation: "op",
			Payload:   payload,
		})
	}

	resp := store.ListEvents(&runtimev1.ListAuditEventsRequest{})
	if len(resp.Events) != 50 {
		t.Fatalf("default page size should be 50, got %d", len(resp.Events))
	}
	if resp.NextPageToken == "" {
		t.Fatal("expected next page token")
	}
}

func TestListEventsPageSizeMaxCap200(t *testing.T) {
	store := New(500, 100)
	for i := 0; i < 300; i++ {
		payload, _ := structpb.NewStruct(map[string]any{"i": float64(i)})
		store.AppendEvent(&runtimev1.AuditEventRecord{
			Domain:    "test",
			Operation: "op",
			Payload:   payload,
		})
	}

	// Request 500 — should be capped to 200 (K-PAGE-005).
	resp := store.ListEvents(&runtimev1.ListAuditEventsRequest{
		PageSize: 500,
	})
	if len(resp.Events) != 200 {
		t.Fatalf("page size should be capped at 200, got %d", len(resp.Events))
	}
}

func TestListEventsPageSizeExact200(t *testing.T) {
	store := New(500, 100)
	for i := 0; i < 300; i++ {
		payload, _ := structpb.NewStruct(map[string]any{"i": float64(i)})
		store.AppendEvent(&runtimev1.AuditEventRecord{
			Domain:    "test",
			Operation: "op",
			Payload:   payload,
		})
	}

	resp := store.ListEvents(&runtimev1.ListAuditEventsRequest{
		PageSize: 200,
	})
	if len(resp.Events) != 200 {
		t.Fatalf("page size 200 should be allowed, got %d", len(resp.Events))
	}
}

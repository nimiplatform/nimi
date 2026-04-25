package auditlog

import (
	"strconv"
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

	eventResp, err := store.ListEvents(&runtimev1.ListAuditEventsRequest{
		AppId:    "nimi.desktop",
		Domain:   "runtime.ai",
		PageSize: 10,
	})
	if err != nil {
		t.Fatalf("ListEvents: %v", err)
	}
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

	usageResp, err := store.ListUsage(&runtimev1.ListUsageStatsRequest{
		AppId:      "nimi.desktop",
		Capability: "runtime.ai.generate",
		Window:     runtimev1.UsageWindow_USAGE_WINDOW_MINUTE,
		PageSize:   10,
	})
	if err != nil {
		t.Fatalf("ListUsage: %v", err)
	}
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
		CallerID:      "mod-test-ai",
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

	desktopCore, err := store.ListUsage(&runtimev1.ListUsageStatsRequest{
		AppId:      "nimi.desktop",
		CallerKind: runtimev1.CallerKind_CALLER_KIND_DESKTOP_CORE,
		Window:     runtimev1.UsageWindow_USAGE_WINDOW_MINUTE,
	})
	if err != nil {
		t.Fatalf("ListUsage(desktop-core): %v", err)
	}
	if len(desktopCore.GetRecords()) != 1 {
		t.Fatalf("expected 1 desktop-core record, got=%d", len(desktopCore.GetRecords()))
	}
	if desktopCore.GetRecords()[0].GetCallerId() != "desktop-core" {
		t.Fatalf("unexpected caller id: %s", desktopCore.GetRecords()[0].GetCallerId())
	}

	aiCapability, err := store.ListUsage(&runtimev1.ListUsageStatsRequest{
		AppId:      "nimi.desktop",
		Capability: "runtime.ai.generate",
		Window:     runtimev1.UsageWindow_USAGE_WINDOW_MINUTE,
	})
	if err != nil {
		t.Fatalf("ListUsage(capability): %v", err)
	}
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

	resp, err := store.ListEvents(&runtimev1.ListAuditEventsRequest{})
	if err != nil {
		t.Fatalf("ListEvents: %v", err)
	}
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
	resp, err := store.ListEvents(&runtimev1.ListAuditEventsRequest{
		PageSize: 500,
	})
	if err != nil {
		t.Fatalf("ListEvents: %v", err)
	}
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

	resp, err := store.ListEvents(&runtimev1.ListAuditEventsRequest{
		PageSize: 200,
	})
	if err != nil {
		t.Fatalf("ListEvents: %v", err)
	}
	if len(resp.Events) != 200 {
		t.Fatalf("page size 200 should be allowed, got %d", len(resp.Events))
	}
}

// TestAuditRetentionPolicyEnforced verifies K-AUDIT-020: the event ring
// buffer enforces capacity limits, evicting the oldest events when full.
func TestAuditRetentionPolicyEnforced(t *testing.T) {
	const bufSize = 5
	const totalEvents = 10
	store := New(bufSize, 100)

	// Insert 10 events with sequential operation names so we can identify them.
	now := time.Now().UTC()
	for i := 0; i < totalEvents; i++ {
		payload, _ := structpb.NewStruct(map[string]any{"seq": float64(i)})
		store.AppendEvent(&runtimev1.AuditEventRecord{
			Domain:    "retention",
			Operation: "op-" + strconv.Itoa(i),
			Timestamp: timestamppb.New(now.Add(time.Duration(i) * time.Second)),
			Payload:   payload,
		})
	}

	// Query all retained events (page size larger than buffer).
	resp, err := store.ListEvents(&runtimev1.ListAuditEventsRequest{
		Domain:   "retention",
		PageSize: 200,
	})
	if err != nil {
		t.Fatalf("ListEvents: %v", err)
	}
	if got := len(resp.Events); got != bufSize {
		t.Fatalf("expected %d retained events, got %d", bufSize, got)
	}

	// ListEvents returns newest-first; collect operations in insertion order.
	retained := make([]string, len(resp.Events))
	for i, event := range resp.Events {
		retained[len(resp.Events)-1-i] = event.GetOperation()
	}

	// Only the last 5 events (op-5 through op-9) should survive.
	for i, op := range retained {
		expected := "op-" + strconv.Itoa(bufSize+i)
		if op != expected {
			t.Errorf("retained[%d] = %q, want %q", i, op, expected)
		}
	}

	// Verify the oldest events (op-0 through op-4) are gone.
	for _, event := range resp.Events {
		seq := event.Payload.GetFields()["seq"].GetNumberValue()
		if seq < float64(bufSize) {
			t.Errorf("evicted event seq=%.0f should not be present", seq)
		}
	}
}

func TestAppendEventRingBufferWrapPreservesNewestEvents(t *testing.T) {
	store := New(3, 10)
	now := time.Now().UTC()
	for i := 0; i < 6; i++ {
		store.AppendEvent(&runtimev1.AuditEventRecord{
			Domain:    "wrap",
			Operation: "op-" + strconv.Itoa(i),
			Timestamp: timestamppb.New(now.Add(time.Duration(i) * time.Second)),
		})
	}

	resp, err := store.ListEvents(&runtimev1.ListAuditEventsRequest{
		Domain:   "wrap",
		PageSize: 10,
	})
	if err != nil {
		t.Fatalf("ListEvents: %v", err)
	}
	if len(resp.GetEvents()) != 3 {
		t.Fatalf("expected 3 retained events, got %d", len(resp.GetEvents()))
	}

	want := []string{"op-5", "op-4", "op-3"}
	for i, event := range resp.GetEvents() {
		if event.GetOperation() != want[i] {
			t.Fatalf("event[%d] = %q, want %q", i, event.GetOperation(), want[i])
		}
	}
}

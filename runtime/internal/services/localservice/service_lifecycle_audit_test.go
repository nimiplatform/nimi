package localservice

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"google.golang.org/grpc/metadata"
)

func TestAppendInferenceAuditBoundsFieldLengths(t *testing.T) {
	svc := newTestService(t)
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-trace-id", strings.Repeat("t", localAuditFieldMaxLen+10),
		"x-nimi-app-id", "app.test",
		"x-nimi-domain", "runtime.local_runtime",
	))
	_, err := svc.AppendInferenceAudit(ctx, &runtimev1.AppendInferenceAuditRequest{
		EventType:  strings.Repeat("e", localAuditFieldMaxLen+10),
		Detail:     strings.Repeat("d", localAuditFieldMaxLen+10),
		ReasonCode: strings.Repeat("r", localAuditFieldMaxLen+10),
	})
	if err != nil {
		t.Fatalf("AppendInferenceAudit: %v", err)
	}

	svc.mu.RLock()
	defer svc.mu.RUnlock()
	if len(svc.audits) == 0 {
		t.Fatal("expected audit event to be recorded")
	}
	event := svc.audits[0]
	if len(event.GetEventType()) != localAuditFieldMaxLen {
		t.Fatalf("event type should be truncated to %d, got %d", localAuditFieldMaxLen, len(event.GetEventType()))
	}
	if len(event.GetDetail()) != localAuditFieldMaxLen {
		t.Fatalf("detail should be truncated to %d, got %d", localAuditFieldMaxLen, len(event.GetDetail()))
	}
	if len(event.GetTraceId()) != localAuditFieldMaxLen {
		t.Fatalf("trace id should be truncated to %d, got %d", localAuditFieldMaxLen, len(event.GetTraceId()))
	}
}

func TestLocalAuditCapacityRespectedAcrossPersistAndRestore(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "local-state.json")
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	svc, err := New(logger, nil, statePath, 2)
	if err != nil {
		t.Fatalf("create service: %v", err)
	}
	defer func() { svc.Close() }()

	for i := 0; i < 5; i++ {
		if _, err := svc.AppendRuntimeAudit(context.Background(), &runtimev1.AppendRuntimeAuditRequest{
			EventType: fmt.Sprintf("evt-%d", i),
			ModelId:   fmt.Sprintf("local/model-%d", i),
			Payload:   localAuditReasonPayload(runtimev1.ReasonCode_ACTION_EXECUTED),
		}); err != nil {
			t.Fatalf("append runtime audit #%d: %v", i, err)
		}
	}

	current, err := svc.ListLocalAudits(context.Background(), &runtimev1.ListLocalAuditsRequest{PageSize: 10})
	if err != nil {
		t.Fatalf("list local audits before restart: %v", err)
	}
	if len(current.GetEvents()) != 2 {
		t.Fatalf("expected in-memory audit cap=2, got %d", len(current.GetEvents()))
	}
	if current.GetEvents()[0].GetEventType() != "evt-4" || current.GetEvents()[1].GetEventType() != "evt-3" {
		t.Fatalf("unexpected retained audit order before restart: %s, %s", current.GetEvents()[0].GetEventType(), current.GetEvents()[1].GetEventType())
	}

	restarted, err := New(logger, nil, statePath, 2)
	if err != nil {
		t.Fatalf("restart service: %v", err)
	}
	defer func() { restarted.Close() }()

	restored, err := restarted.ListLocalAudits(context.Background(), &runtimev1.ListLocalAuditsRequest{PageSize: 10})
	if err != nil {
		t.Fatalf("list local audits after restart: %v", err)
	}
	if len(restored.GetEvents()) != 2 {
		t.Fatalf("expected restored audit cap=2, got %d", len(restored.GetEvents()))
	}
	if restored.GetEvents()[0].GetEventType() != "evt-4" || restored.GetEvents()[1].GetEventType() != "evt-3" {
		t.Fatalf("unexpected retained audit order after restart: %s, %s", restored.GetEvents()[0].GetEventType(), restored.GetEvents()[1].GetEventType())
	}
}

func TestLocalAuditDoesNotReplicateIntoGlobalRuntimeAuditStore(t *testing.T) {
	globalAudit := auditlog.New(16, 16)
	statePath := filepath.Join(t.TempDir(), "local-state.json")
	svc, err := New(nil, globalAudit, statePath, 16)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(svc.Close)

	if _, err := svc.AppendRuntimeAudit(context.Background(), &runtimev1.AppendRuntimeAuditRequest{
		EventType: "local_runtime_event",
		ModelId:   "local/chat-default",
		Payload:   localAuditReasonPayload(runtimev1.ReasonCode_ACTION_EXECUTED),
	}); err != nil {
		t.Fatalf("append local runtime audit: %v", err)
	}
	localEvents, err := svc.ListLocalAudits(context.Background(), &runtimev1.ListLocalAuditsRequest{PageSize: 10})
	if err != nil {
		t.Fatalf("list local audits: %v", err)
	}
	if len(localEvents.GetEvents()) != 1 {
		t.Fatalf("expected local audit to be retained locally, got %d", len(localEvents.GetEvents()))
	}
	globalEvents, err := globalAudit.ListEvents(&runtimev1.ListAuditEventsRequest{PageSize: 10})
	if err != nil {
		t.Fatalf("list global audit events: %v", err)
	}
	if len(globalEvents.GetEvents()) != 0 {
		t.Fatalf("local audit must not replicate to global runtime audit store: %+v", globalEvents.GetEvents())
	}
}

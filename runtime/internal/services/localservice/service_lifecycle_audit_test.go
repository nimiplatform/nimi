package localservice

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"google.golang.org/grpc/metadata"
)

func TestLocalStateRestoresAfterRestart(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "local-state.json")
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	svc, err := New(logger, nil, statePath, 0)
	if err != nil {
		t.Fatalf("create service: %v", err)
	}
	installedModel := mustInstallAttachedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "local/persisted-model",
		capabilities: []string{"chat"},
		engine:       "llama",
		endpoint:     "http://127.0.0.1:1234/v1",
	})
	if _, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-persisted",
		Title:        "svc-persisted",
		Capabilities: []string{"chat"},
		LocalModelId: installedModel.GetLocalAssetId(),
	}); err != nil {
		t.Fatalf("install service: %v", err)
	}

	importRoot := t.TempDir()
	setLocalModelsPathForTest(t, svc, importRoot)
	manifestPath := filepath.Join(importRoot, "resolved", "nimi", "persisted-import", "asset.manifest.json")
	manifestRaw, _ := json.Marshal(map[string]any{
		"asset_id":                "local/persisted-import",
		"kind":                    "chat",
		"logical_model_id":        "nimi/persisted-import",
		"engine":                  "llama",
		"capabilities":            []string{"chat"},
		"endpoint":                "http://127.0.0.1:8091/v1",
		"local_invoke_profile_id": "profile-persisted",
	})
	if err := os.MkdirAll(filepath.Dir(manifestPath), 0o755); err != nil {
		t.Fatalf("create import manifest dir: %v", err)
	}
	if err := os.WriteFile(manifestPath, manifestRaw, 0o600); err != nil {
		t.Fatalf("write import manifest: %v", err)
	}
	if _, err := svc.ImportLocalAsset(context.Background(), &runtimev1.ImportLocalAssetRequest{
		ManifestPath: manifestPath,
	}); err != nil {
		t.Fatalf("import model: %v", err)
	}

	ctx := authn.WithIdentity(context.Background(), &authn.Identity{SubjectUserID: "user-persist"})
	ctx = metadata.NewIncomingContext(ctx, metadata.Pairs(
		"x-nimi-trace-id", "trace-persist",
		"x-nimi-app-id", "app.persist",
		"x-nimi-domain", "runtime.local_runtime",
	))
	if _, err := svc.AppendInferenceAudit(ctx, &runtimev1.AppendInferenceAuditRequest{
		EventType:  "persist_audit",
		Source:     "local",
		Model:      "local/persisted-model",
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED.String(),
	}); err != nil {
		t.Fatalf("append persisted audit: %v", err)
	}

	restarted, err := New(logger, nil, statePath, 0)
	if err != nil {
		t.Fatalf("restart service: %v", err)
	}
	modelsResp, err := restarted.ListLocalAssets(context.Background(), &runtimev1.ListLocalAssetsRequest{})
	if err != nil {
		t.Fatalf("list models after restart: %v", err)
	}
	if len(modelsResp.GetAssets()) == 0 {
		t.Fatalf("expected restored models from persisted state")
	}
	foundProfile := false
	for _, model := range modelsResp.GetAssets() {
		if model.GetAssetId() == "local/persisted-import" && model.GetLocalInvokeProfileId() == "profile-persisted" {
			foundProfile = true
			break
		}
	}
	if !foundProfile {
		t.Fatalf("expected restored model with local_invoke_profile_id=profile-persisted")
	}
	servicesResp, err := restarted.ListLocalServices(context.Background(), &runtimev1.ListLocalServicesRequest{})
	if err != nil {
		t.Fatalf("list services after restart: %v", err)
	}
	if len(servicesResp.GetServices()) == 0 {
		t.Fatalf("expected restored services from persisted state")
	}

	auditsResp, err := restarted.ListLocalAudits(context.Background(), &runtimev1.ListLocalAuditsRequest{
		EventType:     "persist_audit",
		AppId:         "app.persist",
		SubjectUserId: "user-persist",
		PageSize:      10,
	})
	if err != nil {
		t.Fatalf("list audits after restart: %v", err)
	}
	if len(auditsResp.GetEvents()) != 1 {
		t.Fatalf("expected one restored persisted audit event, got %d", len(auditsResp.GetEvents()))
	}
	event := auditsResp.GetEvents()[0]
	if event.GetTraceId() != "trace-persist" {
		t.Fatalf("unexpected restored trace_id: %s", event.GetTraceId())
	}
	if event.GetOperation() != "append_inference_audit" {
		t.Fatalf("unexpected restored operation: %s", event.GetOperation())
	}
}

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

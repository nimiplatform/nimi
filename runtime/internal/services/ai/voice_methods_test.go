package ai

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

type staticProvider struct {
	route runtimev1.RoutePolicy
}

func newStaticProvider(route runtimev1.RoutePolicy) provider {
	return staticProvider{route: route}
}

func (p staticProvider) Route() runtimev1.RoutePolicy                { return p.route }
func (p staticProvider) ResolveModelID(raw string) string            { return raw }
func (p staticProvider) CheckModelAvailability(modelID string) error { return nil }
func (p staticProvider) GenerateText(context.Context, string, *runtimev1.TextGenerateScenarioSpec, string) (string, *runtimev1.UsageStats, runtimev1.FinishReason, error) {
	return "", nil, runtimev1.FinishReason_FINISH_REASON_UNSPECIFIED, nil
}
func (p staticProvider) Embed(context.Context, string, []string) ([]*structpb.ListValue, *runtimev1.UsageStats, error) {
	return nil, nil, nil
}

func TestListPresetVoicesReturnsCatalogVoices(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"dashscope": {BaseURL: "http://example.com", APIKey: "test-key"}},
	})

	resp, err := svc.ListPresetVoices(context.Background(), &runtimev1.ListPresetVoicesRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "dashscope/qwen3-tts-instruct-flash",
	})
	if err != nil {
		t.Fatalf("ListPresetVoices: %v", err)
	}
	if len(resp.GetVoices()) == 0 {
		t.Fatalf("expected non-empty preset voice list")
	}
	if resp.GetTraceId() == "" {
		t.Fatalf("trace id must be set")
	}
	if resp.GetModelResolved() == "" {
		t.Fatalf("model resolved must be set")
	}
}

func TestListPresetVoicesInfersProviderTypeForCloudAlias(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"stepfun": {BaseURL: "http://example.com", APIKey: "test-key"}},
	})

	resp, err := svc.ListPresetVoices(context.Background(), &runtimev1.ListPresetVoicesRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "cloud/step-tts-2",
	})
	if err != nil {
		t.Fatalf("ListPresetVoices(cloud alias): %v", err)
	}
	if len(resp.GetVoices()) == 0 {
		t.Fatalf("expected non-empty preset voice list for cloud alias")
	}
	if resp.GetModelResolved() == "" {
		t.Fatalf("model resolved must be set for cloud alias")
	}
}

func TestPresetVoiceCatalogProviderTypeNormalizesLocalSpeechProviderType(t *testing.T) {
	got := presetVoiceCatalogProviderType(nil, newStaticProvider(runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL), "speech/qwen3tts")
	if got != "local" {
		t.Fatalf("presetVoiceCatalogProviderType(local speech) = %q, want %q", got, "local")
	}
}

func TestVoiceAssetMethodsLifecycle(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"dashscope": {BaseURL: "http://example.com", APIKey: "test-key"},
		},
	})

	submitResp, err := svc.SubmitScenarioJob(context.Background(), &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "dashscope/qwen3-tts-vc",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_VoiceClone{
				VoiceClone: &runtimev1.VoiceCloneScenarioSpec{
					TargetModelId: "dashscope/qwen3-tts-vc",
					Input: &runtimev1.VoiceV2VInput{
						ReferenceAudioUri: "file://sample.wav",
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("SubmitScenarioJob(voice clone): %v", err)
	}
	if submitResp.GetAsset() == nil {
		t.Fatalf("voice clone submit must return asset")
	}
	assetID := submitResp.GetAsset().GetVoiceAssetId()
	if assetID == "" {
		t.Fatalf("voice asset id must be set")
	}

	getResp, err := svc.GetVoiceAsset(context.Background(), &runtimev1.GetVoiceAssetRequest{VoiceAssetId: assetID})
	if err != nil {
		t.Fatalf("GetVoiceAsset: %v", err)
	}
	if getResp.GetAsset() == nil || getResp.GetAsset().GetVoiceAssetId() != assetID {
		t.Fatalf("get voice asset mismatch")
	}

	listResp, err := svc.ListVoiceAssets(context.Background(), &runtimev1.ListVoiceAssetsRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		PageSize:      10,
	})
	if err != nil {
		t.Fatalf("ListVoiceAssets: %v", err)
	}
	if len(listResp.GetAssets()) == 0 {
		t.Fatalf("expected at least one voice asset")
	}

	deleteResp, err := svc.DeleteVoiceAsset(context.Background(), &runtimev1.DeleteVoiceAssetRequest{VoiceAssetId: assetID})
	if err != nil {
		t.Fatalf("DeleteVoiceAsset: %v", err)
	}
	if deleteResp.GetAck() == nil || !deleteResp.GetAck().GetOk() {
		t.Fatalf("delete voice asset ack must be ok")
	}

	getAfterDelete, err := svc.GetVoiceAsset(context.Background(), &runtimev1.GetVoiceAssetRequest{VoiceAssetId: assetID})
	if err != nil {
		t.Fatalf("GetVoiceAsset(after delete): %v", err)
	}
	if getAfterDelete.GetAsset().GetStatus() != runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_DELETED {
		t.Fatalf("asset status mismatch after delete: got=%v", getAfterDelete.GetAsset().GetStatus())
	}
}

func TestDeleteVoiceAssetDeletesProviderPersistentVoiceWhenSupported(t *testing.T) {
	var (
		gotMethod string
		gotPath   string
		gotAPIKey string
	)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		gotMethod = request.Method
		gotPath = request.URL.Path
		gotAPIKey = request.Header.Get("xi-api-key")
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"elevenlabs": {BaseURL: server.URL, APIKey: "test-key"},
		},
	})

	const assetID = "asset-elevenlabs-1"
	svc.voiceAssets.assets[assetID] = &runtimev1.VoiceAsset{
		VoiceAssetId:     assetID,
		Provider:         "elevenlabs",
		ProviderVoiceRef: "voice_123",
		Persistence:      runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_PROVIDER_PERSISTENT,
		Status:           runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_ACTIVE,
	}

	deleteResp, err := svc.DeleteVoiceAsset(context.Background(), &runtimev1.DeleteVoiceAssetRequest{VoiceAssetId: assetID})
	if err != nil {
		t.Fatalf("DeleteVoiceAsset: %v", err)
	}
	if deleteResp.GetAck() == nil || !deleteResp.GetAck().GetOk() {
		t.Fatalf("delete voice asset ack must be ok")
	}
	if gotMethod != http.MethodDelete {
		t.Fatalf("unexpected provider delete method: %q", gotMethod)
	}
	if gotPath != "/v1/voices/voice_123" {
		t.Fatalf("unexpected provider delete path: %q", gotPath)
	}
	if gotAPIKey != "test-key" {
		t.Fatalf("unexpected provider delete api key: %q", gotAPIKey)
	}
	getAfterDelete, err := svc.GetVoiceAsset(context.Background(), &runtimev1.GetVoiceAssetRequest{VoiceAssetId: assetID})
	if err != nil {
		t.Fatalf("GetVoiceAsset(after delete): %v", err)
	}
	if getAfterDelete.GetAsset().GetStatus() != runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_DELETED {
		t.Fatalf("asset status mismatch after provider delete: got=%v", getAfterDelete.GetAsset().GetStatus())
	}
	fields := getAfterDelete.GetAsset().GetMetadata().GetFields()
	if !fields["provider_delete_attempted"].GetBoolValue() {
		t.Fatalf("expected provider_delete_attempted")
	}
	if !fields["provider_delete_succeeded"].GetBoolValue() {
		t.Fatalf("expected provider_delete_succeeded")
	}
	if fields["provider_delete_reconciliation_pending"].GetBoolValue() {
		t.Fatalf("did not expect reconciliation pending after successful delete")
	}
}

func TestDeleteVoiceAssetDeletesFishAudioProviderModelWhenSupported(t *testing.T) {
	var (
		gotMethod string
		gotPath   string
		gotAuth   string
	)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		gotMethod = request.Method
		gotPath = request.URL.Path
		gotAuth = request.Header.Get("Authorization")
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"fish_audio": {BaseURL: server.URL, APIKey: "test-key"},
		},
	})

	const assetID = "asset-fish-1"
	svc.voiceAssets.assets[assetID] = &runtimev1.VoiceAsset{
		VoiceAssetId:     assetID,
		Provider:         "fish_audio",
		ProviderVoiceRef: "model_123",
		Persistence:      runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_PROVIDER_PERSISTENT,
		Status:           runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_ACTIVE,
	}

	deleteResp, err := svc.DeleteVoiceAsset(context.Background(), &runtimev1.DeleteVoiceAssetRequest{VoiceAssetId: assetID})
	if err != nil {
		t.Fatalf("DeleteVoiceAsset: %v", err)
	}
	if deleteResp.GetAck() == nil || !deleteResp.GetAck().GetOk() {
		t.Fatalf("delete voice asset ack must be ok")
	}
	if gotMethod != http.MethodDelete {
		t.Fatalf("unexpected provider delete method: %q", gotMethod)
	}
	if gotPath != "/model/model_123" {
		t.Fatalf("unexpected provider delete path: %q", gotPath)
	}
	if gotAuth != "Bearer test-key" {
		t.Fatalf("unexpected provider delete Authorization header: %q", gotAuth)
	}
}

func TestDeleteVoiceAssetMarksLocalRuntimeAuthoritativeDeleteMetadata(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))

	const assetID = "asset-local-qwen3-1"
	svc.voiceAssets.assets[assetID] = &runtimev1.VoiceAsset{
		VoiceAssetId:  assetID,
		Provider:      "local",
		ModelId:       "speech/qwen3tts",
		TargetModelId: "speech/qwen3tts",
		Persistence:   runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_SESSION_EPHEMERAL,
		Status:        runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_ACTIVE,
		Metadata: structFromMap(map[string]any{
			"workflow_family":                                     "qwen3_tts",
			"voice_handle_policy_delete_semantics":                "runtime_authoritative_delete",
			"voice_handle_policy_runtime_reconciliation_required": false,
		}),
	}

	if _, err := svc.DeleteVoiceAsset(context.Background(), &runtimev1.DeleteVoiceAssetRequest{VoiceAssetId: assetID}); err != nil {
		t.Fatalf("DeleteVoiceAsset(local): %v", err)
	}
	getAfterDelete, err := svc.GetVoiceAsset(context.Background(), &runtimev1.GetVoiceAssetRequest{VoiceAssetId: assetID})
	if err != nil {
		t.Fatalf("GetVoiceAsset(after local delete): %v", err)
	}
	fields := getAfterDelete.GetAsset().GetMetadata().GetFields()
	if fields["provider_delete_attempted"].GetBoolValue() {
		t.Fatalf("did not expect provider_delete_attempted for runtime-authoritative local delete")
	}
	if fields["provider_delete_succeeded"].GetBoolValue() {
		t.Fatalf("did not expect provider_delete_succeeded for runtime-authoritative local delete")
	}
	if fields["provider_delete_reconciliation_pending"].GetBoolValue() {
		t.Fatalf("did not expect reconciliation pending for runtime-authoritative local delete")
	}
	if got := fields["provider_delete_semantics_effective"].GetStringValue(); got != "runtime_authoritative_delete" {
		t.Fatalf("provider_delete_semantics_effective=%q", got)
	}
	if got := strings.TrimSpace(fields["deleted_at"].GetStringValue()); got == "" {
		t.Fatalf("expected deleted_at metadata")
	}
}

func TestDeleteVoiceAssetProviderFailureMarksPendingReconciliationAndRetryClearsIt(t *testing.T) {
	var requestCount int
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requestCount++
		if requestCount == 1 {
			writer.Header().Set("Content-Type", "application/json")
			writer.WriteHeader(http.StatusBadGateway)
			_, _ = writer.Write([]byte(`{"detail":{"message":"upstream temporarily unavailable"}}`))
			return
		}
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"elevenlabs": {BaseURL: server.URL, APIKey: "test-key"},
		},
	})
	svc.audit = auditlog.New(128, 128)

	const assetID = "asset-elevenlabs-reconcile-1"
	svc.voiceAssets.assets[assetID] = &runtimev1.VoiceAsset{
		VoiceAssetId:     assetID,
		AppId:            "nimi.desktop",
		SubjectUserId:    "user-001",
		Provider:         "elevenlabs",
		ProviderVoiceRef: "voice_retry_123",
		Persistence:      runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_PROVIDER_PERSISTENT,
		Status:           runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_ACTIVE,
		Metadata: structFromMap(map[string]any{
			"voice_handle_policy_delete_semantics":                "best_effort_provider_delete",
			"voice_handle_policy_runtime_reconciliation_required": true,
		}),
	}

	if _, err := svc.DeleteVoiceAsset(context.Background(), &runtimev1.DeleteVoiceAssetRequest{VoiceAssetId: assetID}); err != nil {
		t.Fatalf("DeleteVoiceAsset(first retryable failure): %v", err)
	}
	firstDelete, err := svc.GetVoiceAsset(context.Background(), &runtimev1.GetVoiceAssetRequest{VoiceAssetId: assetID})
	if err != nil {
		t.Fatalf("GetVoiceAsset(after first delete): %v", err)
	}
	firstFields := firstDelete.GetAsset().GetMetadata().GetFields()
	if !firstFields["provider_delete_attempted"].GetBoolValue() {
		t.Fatalf("expected provider_delete_attempted after failure")
	}
	if firstFields["provider_delete_succeeded"].GetBoolValue() {
		t.Fatalf("did not expect provider_delete_succeeded after failure")
	}
	if !firstFields["provider_delete_reconciliation_pending"].GetBoolValue() {
		t.Fatalf("expected reconciliation pending after provider delete failure")
	}
	if !firstFields["provider_delete_runtime_reconciliation_required"].GetBoolValue() {
		t.Fatalf("expected runtime reconciliation required flag")
	}
	if got := int(firstFields["provider_delete_retry_attempt_count"].GetNumberValue()); got != 1 {
		t.Fatalf("provider_delete_retry_attempt_count=%d", got)
	}
	if got := strings.TrimSpace(firstFields["provider_delete_next_retry_at"].GetStringValue()); got == "" {
		t.Fatalf("expected provider_delete_next_retry_at after failure")
	}
	if got := strings.TrimSpace(firstFields["provider_delete_last_error"].GetStringValue()); got == "" {
		t.Fatalf("expected provider_delete_last_error after failure")
	}

	if _, err := svc.DeleteVoiceAsset(context.Background(), &runtimev1.DeleteVoiceAssetRequest{VoiceAssetId: assetID}); err != nil {
		t.Fatalf("DeleteVoiceAsset(second retry success): %v", err)
	}
	secondDelete, err := svc.GetVoiceAsset(context.Background(), &runtimev1.GetVoiceAssetRequest{VoiceAssetId: assetID})
	if err != nil {
		t.Fatalf("GetVoiceAsset(after second delete): %v", err)
	}
	secondFields := secondDelete.GetAsset().GetMetadata().GetFields()
	if !secondFields["provider_delete_succeeded"].GetBoolValue() {
		t.Fatalf("expected provider_delete_succeeded after retry")
	}
	if secondFields["provider_delete_reconciliation_pending"].GetBoolValue() {
		t.Fatalf("did not expect reconciliation pending after retry success")
	}
	if secondFields["provider_delete_reconciliation_exhausted"].GetBoolValue() {
		t.Fatalf("did not expect reconciliation exhausted after retry success")
	}
	if got := strings.TrimSpace(secondFields["provider_delete_last_error"].GetStringValue()); got != "" {
		t.Fatalf("expected provider_delete_last_error cleared after retry success, got %q", got)
	}
	if requestCount != 2 {
		t.Fatalf("expected 2 delete attempts, got %d", requestCount)
	}
	events, err := svc.audit.ListEvents(&runtimev1.ListAuditEventsRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		Domain:        "runtime.ai",
	})
	if err != nil {
		t.Fatalf("ListEvents(delete retries): %v", err)
	}
	if len(events.GetEvents()) != 2 {
		t.Fatalf("expected 2 delete audit events, got %d", len(events.GetEvents()))
	}
	firstEvent := events.GetEvents()[0]
	if got := firstEvent.GetOperation(); got != "voice_asset.delete" {
		t.Fatalf("operation=%q", got)
	}
	firstPayload := firstEvent.GetPayload().GetFields()
	if !firstPayload["provider_delete_succeeded"].GetBoolValue() {
		t.Fatalf("expected second delete audit to record success")
	}
	secondEvent := events.GetEvents()[1]
	secondPayload := secondEvent.GetPayload().GetFields()
	if secondPayload["provider_delete_succeeded"].GetBoolValue() {
		t.Fatalf("expected first delete audit to record failure")
	}
	if !secondPayload["provider_delete_reconciliation_pending"].GetBoolValue() {
		t.Fatalf("expected first delete audit to record pending reconciliation")
	}
}

func TestListVoiceAssetsRetriesPendingVoiceDeleteReconciliation(t *testing.T) {
	var requestCount int
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requestCount++
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"elevenlabs": {BaseURL: server.URL, APIKey: "test-key"},
		},
	})
	svc.audit = auditlog.New(128, 128)

	const assetID = "asset-elevenlabs-list-reconcile-1"
	svc.voiceAssets.assets[assetID] = &runtimev1.VoiceAsset{
		VoiceAssetId:     assetID,
		AppId:            "nimi.desktop",
		SubjectUserId:    "user-001",
		Provider:         "elevenlabs",
		ProviderVoiceRef: "voice_pending_123",
		Persistence:      runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_PROVIDER_PERSISTENT,
		Status:           runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_DELETED,
		Metadata: structFromMap(map[string]any{
			"deleted_at":                                          time.Now().UTC().Add(-2 * time.Minute).Format(time.RFC3339Nano),
			"voice_handle_policy_delete_semantics":                "best_effort_provider_delete",
			"voice_handle_policy_runtime_reconciliation_required": true,
			"provider_delete_reconciliation_pending":              true,
			"provider_delete_attempted":                           true,
			"provider_delete_succeeded":                           false,
			"provider_delete_last_attempt_at":                     time.Now().UTC().Add(-2 * time.Minute).Format(time.RFC3339Nano),
			"provider_delete_last_error":                          "temporary upstream failure",
		}),
	}

	resp, err := svc.ListVoiceAssets(context.Background(), &runtimev1.ListVoiceAssetsRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		PageSize:      10,
	})
	if err != nil {
		t.Fatalf("ListVoiceAssets(reconcile): %v", err)
	}
	if len(resp.GetAssets()) != 1 {
		t.Fatalf("expected one asset, got %d", len(resp.GetAssets()))
	}
	fields := resp.GetAssets()[0].GetMetadata().GetFields()
	if !fields["provider_delete_succeeded"].GetBoolValue() {
		t.Fatalf("expected provider delete success after list-triggered reconciliation")
	}
	if fields["provider_delete_reconciliation_pending"].GetBoolValue() {
		t.Fatalf("did not expect reconciliation pending after successful retry")
	}
	if got := strings.TrimSpace(fields["provider_delete_last_error"].GetStringValue()); got != "" {
		t.Fatalf("expected provider_delete_last_error cleared, got %q", got)
	}
	if requestCount != 1 {
		t.Fatalf("expected 1 provider delete retry, got %d", requestCount)
	}
	events, err := svc.audit.ListEvents(&runtimev1.ListAuditEventsRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		Domain:        "runtime.ai",
	})
	if err != nil {
		t.Fatalf("ListEvents(reconcile success): %v", err)
	}
	if len(events.GetEvents()) == 0 {
		t.Fatalf("expected reconciliation audit event")
	}
	event := events.GetEvents()[0]
	if got := event.GetOperation(); got != "voice_asset.delete_reconcile_retry" {
		t.Fatalf("operation=%q", got)
	}
	payload := event.GetPayload().GetFields()
	if !payload["provider_delete_succeeded"].GetBoolValue() {
		t.Fatalf("expected provider_delete_succeeded audit payload")
	}
	if payload["provider_delete_reconciliation_pending"].GetBoolValue() {
		t.Fatalf("did not expect pending reconciliation in success audit payload")
	}
}

func TestListVoiceAssetsSkipsVoiceDeleteReconciliationWithinCooldown(t *testing.T) {
	var requestCount int
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requestCount++
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"elevenlabs": {BaseURL: server.URL, APIKey: "test-key"},
		},
	})

	const assetID = "asset-elevenlabs-cooldown-1"
	svc.voiceAssets.assets[assetID] = &runtimev1.VoiceAsset{
		VoiceAssetId:     assetID,
		AppId:            "nimi.desktop",
		SubjectUserId:    "user-001",
		Provider:         "elevenlabs",
		ProviderVoiceRef: "voice_pending_cooldown_123",
		Persistence:      runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_PROVIDER_PERSISTENT,
		Status:           runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_DELETED,
		Metadata: structFromMap(map[string]any{
			"deleted_at":                                          time.Now().UTC().Add(-2 * time.Minute).Format(time.RFC3339Nano),
			"voice_handle_policy_delete_semantics":                "best_effort_provider_delete",
			"voice_handle_policy_runtime_reconciliation_required": true,
			"provider_delete_reconciliation_pending":              true,
			"provider_delete_attempted":                           true,
			"provider_delete_succeeded":                           false,
			"provider_delete_last_attempt_at":                     time.Now().UTC().Add(-5 * time.Second).Format(time.RFC3339Nano),
			"provider_delete_last_error":                          "still cooling down",
		}),
	}

	resp, err := svc.ListVoiceAssets(context.Background(), &runtimev1.ListVoiceAssetsRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		PageSize:      10,
	})
	if err != nil {
		t.Fatalf("ListVoiceAssets(cooldown): %v", err)
	}
	if len(resp.GetAssets()) != 1 {
		t.Fatalf("expected one asset, got %d", len(resp.GetAssets()))
	}
	fields := resp.GetAssets()[0].GetMetadata().GetFields()
	if !fields["provider_delete_reconciliation_pending"].GetBoolValue() {
		t.Fatalf("expected reconciliation pending to remain during cooldown")
	}
	if requestCount != 0 {
		t.Fatalf("expected 0 provider delete retries during cooldown, got %d", requestCount)
	}
}

func TestListVoiceAssetsMarksVoiceDeleteReconciliationExhaustedAfterMaxAttempts(t *testing.T) {
	var requestCount int
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requestCount++
		writer.Header().Set("Content-Type", "application/json")
		writer.WriteHeader(http.StatusBadGateway)
		_, _ = writer.Write([]byte(`{"detail":{"message":"still unavailable"}}`))
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"elevenlabs": {BaseURL: server.URL, APIKey: "test-key"},
		},
	})
	svc.audit = auditlog.New(128, 128)

	const assetID = "asset-elevenlabs-exhausted-1"
	svc.voiceAssets.assets[assetID] = &runtimev1.VoiceAsset{
		VoiceAssetId:     assetID,
		AppId:            "nimi.desktop",
		SubjectUserId:    "user-001",
		Provider:         "elevenlabs",
		ProviderVoiceRef: "voice_pending_exhaust_123",
		Persistence:      runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_PROVIDER_PERSISTENT,
		Status:           runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_DELETED,
		Metadata: structFromMap(map[string]any{
			"deleted_at":                                          time.Now().UTC().Add(-10 * time.Minute).Format(time.RFC3339Nano),
			"voice_handle_policy_delete_semantics":                "best_effort_provider_delete",
			"voice_handle_policy_runtime_reconciliation_required": true,
			"provider_delete_reconciliation_pending":              true,
			"provider_delete_attempted":                           true,
			"provider_delete_succeeded":                           false,
			"provider_delete_retry_attempt_count":                 float64(maxVoiceAssetDeleteRetryAttempts - 1),
			"provider_delete_last_attempt_at":                     time.Now().UTC().Add(-10 * time.Minute).Format(time.RFC3339Nano),
			"provider_delete_last_error":                          "still failing",
		}),
	}

	resp, err := svc.ListVoiceAssets(context.Background(), &runtimev1.ListVoiceAssetsRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		PageSize:      10,
	})
	if err != nil {
		t.Fatalf("ListVoiceAssets(exhaust): %v", err)
	}
	if len(resp.GetAssets()) != 1 {
		t.Fatalf("expected one asset, got %d", len(resp.GetAssets()))
	}
	fields := resp.GetAssets()[0].GetMetadata().GetFields()
	if !fields["provider_delete_reconciliation_exhausted"].GetBoolValue() {
		t.Fatalf("expected reconciliation exhausted after max attempts")
	}
	if fields["provider_delete_reconciliation_pending"].GetBoolValue() {
		t.Fatalf("did not expect reconciliation pending once exhausted")
	}
	if got := int(fields["provider_delete_retry_attempt_count"].GetNumberValue()); got != maxVoiceAssetDeleteRetryAttempts {
		t.Fatalf("provider_delete_retry_attempt_count=%d", got)
	}
	if requestCount != 1 {
		t.Fatalf("expected 1 provider delete retry, got %d", requestCount)
	}
	events, err := svc.audit.ListEvents(&runtimev1.ListAuditEventsRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		Domain:        "runtime.ai",
	})
	if err != nil {
		t.Fatalf("ListEvents(exhaust): %v", err)
	}
	if len(events.GetEvents()) == 0 {
		t.Fatalf("expected reconciliation audit event")
	}
	event := events.GetEvents()[0]
	if got := event.GetOperation(); got != "voice_asset.delete_reconcile_retry" {
		t.Fatalf("operation=%q", got)
	}
	payload := event.GetPayload().GetFields()
	if !payload["provider_delete_reconciliation_exhausted"].GetBoolValue() {
		t.Fatalf("expected exhausted audit payload")
	}
	if got := int(payload["provider_delete_retry_attempt_count"].GetNumberValue()); got != maxVoiceAssetDeleteRetryAttempts {
		t.Fatalf("provider_delete_retry_attempt_count=%d", got)
	}

	resp, err = svc.ListVoiceAssets(context.Background(), &runtimev1.ListVoiceAssetsRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		PageSize:      10,
	})
	if err != nil {
		t.Fatalf("ListVoiceAssets(exhaust second read): %v", err)
	}
	if len(resp.GetAssets()) != 1 {
		t.Fatalf("expected one asset on second read, got %d", len(resp.GetAssets()))
	}
	if requestCount != 1 {
		t.Fatalf("expected exhausted asset not to retry again, got %d requests", requestCount)
	}
}

func TestRunVoiceAssetDeleteReconciliationLoopRetriesPendingDelete(t *testing.T) {
	var requestCount atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requestCount.Add(1)
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"elevenlabs": {BaseURL: server.URL, APIKey: "test-key"},
		},
	})
	svc.audit = auditlog.New(128, 128)
	svc.voiceAssetDeleteReconciliationInterval = 10 * time.Millisecond

	const assetID = "asset-elevenlabs-loop-1"
	svc.voiceAssets.assets[assetID] = &runtimev1.VoiceAsset{
		VoiceAssetId:     assetID,
		AppId:            "nimi.desktop",
		SubjectUserId:    "user-001",
		Provider:         "elevenlabs",
		ProviderVoiceRef: "voice_pending_loop_123",
		Persistence:      runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_PROVIDER_PERSISTENT,
		Status:           runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_DELETED,
		Metadata: structFromMap(map[string]any{
			"deleted_at":                                          time.Now().UTC().Add(-2 * time.Minute).Format(time.RFC3339Nano),
			"voice_handle_policy_delete_semantics":                "best_effort_provider_delete",
			"voice_handle_policy_runtime_reconciliation_required": true,
			"provider_delete_reconciliation_pending":              true,
			"provider_delete_attempted":                           true,
			"provider_delete_succeeded":                           false,
			"provider_delete_last_attempt_at":                     time.Now().UTC().Add(-2 * time.Minute).Format(time.RFC3339Nano),
			"provider_delete_last_error":                          "temporary upstream failure",
		}),
	}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		svc.RunVoiceAssetDeleteReconciliationLoop(ctx)
	}()

	deadline := time.Now().Add(2 * time.Second)
	for {
		asset, ok := svc.voiceAssets.getAsset(assetID)
		if ok {
			fields := asset.GetMetadata().GetFields()
			if fields["provider_delete_succeeded"].GetBoolValue() && !fields["provider_delete_reconciliation_pending"].GetBoolValue() {
				break
			}
		}
		if time.Now().After(deadline) {
			t.Fatal("timed out waiting for voice asset reconciliation loop to succeed")
		}
		time.Sleep(10 * time.Millisecond)
	}
	cancel()
	select {
	case <-done:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("voice asset reconciliation loop did not stop after cancel")
	}
	if got := requestCount.Load(); got < 1 {
		t.Fatalf("expected at least one provider delete attempt, got %d", got)
	}
	events, err := svc.audit.ListEvents(&runtimev1.ListAuditEventsRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		Domain:        "runtime.ai",
	})
	if err != nil {
		t.Fatalf("ListEvents(loop): %v", err)
	}
	if len(events.GetEvents()) == 0 {
		t.Fatalf("expected loop retry audit event")
	}
	if got := events.GetEvents()[0].GetOperation(); got != "voice_asset.delete_reconcile_retry" {
		t.Fatalf("operation=%q", got)
	}
}

func TestListVoiceAssetsValidation(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))

	_, err := svc.ListVoiceAssets(context.Background(), &runtimev1.ListVoiceAssetsRequest{
		AppId:         "",
		SubjectUserId: "user-001",
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument, got=%v", status.Code(err))
	}
}

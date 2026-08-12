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
	"github.com/nimiplatform/nimi/runtime/internal/remoteexecution"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeidentity"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
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

func bindVoiceAssetDeleteTarget(t *testing.T, svc *Service, assetID string, provider string, endpoint string, apiKey string) {
	t.Helper()
	if svc.connStore == nil {
		svc.connStore = connector.NewConnectorStoreWithMemorySecrets(t.TempDir())
	}
	asset, ok := svc.voiceAssets.getAsset(assetID)
	ownerID := "user-001"
	if ok && strings.TrimSpace(asset.GetSubjectUserId()) != "" {
		ownerID = strings.TrimSpace(asset.GetSubjectUserId())
	}
	connectorID := "voice-delete-" + assetID
	record, err := svc.connStore.Create(connector.ConnectorRecord{
		ConnectorID: connectorID,
		Kind:        runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType:   runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER,
		OwnerID:     ownerID,
		Provider:    provider,
		Endpoint:    endpoint,
		Label:       "Voice delete test",
		Status:      runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}, apiKey)
	if err != nil {
		t.Fatalf("create voice delete connector: %v", err)
	}
	transport := nimillm.NewCloudProvider(nimillm.CloudConfig{HTTPTimeout: time.Second, AllowLoopbackEndpoint: true}, nil, nil)
	svc.remoteMediaHost = remoteexecution.NewProviderMediaHost(svc.connStore, transport, auditlog.New(32, 32), true)
	svc.voiceAssets.mu.Lock()
	remoteCatalogID := "voice-delete-catalog-" + assetID
	providerModelID := "voice-delete-model-" + assetID
	svc.voiceAssets.targets[assetID] = &runtimeidentity.Target{Cloud: &runtimeidentity.CloudTarget{
		ConnectorID: record.ConnectorID, RemoteModelCatalogID: remoteCatalogID,
		ProviderModelID: providerModelID, Provider: provider,
	}}
	rawTarget, _ := structpb.NewStruct(map[string]any{
		"provider": provider, "providerModelId": providerModelID, "remoteModelCatalogId": remoteCatalogID,
	})
	svc.voiceAssets.cloudBindings[assetID] = &voiceAssetCloudBinding{
		CapabilityContract: "voice.create",
		Implementation: &runtimev1.CapabilityImplementationIdentity{
			ImplementationId: "cloud.voice.delete." + provider, DriverId: "nimi.runtime.driver." + provider, DriverDialect: "provider/voice-delete/v1",
		},
		ProviderModelTarget: rawTarget, ConnectorID: record.ConnectorID,
	}
	svc.voiceAssets.mu.Unlock()
}

func TestVoiceAssetMethodsLifecycle(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"voice_id":"voice-methods-lifecycle","job_id":"job-methods-lifecycle"}`)
	}))
	defer server.Close()
	fixture := newManagedCloudScenarioTestFixture(t, "dashscope", "qwen3-tts-vc-2026-01-22", server.URL, Config{AllowLoopbackEndpoint: true})
	svc := fixture.service

	ctx := withCloudScenarioTestIntent(scenarioJobUserContext("nimi.desktop", "user-001"), "voice.create", fixture.targetRef)
	submitResp, err := svc.SubmitScenarioJob(ctx, &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_VoiceCreate{
				VoiceCreate: &runtimev1.VoiceCreateScenarioSpec{
					TargetModelId: "dashscope/qwen3-tts-vc",
					Source: &runtimev1.VoiceCreateScenarioSpec_ReferenceAudio{ReferenceAudio: &runtimev1.VoiceV2VInput{
						ReferenceAudioUri: "file://sample.wav",
					}},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("SubmitScenarioJob(voice clone): %v", err)
	}
	job := waitScenarioJobTerminal(t, svc, submitResp.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("voice clone Job status=%s reason=%s detail=%q", job.GetStatus(), job.GetReasonCode(), job.GetReasonDetail())
	}
	terminal, err := svc.GetScenarioJob(ctx, &runtimev1.GetScenarioJobRequest{JobId: job.GetJobId()})
	if err != nil {
		t.Fatalf("GetScenarioJob terminal result: %v", err)
	}
	assetID := terminal.GetAsset().GetVoiceAssetId()
	if assetID == "" {
		t.Fatalf("voice asset id must be set")
	}
	voiceReference := terminal.GetVoiceReference()
	if voiceReference == nil {
		t.Fatalf("voice clone terminal Get must return voice reference")
	}
	if voiceReference.GetKind() != runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_VOICE_ASSET {
		t.Fatalf("voice reference kind mismatch: got=%v", voiceReference.GetKind())
	}
	if voiceReference.GetVoiceAssetId() != assetID {
		t.Fatalf("voice reference asset mismatch: got=%q want=%q", voiceReference.GetVoiceAssetId(), assetID)
	}
	terminalAssetSnapshot := cloneVoiceAsset(terminal.GetAsset())
	terminalReferenceSnapshot := cloneVoiceReference(terminal.GetVoiceReference())
	collector := &scenarioJobEventCollector{ctx: ctx}
	if err := svc.SubscribeScenarioJobEvents(&runtimev1.SubscribeScenarioJobEventsRequest{JobId: job.GetJobId()}, collector); err != nil {
		t.Fatalf("SubscribeScenarioJobEvents after completion: %v", err)
	}
	if len(collector.events) == 0 || collector.events[len(collector.events)-1].GetEventType() != runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED {
		t.Fatalf("completed voice Job event backlog=%+v", collector.events)
	}

	getResp, err := svc.GetVoiceAsset(ctx, &runtimev1.GetVoiceAssetRequest{VoiceAssetId: assetID})
	if err != nil {
		t.Fatalf("GetVoiceAsset: %v", err)
	}
	if getResp.GetAsset() == nil || getResp.GetAsset().GetVoiceAssetId() != assetID {
		t.Fatalf("get voice asset mismatch")
	}

	listResp, err := svc.ListVoiceAssets(ctx, &runtimev1.ListVoiceAssetsRequest{
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

	deleteResp, err := svc.DeleteVoiceAsset(ctx, &runtimev1.DeleteVoiceAssetRequest{VoiceAssetId: assetID})
	if err != nil {
		t.Fatalf("DeleteVoiceAsset: %v", err)
	}
	if deleteResp.GetAck() == nil || !deleteResp.GetAck().GetOk() {
		t.Fatalf("delete voice asset ack must be ok")
	}

	getAfterDelete, err := svc.GetVoiceAsset(ctx, &runtimev1.GetVoiceAssetRequest{VoiceAssetId: assetID})
	if err != nil {
		t.Fatalf("GetVoiceAsset(after delete): %v", err)
	}
	if getAfterDelete.GetAsset().GetStatus() != runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_DELETED {
		t.Fatalf("asset status mismatch after delete: got=%v", getAfterDelete.GetAsset().GetStatus())
	}
	terminalAfterDelete, err := svc.GetScenarioJob(ctx, &runtimev1.GetScenarioJobRequest{JobId: job.GetJobId()})
	if err != nil {
		t.Fatalf("GetScenarioJob after VoiceAsset delete: %v", err)
	}
	if !proto.Equal(terminalAfterDelete.GetAsset(), terminalAssetSnapshot) ||
		!proto.Equal(terminalAfterDelete.GetVoiceReference(), terminalReferenceSnapshot) {
		t.Fatalf("VoiceAsset catalog delete mutated terminal Job result: before=%+v/%+v after=%+v/%+v",
			terminalAssetSnapshot, terminalReferenceSnapshot, terminalAfterDelete.GetAsset(), terminalAfterDelete.GetVoiceReference())
	}
}

func TestVoiceAssetGetAndDeleteRequireOwnerContext(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))

	const assetID = "asset-owner-scope-1"
	svc.voiceAssets.assets[assetID] = &runtimev1.VoiceAsset{
		VoiceAssetId:  assetID,
		AppId:         "owner.app",
		SubjectUserId: "owner-user",
		Provider:      "local",
		Persistence:   runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_SESSION_EPHEMERAL,
		Status:        runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_ACTIVE,
	}

	if _, err := svc.GetVoiceAsset(context.Background(), &runtimev1.GetVoiceAssetRequest{VoiceAssetId: assetID}); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("GetVoiceAsset without owner context code=%v err=%v, want InvalidArgument", status.Code(err), err)
	}
	if _, err := svc.GetVoiceAsset(scenarioJobUserContext("intruder.app", "owner-user"), &runtimev1.GetVoiceAssetRequest{VoiceAssetId: assetID}); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("GetVoiceAsset cross-app code=%v err=%v, want PermissionDenied", status.Code(err), err)
	}
	if _, err := svc.DeleteVoiceAsset(scenarioJobUserContext("owner.app", "intruder-user"), &runtimev1.DeleteVoiceAssetRequest{VoiceAssetId: assetID}); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("DeleteVoiceAsset cross-user code=%v err=%v, want PermissionDenied", status.Code(err), err)
	}
	if _, err := svc.ListVoiceAssets(context.Background(), &runtimev1.ListVoiceAssetsRequest{AppId: "owner.app", SubjectUserId: "owner-user"}); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("ListVoiceAssets without owner context code=%v err=%v, want InvalidArgument", status.Code(err), err)
	}
	if _, err := svc.ListVoiceAssets(scenarioJobUserContext("intruder.app", "owner-user"), &runtimev1.ListVoiceAssetsRequest{AppId: "owner.app", SubjectUserId: "owner-user"}); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("ListVoiceAssets cross-app code=%v err=%v, want PermissionDenied", status.Code(err), err)
	}
	if _, err := svc.ListVoiceAssets(scenarioJobUserContext("owner.app", "intruder-user"), &runtimev1.ListVoiceAssetsRequest{AppId: "owner.app", SubjectUserId: "owner-user"}); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("ListVoiceAssets cross-user code=%v err=%v, want PermissionDenied", status.Code(err), err)
	}
	if _, err := svc.ListVoiceAssets(scenarioJobUserContext("owner.app", "owner-user"), &runtimev1.ListVoiceAssetsRequest{AppId: "owner.app", SubjectUserId: "owner-user"}); err != nil {
		t.Fatalf("ListVoiceAssets owner context: %v", err)
	}
	if _, err := svc.GetVoiceAsset(scenarioJobUserContext("owner.app", "owner-user"), &runtimev1.GetVoiceAssetRequest{VoiceAssetId: assetID}); err != nil {
		t.Fatalf("GetVoiceAsset owner context: %v", err)
	}
}

func TestVoiceAssetAnonymousOwnerAllowsSameAppMetadataContext(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))

	const assetID = "asset-anonymous-scope-1"
	svc.voiceAssets.assets[assetID] = &runtimev1.VoiceAsset{
		VoiceAssetId:  assetID,
		AppId:         "owner.app",
		SubjectUserId: anonymousScenarioJobOwner,
		Provider:      "local",
		Persistence:   runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_SESSION_EPHEMERAL,
		Status:        runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_ACTIVE,
	}

	if _, err := svc.GetVoiceAsset(scenarioJobContext("intruder.app"), &runtimev1.GetVoiceAssetRequest{VoiceAssetId: assetID}); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("GetVoiceAsset anonymous cross-app code=%v err=%v, want PermissionDenied", status.Code(err), err)
	}
	if _, err := svc.GetVoiceAsset(scenarioJobContext("owner.app"), &runtimev1.GetVoiceAssetRequest{VoiceAssetId: assetID}); err != nil {
		t.Fatalf("GetVoiceAsset anonymous owner app context: %v", err)
	}
	if _, err := svc.ListVoiceAssets(scenarioJobContext("owner.app"), &runtimev1.ListVoiceAssetsRequest{AppId: "owner.app", SubjectUserId: anonymousScenarioJobOwner}); err != nil {
		t.Fatalf("ListVoiceAssets anonymous owner app context: %v", err)
	}
	deleteResp, err := svc.DeleteVoiceAsset(scenarioJobContext("owner.app"), &runtimev1.DeleteVoiceAssetRequest{VoiceAssetId: assetID})
	if err != nil {
		t.Fatalf("DeleteVoiceAsset anonymous owner app context: %v", err)
	}
	if deleteResp.GetAck() == nil || !deleteResp.GetAck().GetOk() {
		t.Fatalf("delete anonymous voice asset ack must be ok")
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
	defer func() { server.Close() }()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"elevenlabs": {BaseURL: server.URL, APIKey: "test-key"},
		},
		AllowLoopbackEndpoint: true,
	})

	const assetID = "asset-elevenlabs-1"
	bindVoiceAssetDeleteTarget(t, svc, assetID, "elevenlabs", server.URL, "test-key")
	ctx := scenarioJobUserContext("nimi.desktop", "user-001")
	svc.voiceAssets.assets[assetID] = &runtimev1.VoiceAsset{
		VoiceAssetId:     assetID,
		AppId:            "nimi.desktop",
		SubjectUserId:    "user-001",
		Provider:         "elevenlabs",
		ProviderVoiceRef: "voice_123",
		Persistence:      runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_PROVIDER_PERSISTENT,
		Status:           runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_ACTIVE,
	}

	deleteResp, err := svc.DeleteVoiceAsset(ctx, &runtimev1.DeleteVoiceAssetRequest{VoiceAssetId: assetID})
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
	getAfterDelete, err := svc.GetVoiceAsset(ctx, &runtimev1.GetVoiceAssetRequest{VoiceAssetId: assetID})
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
	defer func() { server.Close() }()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"fish_audio": {BaseURL: server.URL, APIKey: "test-key"},
		},
		AllowLoopbackEndpoint: true,
	})

	const assetID = "asset-fish-1"
	bindVoiceAssetDeleteTarget(t, svc, assetID, "fish_audio", server.URL, "test-key")
	ctx := scenarioJobUserContext("nimi.desktop", "user-001")
	svc.voiceAssets.assets[assetID] = &runtimev1.VoiceAsset{
		VoiceAssetId:     assetID,
		AppId:            "nimi.desktop",
		SubjectUserId:    "user-001",
		Provider:         "fish_audio",
		ProviderVoiceRef: "model_123",
		Persistence:      runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_PROVIDER_PERSISTENT,
		Status:           runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_ACTIVE,
	}

	deleteResp, err := svc.DeleteVoiceAsset(ctx, &runtimev1.DeleteVoiceAssetRequest{VoiceAssetId: assetID})
	if err != nil {
		failedAsset, _ := svc.voiceAssets.getAsset(assetID)
		t.Fatalf("DeleteVoiceAsset: %v (method=%q path=%q provider_error=%q)", err, gotMethod, gotPath, failedAsset.GetMetadata().GetFields()["provider_delete_last_error"].GetStringValue())
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
	ctx := scenarioJobUserContext("nimi.desktop", "user-001")
	svc.voiceAssets.assets[assetID] = &runtimev1.VoiceAsset{
		VoiceAssetId:  assetID,
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
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

	if _, err := svc.DeleteVoiceAsset(ctx, &runtimev1.DeleteVoiceAssetRequest{VoiceAssetId: assetID}); err != nil {
		t.Fatalf("DeleteVoiceAsset(local): %v", err)
	}
	getAfterDelete, err := svc.GetVoiceAsset(ctx, &runtimev1.GetVoiceAssetRequest{VoiceAssetId: assetID})
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
	defer func() { server.Close() }()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"elevenlabs": {BaseURL: server.URL, APIKey: "test-key"},
		},
		AllowLoopbackEndpoint: true,
	})
	svc.audit = auditlog.New(128, 128)

	const assetID = "asset-elevenlabs-reconcile-1"
	bindVoiceAssetDeleteTarget(t, svc, assetID, "elevenlabs", server.URL, "test-key")
	ctx := scenarioJobUserContext("nimi.desktop", "user-001")
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

	if _, err := svc.DeleteVoiceAsset(ctx, &runtimev1.DeleteVoiceAssetRequest{VoiceAssetId: assetID}); status.Code(err) != codes.Unavailable {
		t.Fatalf("DeleteVoiceAsset(first retryable failure) code=%v err=%v, want Unavailable", status.Code(err), err)
	}
	firstDelete, err := svc.GetVoiceAsset(ctx, &runtimev1.GetVoiceAssetRequest{VoiceAssetId: assetID})
	if err != nil {
		t.Fatalf("GetVoiceAsset(after first delete): %v", err)
	}
	firstFields := firstDelete.GetAsset().GetMetadata().GetFields()
	if firstDelete.GetAsset().GetStatus() != runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_ACTIVE {
		t.Fatalf("provider delete failure must not locally delete asset, status=%v", firstDelete.GetAsset().GetStatus())
	}
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

	if _, err := svc.DeleteVoiceAsset(ctx, &runtimev1.DeleteVoiceAssetRequest{VoiceAssetId: assetID}); err != nil {
		t.Fatalf("DeleteVoiceAsset(second retry success): %v", err)
	}
	secondDelete, err := svc.GetVoiceAsset(ctx, &runtimev1.GetVoiceAssetRequest{VoiceAssetId: assetID})
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
	if len(events.GetEvents()) != 4 {
		t.Fatalf("expected 2 composition and 2 terminal delete audit events, got %d", len(events.GetEvents()))
	}
	var failedEvent *runtimev1.AuditEventRecord
	var successEvent *runtimev1.AuditEventRecord
	for _, event := range events.GetEvents() {
		switch event.GetOperation() {
		case "voice_asset.delete_failed":
			failedEvent = event
		case "voice_asset.delete":
			successEvent = event
		}
	}
	if failedEvent == nil || successEvent == nil {
		t.Fatalf("expected failed and success delete audit events, got=%v", events.GetEvents())
	}
	successPayload := successEvent.GetPayload().GetFields()
	if !successPayload["provider_delete_succeeded"].GetBoolValue() {
		t.Fatalf("expected successful delete audit to record success")
	}
	failedPayload := failedEvent.GetPayload().GetFields()
	if failedPayload["provider_delete_succeeded"].GetBoolValue() {
		t.Fatalf("expected first delete audit to record failure")
	}
	if !failedPayload["provider_delete_reconciliation_pending"].GetBoolValue() {
		t.Fatalf("expected first delete audit to record pending reconciliation")
	}
}

func TestListVoiceAssetsRetriesPendingVoiceDeleteReconciliation(t *testing.T) {
	var requestCount int
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requestCount++
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer func() { server.Close() }()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"elevenlabs": {BaseURL: server.URL, APIKey: "test-key"},
		},
		AllowLoopbackEndpoint: true,
	})
	svc.audit = auditlog.New(128, 128)

	const assetID = "asset-elevenlabs-list-reconcile-1"
	bindVoiceAssetDeleteTarget(t, svc, assetID, "elevenlabs", server.URL, "test-key")
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

	ctx := scenarioJobUserContext("nimi.desktop", "user-001")
	resp, err := svc.ListVoiceAssets(ctx, &runtimev1.ListVoiceAssetsRequest{
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
	defer func() { server.Close() }()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"elevenlabs": {BaseURL: server.URL, APIKey: "test-key"},
		},
		AllowLoopbackEndpoint: true,
	})

	const assetID = "asset-elevenlabs-cooldown-1"
	bindVoiceAssetDeleteTarget(t, svc, assetID, "elevenlabs", server.URL, "test-key")
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

	ctx := scenarioJobUserContext("nimi.desktop", "user-001")
	resp, err := svc.ListVoiceAssets(ctx, &runtimev1.ListVoiceAssetsRequest{
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
	defer func() { server.Close() }()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"elevenlabs": {BaseURL: server.URL, APIKey: "test-key"},
		},
		AllowLoopbackEndpoint: true,
	})
	svc.audit = auditlog.New(128, 128)

	const assetID = "asset-elevenlabs-exhausted-1"
	bindVoiceAssetDeleteTarget(t, svc, assetID, "elevenlabs", server.URL, "test-key")
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

	ctx := scenarioJobUserContext("nimi.desktop", "user-001")
	resp, err := svc.ListVoiceAssets(ctx, &runtimev1.ListVoiceAssetsRequest{
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

	resp, err = svc.ListVoiceAssets(ctx, &runtimev1.ListVoiceAssetsRequest{
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
	defer func() { server.Close() }()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"elevenlabs": {BaseURL: server.URL, APIKey: "test-key"},
		},
		AllowLoopbackEndpoint: true,
	})
	svc.audit = auditlog.New(128, 128)
	svc.voiceAssetDeleteReconciliationInterval = 10 * time.Millisecond

	const assetID = "asset-elevenlabs-loop-1"
	bindVoiceAssetDeleteTarget(t, svc, assetID, "elevenlabs", server.URL, "test-key")
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

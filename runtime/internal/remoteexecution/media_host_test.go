package remoteexecution

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestProviderMediaHostAuditsActualAlibabaCleanupOutcome(t *testing.T) {
	for _, outcome := range []string{"confirmed_canceled", "not_cancelable"} {
		t.Run(outcome, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			var polls, cancels atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch {
				case r.Method == http.MethodPost && r.URL.Path == "/api/v1/services/aigc/video-generation/video-synthesis":
					fmt.Fprint(w, `{"output":{"task_id":"private-task","task_status":"PENDING"}}`)
				case r.Method == http.MethodGet && r.URL.Path == "/api/v1/tasks/private-task":
					if polls.Add(1) == 1 {
						cancel()
						fmt.Fprint(w, `{"output":{"task_id":"private-task","task_status":"RUNNING"}}`)
					} else {
						fmt.Fprint(w, `{"output":{"task_id":"private-task","task_status":"CANCELED"}}`)
					}
				case r.Method == http.MethodPost && r.URL.Path == "/api/v1/tasks/private-task/cancel":
					cancels.Add(1)
					if outcome == "not_cancelable" {
						w.WriteHeader(http.StatusBadRequest)
						fmt.Fprint(w, `{"code":"UnsupportedOperation","message":"running task"}`)
					} else {
						fmt.Fprint(w, `{"request_id":"private-request"}`)
					}
				default:
					http.NotFound(w, r)
				}
			}))
			defer server.Close()
			store := connector.NewConnectorStoreWithSecretStore(t.TempDir(), &trackingSecretStore{values: map[string]string{}})
			record, err := store.Create(connector.ConnectorRecord{
				Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED, OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER,
				OwnerID: "account-a", Provider: "dashscope", Endpoint: server.URL, Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
			}, "cleanup-scoped-secret")
			if err != nil {
				t.Fatal(err)
			}
			raw, _ := structpb.NewStruct(map[string]any{"provider": "dashscope", "providerModelId": "wan2.7-t2v", "remoteModelCatalogId": "catalog-wan"})
			driver, target, err := capabilitydriver.NewProductionCloudMediaRegistry().Resolve(capabilitydriver.Identity{
				ImplementationID: "cloud.video.generate.dashscope", DriverID: "nimi.runtime.driver.dashscope", DriverDialect: "provider/media-v1",
			}, raw, "video.generate")
			if err != nil {
				t.Fatal(err)
			}
			mapped, err := driver.MapRequest(target, &runtimev1.SubmitScenarioJobRequest{
				ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE,
				Spec:         &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{Mode: runtimev1.VideoMode_VIDEO_MODE_T2V, Prompt: "A boat"}}},
			}, nil, capabilitydriver.CloudMediaStreamNone)
			if err != nil {
				t.Fatal(err)
			}
			audit := auditlog.New(16, 16)
			host := NewProviderMediaHost(store, nimillm.NewCloudProvider(nimillm.CloudConfig{HTTPTimeout: time.Second, AllowLoopbackEndpoint: true}), audit, true)
			_, err = host.ExecuteMedia(ctx, record, target, mapped, MediaDispatchAudit{AppID: "app", AccountID: "account-a", TraceID: "trace-cleanup", Provider: "dashscope", CapabilityContract: "video.generate"})
			if status.Code(err) != codes.Canceled || cancels.Load() != 1 {
				t.Fatalf("err=%v cancel requests=%d", err, cancels.Load())
			}
			events, err := audit.ListEvents(&runtimev1.ListAuditEventsRequest{})
			if err != nil {
				t.Fatal(err)
			}
			found := false
			for _, event := range events.GetEvents() {
				raw, _ := protojson.Marshal(event)
				for _, private := range []string{"cleanup-scoped-secret", "private-task", "private-request"} {
					if strings.Contains(string(raw), private) {
						t.Fatal("private provider state leaked into audit")
					}
				}
				if event.Operation == "remote_execution_host.media.canceled" {
					found = true
					fields := event.GetPayload().GetFields()
					if fields["provider_cleanup_outcome"].GetStringValue() != outcome || fields["provider_stop_guaranteed"].GetBoolValue() {
						t.Fatalf("cleanup audit=%s", raw)
					}
				}
			}
			if !found {
				t.Fatal("missing terminal Host cleanup audit")
			}
		})
	}
}

func TestProviderMediaHostOpensCredentialOnlyInsideDispatch(t *testing.T) {
	mp3, err := os.ReadFile("../nimillm/testdata/tone-24k.mp3")
	if err != nil {
		t.Fatal(err)
	}
	const secret = "media-host-scope-secret"
	var authorization string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/audio/speech" {
			http.NotFound(w, r)
			return
		}
		authorization = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write(mp3)
	}))
	defer server.Close()

	secrets := &trackingSecretStore{values: map[string]string{}}
	store := connector.NewConnectorStoreWithSecretStore(t.TempDir(), secrets)
	record, err := store.Create(connector.ConnectorRecord{
		Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED, OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER,
		OwnerID: "account-a", Provider: "openai", Endpoint: server.URL, Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}, secret)
	if err != nil {
		t.Fatal(err)
	}
	secrets.mu.Lock()
	secrets.reads = 0
	secrets.mu.Unlock()

	driver, target, mapped := remoteMediaHostDriverInput(t)
	audit := auditlog.New(16, 16)
	transport := nimillm.NewCloudProvider(nimillm.CloudConfig{HTTPTimeout: time.Second, AllowLoopbackEndpoint: true})
	host := NewProviderMediaHost(store, transport, audit, true)
	response, err := host.ExecuteMedia(context.Background(), record, target, mapped, MediaDispatchAudit{
		AppID: "app", AccountID: "account-a", TraceID: "trace-media", CapabilityContract: "audio.synthesize",
		ImplementationID: "cloud.audio.openai", DriverID: "driver.openai", DriverDialect: "provider/media-v1",
		ConnectorID: record.ConnectorID, Provider: "openai", ProviderModelID: "tts-1", RemoteModelCatalogID: "catalog-tts-1",
	})
	if err != nil {
		t.Fatalf("ExecuteMedia: %v", err)
	}
	result, err := driver.NormalizeResponse(response)
	if err != nil || len(result.Artifacts) != 1 || len(result.Artifacts[0].GetBytes()) != 0 ||
		string(result.ArtifactBodies[result.Artifacts[0].GetArtifactId()].BoundedBytes()) != string(mp3) {
		t.Fatalf("NormalizeResponse=%+v err=%v", result, err)
	}
	if authorization != "Bearer "+secret {
		t.Fatalf("authorization=%q", authorization)
	}
	secrets.mu.Lock()
	reads := secrets.reads
	secrets.mu.Unlock()
	if reads != 1 {
		t.Fatalf("credential reads=%d, want one dispatch-scoped read", reads)
	}
	events, err := audit.ListEvents(&runtimev1.ListAuditEventsRequest{})
	if err != nil || len(events.GetEvents()) != 2 {
		t.Fatalf("audit events=%+v err=%v", events, err)
	}
	for _, event := range events.GetEvents() {
		raw, _ := protojson.Marshal(event)
		if strings.Contains(string(raw), secret) {
			t.Fatalf("secret leaked to audit: %s", raw)
		}
		if got := event.GetPayload().GetFields()["polling_visibility"].GetStringValue(); got != "remote_host_private" {
			t.Fatalf("polling_visibility=%q", got)
		}
	}
}

func remoteMediaHostDriverInput(t *testing.T) (capabilitydriver.CloudMediaDriver, capabilitydriver.CloudMediaTarget, *capabilitydriver.CloudMediaMappedRequest) {
	t.Helper()
	rawTarget, _ := structpb.NewStruct(map[string]any{
		"provider": "openai", "providerModelId": "tts-1", "remoteModelCatalogId": "catalog-tts-1",
	})
	driver, target, err := capabilitydriver.NewProductionCloudMediaRegistry().Resolve(capabilitydriver.Identity{
		ImplementationID: "cloud.audio.openai", DriverID: "driver.openai", DriverDialect: "provider/media-v1",
	}, rawTarget, "audio.synthesize")
	if err != nil {
		t.Fatal(err)
	}
	mapped, err := driver.MapRequest(target, &runtimev1.SubmitScenarioJobRequest{
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{
			Text: "hello", VoiceRef: &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET, Reference: &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: "alloy"}},
		}}},
	}, nil, capabilitydriver.CloudMediaStreamNone)
	if err != nil {
		t.Fatal(err)
	}
	return driver, target, mapped
}

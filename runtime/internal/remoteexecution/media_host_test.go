package remoteexecution

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestProviderMediaHostOpensCredentialOnlyInsideDispatch(t *testing.T) {
	const secret = "media-host-scope-secret"
	var authorization string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/audio/speech" {
			http.NotFound(w, r)
			return
		}
		authorization = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = io.WriteString(w, "audio-bytes")
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
		string(result.ArtifactBodies[result.Artifacts[0].GetArtifactId()].BoundedBytes()) != "audio-bytes" {
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

package remoteexecution

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestMistralNativeSpeechStreamUsesFrozenAdapterThroughExecutionHost(t *testing.T) {
	audio, err := os.ReadFile("../nimillm/testdata/tone-24k.mp3")
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]any
		json.NewDecoder(r.Body).Decode(&payload)
		if r.URL.Path != "/v1/audio/speech" || r.Header.Get("Authorization") != "Bearer voice-fixture" || payload["voice_id"] != "voice_3142" || payload["voice"] != nil || payload["stream"] != true {
			t.Errorf("host used a generic dialect: %+v", payload)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		for _, chunk := range [][]byte{audio[:30], audio[30:]} {
			fmt.Fprintf(w, "data: {\"type\":\"speech.audio.delta\",\"audio_data\":\"%s\"}\n\n", base64.StdEncoding.EncodeToString(chunk))
		}
		fmt.Fprint(w, `data: {"type":"speech.audio.done","usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}`+"\n\n")
	}))
	defer server.Close()
	store := connector.NewConnectorStoreWithMemorySecrets(t.TempDir())
	record, err := store.Create(connector.ConnectorRecord{Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED, OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER, OwnerID: "account-a", Provider: "mistral", Endpoint: server.URL + "/v1", Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE}, "voice-fixture")
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := structpb.NewStruct(map[string]any{"provider": "mistral", "providerModelId": capabilitydriver.MistralVoxtralTTS3, "remoteModelCatalogId": "catalog-voxtral3"})
	driver, target, err := capabilitydriver.NewProductionCloudMediaRegistry().Resolve(capabilitydriver.Identity{ImplementationID: "cloud.audio.synthesize.mistral", DriverID: "nimi.runtime.driver.mistral", DriverDialect: "provider/media-v1"}, raw, "audio.synthesize")
	if err != nil {
		t.Fatal(err)
	}
	request := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "你好", AudioFormat: "mp3", VoiceRef: &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET, Reference: &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: "voice_3142"}}}}}}
	mapped, err := driver.MapRequest(target, request, nil, capabilitydriver.CloudMediaStreamNative)
	if err != nil {
		t.Fatal(err)
	}
	host := NewProviderMediaHost(store, nimillm.NewCloudProvider(nimillm.CloudConfig{AllowLoopbackEndpoint: true}), auditlog.New(16, 16), true)
	var received []byte
	result, err := host.StreamSpeech(context.Background(), record, target, mapped, func(chunk capabilitydriver.CloudMediaStreamChunk) error {
		if chunk.MIMEType != "audio/mpeg" || chunk.SampleRateHz != 24000 {
			t.Error("native audio facts lost")
		}
		received = append(received, chunk.Bytes...)
		return nil
	}, MediaDispatchAudit{AppID: "app", AccountID: "account-a", TraceID: "mistral-stream", CapabilityContract: "audio.synthesize", ImplementationID: "cloud.audio.synthesize.mistral", DriverID: "nimi.runtime.driver.mistral", DriverDialect: "provider/media-v1", ConnectorID: record.ConnectorID, Provider: "mistral", ProviderModelID: capabilitydriver.MistralVoxtralTTS3, RemoteModelCatalogID: "catalog-voxtral3"})
	if err != nil || !result.Streamed || !bytes.Equal(received, audio) || result.Usage.GetInputTokens() != 1 || result.FinishReason != runtimev1.FinishReason_FINISH_REASON_STOP {
		t.Fatalf("host native stream %+v %v", result, err)
	}
}

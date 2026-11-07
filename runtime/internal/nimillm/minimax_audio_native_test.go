package nimillm

import (
	"context"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

func TestMiniMaxNativeAudioEnvelopeRejectsIncompleteOrInvalidBodies(t *testing.T) {
	for _, body := range []string{`{}`, `{"base_resp":{"status_code":1004},"data":{"status":2,"audio":"0000"}}`, `{"base_resp":{"status_code":0},"data":{"status":1,"audio":"0000"}}`, `{"base_resp":{"status_code":0},"data":{"status":2,"audio":"not-hex"}}`, `{"base_resp":{"status_code":0},"model":"other","data":{"status":2,"audio":"0000"}}`} {
		if _, _, err := readMiniMaxAudio(&http.Response{Body: io.NopCloser(strings.NewReader(body))}, "speech-2.8-hd"); err == nil {
			t.Fatal("native failure accepted", body)
		}
	}
	data, _, err := readMiniMaxAudio(&http.Response{Body: io.NopCloser(strings.NewReader(`{"base_resp":{"status_code":0},"data":{"status":2,"audio":"01020304"}}`))}, "speech-2.8-hd")
	if err != nil || hex.EncodeToString(data) != "01020304" {
		t.Fatal(data, err)
	}
}
func TestMiniMaxFiniteSpeechUsesNativeFieldsAndSingleCapturedEndpoint(t *testing.T) {
	calls := 0
	status := 200
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/proxy/anthropic/v1/t2a_v2" || r.Header.Get("Authorization") != "Bearer key" || r.Header.Get("Anthropic-Version") != "" {
			t.Error("captured path/auth")
		}
		b := decodeMusicJSONBody(t, r)
		voice := b["voice_setting"].(map[string]any)
		if b["text"] != "  original text\n" || b["input"] != nil || b["stream"] != false || b["output_format"] != "hex" || voice["voice_id"] != "male-qn-qingse" || voice["voice"] != nil || voice["volume"] != nil || voice["vol"] != float64(1) || voice["pitch"] != float64(0) || b["language_boost"] != "Chinese" {
			t.Error("native fields", b)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		fmt.Fprint(w, `{"base_resp":{"status_code":0},"data":{"status":2,"audio":"01020304"},"extra_info":{"audio_size":4,"audio_sample_rate":32000,"audio_channel":1,"usage_characters":19}}`)
	}))
	defer server.Close()
	request := &runtimev1.SubmitScenarioJobRequest{Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "  original text\n", Language: "zh", AudioFormat: "pcm", SampleRateHz: proto.Int32(32000), Volume: proto.Float32(1), Pitch: proto.Float32(0), VoiceRef: &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET, Reference: &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: "male-qn-qingse"}}}}}}
	cfg := MediaAdapterConfig{BaseURL: server.URL + "/proxy/anthropic/v1", APIKey: "key", AllowLoopbackEndpoint: true}
	a, u, _, err := ExecuteMiniMaxSpeech(context.Background(), cfg, request, "speech-2.8-hd")
	if err != nil || len(a) != 1 || a[0].SampleRateHz != 32000 || u != nil {
		t.Fatal(a, u, err)
	}
	status = 404
	if _, _, _, err := ExecuteMiniMaxSpeech(context.Background(), cfg, request, "speech-2.8-hd"); err == nil || calls != 2 {
		t.Fatal("wrong endpoint retried or succeeded", err, calls)
	}
}

func TestMiniMaxProbeReadsSystemVoicesWithoutGeneration(t *testing.T) {
	calls := 0
	body := `{"system_voice":[],"base_resp":{"status_code":0}}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/proxy/anthropic/v1/get_voice" || r.Method != "POST" || r.Header.Get("Authorization") != "Bearer key" || r.Header.Get("Anthropic-Version") != "" {
			t.Error("unexpected probe request")
		}
		b := decodeMusicJSONBody(t, r)
		if b["voice_type"] != "system" || len(b) != 1 {
			t.Error("non-read-only body")
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, body)
	}))
	defer server.Close()
	p := &CloudProvider{allowLoopbackEndpoint: true}
	if err := p.ProbeConnector(context.Background(), "minimax", server.URL+"/proxy/anthropic/v1", "key", nil); err != nil || calls != 1 {
		t.Fatal(err, calls)
	}
	body = `{"system_voice":[],"base_resp":{"status_code":1004}}`
	if err := p.ProbeConnector(context.Background(), "minimax", server.URL+"/proxy/anthropic/v1", "key", nil); err == nil || calls != 2 {
		t.Fatal("business auth failure hidden", err, calls)
	}
	body = `{"base_resp":{"status_code":0}}`
	if err := p.ProbeConnector(context.Background(), "minimax", server.URL+"/proxy/anthropic/v1", "key", nil); err == nil || calls != 3 {
		t.Fatal("wrong native shape accepted", err, calls)
	}
}

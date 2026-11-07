package nimillm

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"google.golang.org/protobuf/proto"
)

func TestOpenSpeechSSERequiresNativeFinishAndCompleteData(t *testing.T) {
	audio := []byte{1, 2, 3, 4}
	start := fmt.Sprintf("event: 352\ndata: {\"code\":0,\"data\":\"%s\"}\n\n", base64.StdEncoding.EncodeToString(audio))
	finish := "event: 152\ndata: {\"code\":20000000,\"data\":null,\"usage\":{\"text_words\":19}}\n\n"
	got, err := readOpenSpeechSSE(strings.NewReader(start + finish))
	if err != nil || !bytes.Equal(got, audio) {
		t.Fatal(got, err)
	}
	for name, data := range map[string]string{"no finish": start, "no data": finish, "bad code": start + "event: 153\ndata: {\"code\":55000000}\n\n", "cancel": start + "event: 151\ndata: {\"code\":0}\n\n", "after finish": start + finish + start, "bad base64": "event: 352\ndata: {\"code\":0,\"data\":\"?\"}\n\n" + finish, "bad finish event": start + "event: 352\ndata: {\"code\":20000000}\n\n"} {
		t.Run(name, func(t *testing.T) {
			if _, err := readOpenSpeechSSE(strings.NewReader(data)); err == nil {
				t.Fatal("incomplete provider response became audio")
			}
		})
	}
}
func TestOpenSpeechTranscriptNativeTimesAndSilence(t *testing.T) {
	body := []byte(`{"audio_info":{"duration":99999},"result":{"text":"你好。","utterances":[{"words":[{"text":"你","start_time":0,"end_time":200},{"text":"好","start_time":200,"end_time":400}]}]}}`)
	r, err := parseOpenSpeechTranscript(body, "20000000", true, 1)
	if err != nil || r.Text != "你好。" || len(r.Words) != 2 || r.Words[1].EndSeconds != .4 || r.Language != "" || r.Diarization != nil {
		t.Fatal(r, err)
	}
	if _, err := parseOpenSpeechTranscript(body, "20000000", true, .3); err == nil {
		t.Fatal("native alignment outside actual source")
	}
	silent, err := parseOpenSpeechTranscript([]byte(`{}`), "20000003", true, 1)
	if err != nil || silent.Status != runtimev1.SpeechTranscriptStatus_SPEECH_TRANSCRIPT_STATUS_NO_SPEECH {
		t.Fatal(silent, err)
	}
	for _, code := range []string{"", "0", "45000001", "55000031", "20000003"} {
		if _, err := parseOpenSpeechTranscript(body, code, true, 1); err == nil {
			t.Fatal("provider status contradicted output", code)
		}
	}
	if _, err := parseOpenSpeechTranscript([]byte(`{"result":{"text":"hello"}}`), "20000000", true, 1); err == nil {
		t.Fatal("fabricated alignment")
	}
}
func TestOpenSpeechNewConsoleHeaderAndCapturedPrefix(t *testing.T) {
	for _, suffix := range []string{"/proxy", "/proxy/api/v1", "/proxy/v1", "/proxy/anthropic"} {
		t.Run(suffix, func(t *testing.T) {
			prefix := strings.TrimSuffix(suffix, "/api/v1")
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.URL.Path != prefix+"/api/v3/tts/unidirectional/sse" || r.Header.Get("X-Api-Key") != "key" || r.Header.Get("Authorization") != "" || r.Header.Get("X-Api-App-Key") != "" || r.Header.Get("Anthropic-Version") != "" || r.Header.Get("X-Api-Resource-Id") != "seed-tts-2.0" || len(r.Header.Get("X-Api-Request-Id")) != 36 {
					t.Errorf("native auth/path %s", r.URL.Path)
				}
				var b map[string]any
				_ = json.NewDecoder(r.Body).Decode(&b)
				p := b["req_params"].(map[string]any)
				if p["text"] != " 你好\n" || p["speaker"] != "zh_female_vv_uranus_bigtts" || p["audio_params"].(map[string]any)["speech_rate"] != float64(-50) || p["additions"] != `{"explicit_language":"zh-cn"}` || b["model"] != nil {
					t.Error("native request", b)
				}
				w.Header().Set("Content-Type", "text/event-stream")
				_, _ = fmt.Fprint(w, "event: 352\ndata: {\"code\":0,\"data\":\"AQIDBA==\"}\n\nevent: 152\ndata: {\"code\":20000000,\"data\":null}\n\n")
			}))
			defer server.Close()
			req := &runtimev1.SubmitScenarioJobRequest{Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{Text: " 你好\n", Language: "zh", AudioFormat: "pcm", SampleRateHz: proto.Int32(24000), Speed: proto.Float32(.5), VoiceRef: &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET, Reference: &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: capabilitydriver.OpenSpeechVoices("seed-tts-2.0")[0]}}}}}}
			artifacts, usage, _, err := ExecuteBytedanceOpenSpeech(context.Background(), MediaAdapterConfig{BaseURL: server.URL + suffix, APIKey: "key", AllowLoopbackEndpoint: true}, req, "seed-tts-2.0")
			if err != nil || calls != 1 || usage != nil || len(artifacts) != 1 || artifacts[0].SampleRateHz != 24000 || artifacts[0].Channels != 1 {
				t.Fatal(err, artifacts)
			}
		})
	}
}

func TestOpenSpeechDoesNotInventFreeAuthenticationProbe(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; w.WriteHeader(200) }))
	defer server.Close()
	p := &CloudProvider{allowLoopbackEndpoint: true}
	err := p.ProbeConnector(context.Background(), "volcengine_openspeech", server.URL, "key", nil)
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED || calls != 0 {
		t.Fatal("unsupported read-only check dispatched or succeeded", err, calls)
	}
}

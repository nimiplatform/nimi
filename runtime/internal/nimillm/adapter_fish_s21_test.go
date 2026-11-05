package nimillm

import (
	"bytes"
	"context"
	"encoding/json"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestFishS21PreservesTextAndExactTier(t *testing.T) {
	for _, model := range []string{"s2.1-pro", "s2.1-pro-free"} {
		t.Run(model, func(t *testing.T) {
			const text = "  [whispers sweetly]你好，🌧\n保留末尾空格。 "
			wav := testGeminiTTSWAV()
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
					return
				}
				if r.URL.Path != "/v1/tts" || r.Header.Get("model") != model || r.Header.Get("Authorization") != "Bearer fish-test" || body["text"] != text || body["reference_id"] != "voice-123" || body["format"] != "wav" || body["sample_rate"] != float64(24000) || body["prosody"].(map[string]any)["speed"] != 1.5 {
					t.Errorf("request mismatch: %s %v", r.URL.Path, body)
				}
				w.Header().Set("Content-Type", "audio/wav")
				_, _ = w.Write(wav)
			}))
			defer server.Close()
			spec := &runtimev1.SpeechSynthesizeScenarioSpec{Text: text, AudioFormat: "WAV", SampleRateHz: proto.Int32(24000), Speed: proto.Float32(1.5), VoiceRef: &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF, Reference: &runtimev1.VoiceReference_ProviderVoiceRef{ProviderVoiceRef: "voice-123"}}}
			req := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: spec}}}
			artifacts, usage, _, err := ExecuteFishAudioTTS(context.Background(), MediaAdapterConfig{BaseURL: server.URL, APIKey: "fish-test", AllowLoopbackEndpoint: true}, req, model)
			if err != nil || len(artifacts) != 1 || !bytes.Equal(artifacts[0].GetBytes(), wav) || usage != nil {
				t.Fatalf("artifact/usage mismatch: %v %v", artifacts, err)
			}
		})
	}
}

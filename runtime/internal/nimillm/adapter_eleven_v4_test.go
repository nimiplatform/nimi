package nimillm

import (
	"bytes"
	"context"
	"encoding/json"
	"google.golang.org/protobuf/proto"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestElevenV4RequestsWAVContainerAndExactModel(t *testing.T) {
	for _, model := range []string{"eleven_v4", "eleven_v4_turbo"} {
		t.Run(model, func(t *testing.T) {
			const text = "  [whispers]你好，世界。\n "
			wav := testGeminiTTSWAV()
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
					return
				}
				if r.URL.Path != "/v1/text-to-speech/voice-1" || r.URL.Query().Get("output_format") != "wav_24000" || r.Header.Get("xi-api-key") != "eleven-test" || r.Header.Get("Authorization") != "" || body["model_id"] != model || body["text"] != text || body["voice_settings"].(map[string]any)["speed"] != 1.1 {
					t.Errorf("request=%s %+v", r.URL, body)
				}
				w.Header().Set("Content-Type", "audio/wav")
				_, _ = w.Write(wav)
			}))
			defer server.Close()
			req := newTTSSecurityJob(text, "voice-1")
			s := req.GetSpec().GetSpeechSynthesize()
			s.AudioFormat = "wav"
			s.SampleRateHz = proto.Int32(24000)
			s.Speed = proto.Float32(1.1)
			artifacts, usage, _, err := ExecuteElevenLabsTTS(context.Background(), MediaAdapterConfig{BaseURL: server.URL, APIKey: "eleven-test", AllowLoopbackEndpoint: true}, req, model)
			if err != nil || len(artifacts) != 1 || !bytes.Equal(artifacts[0].GetBytes(), wav) || usage != nil {
				t.Fatalf("result=%v %v", artifacts, err)
			}
		})
	}
}

func TestElevenOutputFormatUsesPublishedCodecRateNames(t *testing.T) {
	for _, tc := range []struct {
		format string
		rate   int32
		want   string
	}{
		{"wav", 44100, "wav_44100"}, {"pcm", 16000, "pcm_16000"}, {"ogg", 48000, "opus_48000_128"}, {"mp3", 24000, "mp3_24000_48"}, {"mp3", 32000, ""},
	} {
		s := newTTSSecurityJob("text", "voice").GetSpec().GetSpeechSynthesize()
		s.AudioFormat = tc.format
		s.SampleRateHz = proto.Int32(tc.rate)
		if got := resolveElevenLabsOutputFormat(s); got != tc.want {
			t.Errorf("%s %d: %s", tc.format, tc.rate, got)
		}
	}
}

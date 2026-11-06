package nimillm

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

func googleTTSTestRequest(format string, rate int32) *runtimev1.SubmitScenarioJobRequest {
	return &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{
		Text: "  Hello, Nimi.  ", Language: "en-US", AudioFormat: format, SampleRateHz: proto.Int32(rate),
		VoiceRef: &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET, Reference: &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: "Kore"}},
	}}}}
}

func TestGoogleCloudTTSNativeJSONKeepsExactModelVoiceAndText(t *testing.T) {
	for _, model := range []string{"chirp-3-hd", "gemini-2.5-flash-tts", "gemini-2.5-pro-tts", "gemini-2.5-flash-lite-preview-tts", "gemini-3.1-flash-tts-preview"} {
		t.Run(model, func(t *testing.T) {
			var captured map[string]any
			audio := testGeminiTTSWAV()
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "POST" || r.URL.Path != "/v1/text:synthesize" || r.Header.Get("Authorization") != "Bearer fixture" || r.Header.Get("X-Goog-User-Project") != "test-project" {
					t.Errorf("native request route/auth")
				}
				if err := json.NewDecoder(r.Body).Decode(&captured); err != nil {
					t.Error(err)
				}
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(map[string]string{"audioContent": base64.StdEncoding.EncodeToString(audio)})
			}))
			defer server.Close()
			req := googleTTSTestRequest("wav", 24000)
			s := req.GetSpec().GetSpeechSynthesize()
			if model == "chirp-3-hd" {
				s.VoiceRef.GetReference().(*runtimev1.VoiceReference_PresetVoiceId).PresetVoiceId = "en-US-Chirp3-HD-Kore"
				s.Speed = proto.Float32(.5)
			} else {
				s.Emotion = "Speak warmly."
			}
			out, usage, _, err := ExecuteGoogleCloudTTS(context.Background(), MediaAdapterConfig{BaseURL: server.URL, APIKey: "fixture", Headers: map[string]string{"X-Goog-User-Project": "test-project"}, AllowLoopbackEndpoint: true}, req, model)
			if err != nil || len(out) != 1 || !bytes.Equal(out[0].GetBytes(), audio) || out[0].GetSampleRateHz() != 24000 || out[0].GetChannels() != 1 || out[0].GetDurationMs() != 100 || usage != nil {
				t.Fatalf("native result = %v %v %v", out, usage, err)
			}
			voice, input, config := captured["voice"].(map[string]any), captured["input"].(map[string]any), captured["audioConfig"].(map[string]any)
			if input["text"] != s.GetText() || voice["name"] != scenarioVoiceRef(s) || config["audioEncoding"] != "LINEAR16" || config["sampleRateHertz"] != float64(24000) {
				t.Fatalf("changed captured fields: %#v", captured)
			}
			if model == "chirp-3-hd" {
				if _, ok := voice["modelName"]; ok || config["speakingRate"] != .5 {
					t.Fatal(captured)
				}
			} else if voice["modelName"] != model || input["prompt"] != "Speak warmly." {
				t.Fatal(captured)
			}
		})
	}
}

func TestGoogleCloudTTSRejectsMissingMalformedAndMismatchedNativeAudio(t *testing.T) {
	for _, response := range []any{map[string]string{"audio": base64.StdEncoding.EncodeToString(testGeminiTTSWAV())}, map[string]string{"audioContent": "!invalid!"}, map[string]string{"audioContent": base64.StdEncoding.EncodeToString([]byte("not audio"))}, map[string]string{"audioContent": base64.StdEncoding.EncodeToString(testGeminiTTSWAV())}} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(response)
		}))
		out, _, _, err := ExecuteGoogleCloudTTS(context.Background(), MediaAdapterConfig{BaseURL: server.URL, APIKey: "fixture", AllowLoopbackEndpoint: true}, googleTTSTestRequest("wav", 16000), "gemini-3.1-flash-tts-preview")
		server.Close()
		if err == nil || len(out) != 0 {
			t.Fatalf("invalid audio accepted: %v", response)
		}
	}
}

func TestGoogleCloudTTSNativeCodecFiles(t *testing.T) {
	dir := os.Getenv("NIMI_TEST_FFMPEG_DIR")
	if dir == "" {
		t.Skip("actual codec fixture requires NIMI_TEST_FFMPEG_DIR")
	}
	ffmpeg := filepath.Join(dir, "ffmpeg.exe")
	if _, err := os.Stat(ffmpeg); err != nil {
		ffmpeg = filepath.Join(dir, "ffmpeg")
	}
	for _, tc := range []struct {
		format, codec, mux, mime string
		rate                     int32
	}{
		{"mp3", "libmp3lame", "mp3", "audio/mpeg", 24000}, {"wav", "pcm_s16le", "wav", "audio/wav", 24000},
		{"ogg", "libopus", "ogg", "audio/ogg", 48000}, {"pcm", "pcm_s16le", "s16le", "audio/pcm", 24000},
		{"mulaw", "pcm_mulaw", "wav", "audio/wav", 24000}, {"alaw", "pcm_alaw", "wav", "audio/wav", 24000},
	} {
		t.Run(tc.format, func(t *testing.T) {
			file := filepath.Join(t.TempDir(), "audio.bin")
			args := []string{"-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.4", "-ac", "1", "-ar", strconv.FormatInt(int64(tc.rate), 10), "-c:a", tc.codec, "-f", tc.mux, file}
			if output, err := exec.Command(ffmpeg, args...).CombinedOutput(); err != nil {
				t.Fatalf("encode: %v %s", err, output)
			}
			audio, err := os.ReadFile(file)
			if err != nil {
				t.Fatal(err)
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(map[string]string{"audioContent": base64.StdEncoding.EncodeToString(audio)})
			}))
			defer server.Close()
			out, _, _, err := ExecuteGoogleCloudTTS(context.Background(), MediaAdapterConfig{BaseURL: server.URL, APIKey: "fixture", AllowLoopbackEndpoint: true}, googleTTSTestRequest(tc.format, tc.rate), "gemini-3.1-flash-tts-preview")
			if err != nil || len(out) != 1 || out[0].GetMimeType() != tc.mime || out[0].GetSampleRateHz() != tc.rate || out[0].GetDurationMs() < 390 || !bytes.Equal(out[0].GetBytes(), audio) {
				t.Fatalf("encoded result = %v %v", out, err)
			}
			if tc.format == "ogg" {
				audio[len(audio)-1] ^= 1
				if _, _, _, err := inspectNativeSpeechOgg(context.Background(), audio, "ogg_opus"); err == nil {
					t.Fatal("corrupt Ogg page accepted")
				}
			}
		})
	}
}

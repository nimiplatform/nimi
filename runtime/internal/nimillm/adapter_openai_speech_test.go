package nimillm

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/protobuf/proto"
)

func openAISpeechTestJob(speed *float32) *runtimev1.SubmitScenarioJobRequest {
	return &runtimev1.SubmitScenarioJobRequest{
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{
			Text:     " 你好，欢迎使用 Nimi。 ",
			Language: "zh",
			Speed:    speed,
			VoiceRef: &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET, Reference: &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: "coral"}},
		}}},
	}
}

func TestOpenAISpeechSendsOnlyEndpointFields(t *testing.T) {
	mp3, err := os.ReadFile("testdata/tone-24k.mp3")
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name  string
		speed *float32
		want  map[string]any
	}{
		{name: "default speed", want: map[string]any{"model": "gpt-4o-mini-tts", "input": "你好，欢迎使用 Nimi。", "voice": "coral", "response_format": "mp3"}},
		{name: "explicit speed", speed: proto.Float32(1.5), want: map[string]any{"model": "gpt-4o-mini-tts", "input": "你好，欢迎使用 Nimi。", "voice": "coral", "response_format": "mp3", "speed": 1.5}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var body map[string]any
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodPost || r.URL.Path != "/v1/audio/speech" || r.Header.Get("Authorization") != "Bearer test-key" {
					http.NotFound(w, r)
					return
				}
				raw, _ := io.ReadAll(r.Body)
				_ = json.Unmarshal(raw, &body)
				w.Header().Set("Content-Type", "audio/mpeg")
				_, _ = w.Write(mp3)
			}))
			defer server.Close()

			provider, target := openAITranscriptionTestTarget(server.URL, "gpt-4o-mini-tts")
			artifacts, usage, _, err := provider.executeOpenAISpeech(context.Background(), openAISpeechTestJob(tc.speed), "gpt-4o-mini-tts", target)
			if err != nil {
				t.Fatalf("executeOpenAISpeech: %v", err)
			}
			if !reflect.DeepEqual(body, tc.want) {
				t.Fatalf("body = %v, want %v", body, tc.want)
			}
			if len(artifacts) != 1 || artifacts[0].GetMimeType() != "audio/mpeg" || string(artifacts[0].GetBytes()) != string(mp3) || usage != nil {
				t.Fatalf("artifacts=%+v usage=%+v", artifacts, usage)
			}
		})
	}
}

func TestOpenAISpeechRejectsAudioThatIsNotMP3(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write([]byte("RIFF\x24\x00\x00\x00WAVEfmt "))
	}))
	defer server.Close()

	provider, target := openAITranscriptionTestTarget(server.URL, "gpt-4o-mini-tts")
	_, _, _, err := provider.executeOpenAISpeech(context.Background(), openAISpeechTestJob(nil), "gpt-4o-mini-tts", target)
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
		t.Fatalf("a non-MP3 body must be invalid output: reason=%v present=%v err=%v", reason, ok, err)
	}
}

func TestOpenAISpeechRequiresCompleteDecodedAudio(t *testing.T) {
	valid, err := os.ReadFile("testdata/tone-24k.mp3")
	if err != nil {
		t.Fatal(err)
	}
	for name, payload := range map[string][]byte{
		"ID3 without frames":     []byte("ID3\x04\x00\x00\x00\x00\x00\x00"),
		"frame header only":      {0xFF, 0xF3, 0x44, 0xC4},
		"truncated first frame":  valid[:60],
		"truncated final frame":  valid[:len(valid)-1],
		"truncated final header": valid[:len(valid)-95],
		"oversized ID3 tag":      []byte("ID3\x04\x00\x00\x7f\x7f\x7f\x7f"),
	} {
		t.Run(name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				_, _ = w.Write(payload)
			}))
			defer server.Close()
			provider, target := openAITranscriptionTestTarget(server.URL, "gpt-4o-mini-tts")
			artifacts, _, _, err := provider.executeOpenAISpeech(context.Background(), openAISpeechTestJob(nil), "gpt-4o-mini-tts", target)
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_OUTPUT_INVALID || len(artifacts) != 0 {
				t.Fatalf("invalid MP3 artifacts=%v reason=%v err=%v", artifacts, reason, err)
			}
		})
	}
}

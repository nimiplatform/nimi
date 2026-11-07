package nimillm

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/textwire"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

func TestGroqWhisperUploadsOtherNativeContainersWithoutChangingBytes(t *testing.T) {
	dir := os.Getenv("NIMI_TEST_FFMPEG_DIR")
	if dir == "" {
		t.Skip("actual codec fixture requires NIMI_TEST_FFMPEG_DIR")
	}
	ffmpeg := filepath.Join(dir, "ffmpeg.exe")
	if _, err := os.Stat(ffmpeg); err != nil {
		ffmpeg = filepath.Join(dir, "ffmpeg")
	}
	for _, tc := range []struct{ mime, codec, mux, extension string }{{"audio/mp4", "aac", "ipod", "m4a"}, {"audio/webm", "libopus", "webm", "webm"}, {"audio/flac", "flac", "flac", "flac"}, {"audio/ogg", "libvorbis", "ogg", "ogg"}} {
		t.Run(tc.mime, func(t *testing.T) {
			file := filepath.Join(t.TempDir(), "audio."+tc.extension)
			if output, err := exec.Command(ffmpeg, "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.4", "-ac", "1", "-ar", "16000", "-c:a", tc.codec, "-f", tc.mux, file).CombinedOutput(); err != nil {
				t.Fatalf("encode: %v %s", err, output)
			}
			audio, err := os.ReadFile(file)
			if err != nil {
				t.Fatal(err)
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if err := r.ParseMultipartForm(1 << 20); err != nil {
					t.Error(err)
				}
				upload, header, err := r.FormFile("file")
				if err != nil {
					t.Error(err)
					w.WriteHeader(400)
					return
				}
				defer func(cleanup func() error) { _ = cleanup() }(upload.Close)
				var received bytes.Buffer
				_, _ = received.ReadFrom(upload)
				if !bytes.Equal(received.Bytes(), audio) || header.Filename != "recording."+tc.extension {
					t.Error("recording was changed or mislabeled")
				}
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(map[string]any{"text": "Hello.", "language": "english", "duration": .4, "words": []any{map[string]any{"word": "Hello.", "start": .05, "end": .3}}})
			}))
			defer server.Close()
			model := "whisper-large-v3-turbo"
			p := NewCloudProvider(CloudConfig{})
			target := &RemoteTarget{ProviderType: "groq", ProviderModelID: model, Endpoint: server.URL + "/openai/v1", APIKey: "fixture", AllowLoopback: true}
			req := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechTranscribe{SpeechTranscribe: &runtimev1.SpeechTranscribeScenarioSpec{MimeType: tc.mime, Timestamps: proto.Bool(true), AudioSource: &runtimev1.SpeechTranscriptionAudioSource{Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{AudioBytes: audio}}}}}}
			out, usage, _, err := p.executeGroqTranscriptions(context.Background(), req, model, target)
			if err != nil || len(out) != 1 || usage != nil {
				t.Fatalf("container transcription %v %v", out, err)
			}
		})
	}
}

func TestGroqBaseTextKeepsNativeVersionAfterOpenAIPrefix(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/proxy/openai/v1/chat/completions" {
			t.Errorf("wrong Groq route %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"OK"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}`))
	}))
	defer server.Close()
	p := NewCloudProvider(CloudConfig{})
	spec := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "Hello"}}}
	target := &RemoteTarget{ProviderType: "groq", ProviderModelID: "llama-3.3-70b-versatile", Endpoint: server.URL + "/proxy/openai/v1", APIKey: "fixture", AllowLoopback: true}
	text, _, _, _, err := p.GenerateTextScenarioWithTarget(context.Background(), target.ProviderModelID, spec, "", target, textwire.Directives{})
	if err != nil || text != "OK" {
		t.Fatalf("base text %q %v", text, err)
	}
}

func TestGroqOrpheusNativeWAVAndExactModel(t *testing.T) {
	for _, model := range []string{"canopylabs/orpheus-v1-english", "canopylabs/orpheus-arabic-saudi"} {
		t.Run(model, func(t *testing.T) {
			audio := testGeminiTTSWAV()
			voice := "hannah"
			if model == "canopylabs/orpheus-arabic-saudi" {
				voice = "noura"
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body map[string]any
				_ = json.NewDecoder(r.Body).Decode(&body)
				if r.URL.Path != "/proxy/openai/v1/audio/speech" || body["model"] != model || body["voice"] != voice || body["input"] != "  Hello, Nimi.  " || body["response_format"] != "wav" || body["sample_rate"] != nil || body["speed"] != nil {
					t.Errorf("native speech: %s %v", r.URL.Path, body)
				}
				w.Header().Set("Content-Type", "audio/wav")
				_, _ = w.Write(audio)
			}))
			defer server.Close()
			p := NewCloudProvider(CloudConfig{})
			target := &RemoteTarget{ProviderType: "groq", ProviderModelID: model, Endpoint: server.URL + "/proxy/openai/v1", APIKey: "fixture", AllowLoopback: true}
			req := googleTTSTestRequest("wav", 24000)
			req.GetSpec().GetSpeechSynthesize().SampleRateHz = nil
			req.GetSpec().GetSpeechSynthesize().VoiceRef = &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET, Reference: &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: voice}}
			out, usage, _, err := p.executeGroqSpeech(context.Background(), req, model, target)
			if err != nil || len(out) != 1 || !bytes.Equal(out[0].GetBytes(), audio) || out[0].GetSampleRateHz() != 24000 || usage != nil {
				t.Fatalf("native result %v %v", out, err)
			}
		})
	}
}

func TestGroqWhisperUsesNativeUploadAndReportedWords(t *testing.T) {
	for _, model := range []string{"whisper-large-v3", "whisper-large-v3-turbo"} {
		for _, timestamps := range []bool{false, true} {
			t.Run(model+"/"+map[bool]string{false: "plain", true: "words"}[timestamps], func(t *testing.T) {
				audio := testGeminiTTSWAV()
				badTiming := false
				reportedLanguage := true
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if r.URL.Path != "/proxy/openai/v1/audio/transcriptions" {
						t.Error(r.URL.Path)
					}
					if err := r.ParseMultipartForm(1 << 20); err != nil {
						t.Error(err)
					}
					if r.FormValue("model") != model || r.FormValue("response_format") != "verbose_json" || r.FormValue("language") != "zh" || r.FormValue("prompt") != "  Nimi  " {
						t.Error(r.Form)
					}
					if (r.FormValue("timestamp_granularities[]") == "word") != timestamps {
						t.Error(r.Form)
					}
					result := map[string]any{"text": "  Hello.  ", "duration": .1}
					if reportedLanguage {
						result["language"] = "english"
					}
					if timestamps {
						end := .08
						if badTiming {
							end = 10
						}
						result["words"] = []any{map[string]any{"word": "Hello.", "start": .01, "end": end}}
					}
					w.Header().Set("Content-Type", "application/json")
					_ = json.NewEncoder(w).Encode(result)
				}))
				defer server.Close()
				p := NewCloudProvider(CloudConfig{})
				target := &RemoteTarget{ProviderType: "groq", ProviderModelID: model, Endpoint: server.URL + "/proxy/openai/v1", APIKey: "fixture", AllowLoopback: true}
				req := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechTranscribe{SpeechTranscribe: &runtimev1.SpeechTranscribeScenarioSpec{MimeType: "audio/wav", Language: "zh", Prompt: "  Nimi  ", Timestamps: proto.Bool(timestamps), AudioSource: &runtimev1.SpeechTranscriptionAudioSource{Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{AudioBytes: audio}}}}}}
				out, usage, _, err := p.executeGroqTranscriptions(context.Background(), req, model, target)
				if err != nil || len(out) != 1 || usage != nil {
					t.Fatalf("native ASR %v %v", out, err)
				}
				var transcript runtimev1.SpeechTranscript
				if err := protojson.Unmarshal(out[0].GetBytes(), &transcript); err != nil || transcript.GetLanguage() != "en" || transcript.GetText() != "Hello." || (len(transcript.GetWords()) == 1) != timestamps {
					t.Fatalf("native transcript %v %v", &transcript, err)
				}
				reportedLanguage = false
				out, _, _, err = p.executeGroqTranscriptions(context.Background(), req, model, target)
				if err != nil {
					t.Fatal(err)
				}
				if err := protojson.Unmarshal(out[0].GetBytes(), &transcript); err != nil || transcript.GetLanguage() != "" {
					t.Fatal("language hint fabricated a detection", err)
				}
				if timestamps {
					badTiming = true
					if out, _, _, err := p.executeGroqTranscriptions(context.Background(), req, model, target); err == nil || len(out) != 0 {
						t.Fatal("out-of-recording words published")
					}
				}
			})
		}
	}
}

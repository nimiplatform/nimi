package nimillm

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

func mistralAudioTestTarget(endpoint, model string) (*CloudProvider, *RemoteTarget) {
	return NewCloudProvider(CloudConfig{}), &RemoteTarget{ProviderType: "mistral", Endpoint: endpoint + "/v1", APIKey: "fixture", ProviderModelID: model, AllowLoopback: true}
}
func mistralAudioTestSpeech(format string) *runtimev1.SubmitScenarioJobRequest {
	request := openAISpeechTestJob(nil)
	s := request.GetSpec().GetSpeechSynthesize()
	s.Language = ""
	s.Text = " [happy]你好，Nimi！ "
	s.AudioFormat = format
	s.VoiceRef = &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET, Reference: &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: "voice_3142"}}
	return request
}
func TestMistralTranscriptionUsesNativeUploadAndActualSourceDiarization(t *testing.T) {
	mp3, err := os.ReadFile("testdata/tone-24k.mp3")
	if err != nil {
		t.Fatal(err)
	}
	for _, model := range []string{"voxtral-mini-transcribe-3-0", "voxtral-small-transcribe-3-0"} {
		for _, diarize := range []bool{false, true} {
			for _, mimeType := range []string{"audio/wav", "audio/mpeg"} {
				t.Run(fmt.Sprintf("%s/%s/%v", model, mimeType, diarize), func(t *testing.T) {
					audio := testGeminiTTSWAV()
					if mimeType == "audio/mpeg" {
						audio = mp3
					}
					server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						if r.URL.Path != "/v1/audio/transcriptions" || r.Header.Get("Authorization") != "Bearer fixture" {
							t.Errorf("wrong request %s", r.URL.Path)
						}
						if err := r.ParseMultipartForm(1 << 20); err != nil {
							t.Error(err)
							return
						}
						defer r.MultipartForm.RemoveAll()
						if r.FormValue("model") != model || r.FormValue("stream") != "false" || r.FormValue("return_language") != "true" || r.FormValue("context_bias") != " Nimi\n名称。" || r.FormValue("prompt") != "" || r.FormValue("response_format") != "" {
							t.Errorf("fields: %+v", r.MultipartForm.Value)
						}
						if diarize && (r.FormValue("diarize") != "true" || r.FormValue("timestamp_granularities") != "segment") {
							t.Error("native segment diarization not requested")
						}
						f, _, err := r.FormFile("file")
						if err != nil {
							t.Error(err)
							return
						}
						got, _ := io.ReadAll(f)
						f.Close()
						if !bytes.Equal(got, audio) {
							t.Error("original audio changed")
						}
						result := map[string]any{"model": strings.TrimSuffix(model, "-0"), "text": "  Hello\n Nimi.  ", "language": "en", "usage": map[string]any{"prompt_tokens": 3, "completion_tokens": 126, "total_tokens": 879, "prompt_audio_seconds": 34}}
						if diarize {
							result["segments"] = []any{map[string]any{"type": "transcription_segment", "text": " Hello", "start": 0, "end": 0.05, "speaker_id": "speaker_0"}, map[string]any{"type": "transcription_segment", "text": " Nimi.", "start": 0.02, "end": 0.08, "speaker_id": "speaker_1"}}
						}
						w.Header().Set("Content-Type", "application/json")
						json.NewEncoder(w).Encode(result)
					}))
					defer server.Close()
					p, target := mistralAudioTestTarget(server.URL, model)
					request := openAITranscriptionTestRequest(&runtimev1.SpeechTranscribeScenarioSpec{MimeType: mimeType, Prompt: " Nimi\n名称。", Diarization: proto.Bool(diarize), AudioSource: &runtimev1.SpeechTranscriptionAudioSource{Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{AudioBytes: audio}}})
					artifacts, usage, _, err := p.executeMistralTranscriptions(context.Background(), request, model, target)
					if err != nil || len(artifacts) != 1 || usage.GetInputTokens() != 3 || usage.GetOutputTokens() != 126 {
						t.Fatalf("transcription %v %v", artifacts, err)
					}
					var result runtimev1.SpeechTranscript
					if err := protojson.Unmarshal(artifacts[0].GetBytes(), &result); err != nil {
						t.Fatal(err)
					}
					if result.Text != "Hello\n Nimi." || result.Language != "en" || len(result.Words) != 0 {
						t.Fatalf("altered transcript or fabricated words: %v", &result)
					}
					if diarize {
						expected, err := mistralRecordingDuration(context.Background(), audio, mimeType)
						if err != nil {
							t.Fatal(err)
						}
						if result.GetDiarization().GetDurationSeconds() != expected || result.GetDiarization().GetDurationSeconds() == 34 || len(result.GetDiarization().GetIntervals()) != 2 {
							t.Fatal("billing seconds used as source coordinates or labels lost")
						}
					} else if result.Diarization != nil {
						t.Fatal("unrequested diarization")
					}
				})
			}
		}
	}
}
func TestMistralTranscriptionRejectsUnsupportedNativeResultsAndDoesNotGuessLanguage(t *testing.T) {
	for _, tc := range []struct {
		name      string
		modify    func(map[string]any)
		wantError bool
	}{
		{"null language", func(r map[string]any) { r["language"] = nil }, false},
		{"wrong model", func(r map[string]any) { r["model"] = "voxtral-mini-transcribe-2" }, true},
		{"empty text", func(r map[string]any) { r["text"] = "" }, true},
		{"missing usage", func(r map[string]any) { delete(r, "usage") }, true},
		{"bad language", func(r map[string]any) { r["language"] = "English" }, true},
		{"out of source", func(r map[string]any) {
			r["segments"] = []any{map[string]any{"type": "transcription_segment", "text": "hi", "start": 0, "end": 10, "speaker_id": "speaker"}}
		}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			const model = "voxtral-mini-transcribe-3-0"
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if err := r.ParseMultipartForm(1 << 20); err != nil {
					t.Error(err)
					return
				}
				defer r.MultipartForm.RemoveAll()
				if r.FormValue("language") != "zh" || r.FormValue("return_language") != "" {
					t.Error("fixed language handling")
				}
				result := map[string]any{"model": model, "text": "hi", "language": nil, "usage": map[string]any{"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}, "segments": []any{map[string]any{"type": "transcription_segment", "text": "hi", "start": 0, "end": 0.08, "speaker_id": "speaker"}}}
				tc.modify(result)
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(result)
			}))
			defer server.Close()
			p, target := mistralAudioTestTarget(server.URL, model)
			req := openAITranscriptionTestRequest(&runtimev1.SpeechTranscribeScenarioSpec{Language: "zh", Diarization: proto.Bool(true), AudioSource: &runtimev1.SpeechTranscriptionAudioSource{Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{AudioBytes: testGeminiTTSWAV()}}})
			artifacts, _, _, err := p.executeMistralTranscriptions(context.Background(), req, model, target)
			if (err != nil) != tc.wantError {
				t.Fatalf("result: %v %v", artifacts, err)
			}
			if err == nil {
				var result runtimev1.SpeechTranscript
				protojson.Unmarshal(artifacts[0].GetBytes(), &result)
				if result.GetLanguage() != "" {
					t.Fatal("caller hint became detected language")
				}
			}
		})
	}
}
func TestMistralSpeechConsumesJSONAudioWithoutInventedUsage(t *testing.T) {
	for _, format := range []string{"wav", "mp3"} {
		t.Run(format, func(t *testing.T) {
			audio := testGeminiTTSWAV()
			if format == "mp3" {
				var err error
				audio, err = os.ReadFile("testdata/tone-24k.mp3")
				if err != nil {
					t.Fatal(err)
				}
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body map[string]any
				json.NewDecoder(r.Body).Decode(&body)
				if r.URL.Path != "/v1/audio/speech" || body["voice_id"] != "voice_3142" || body["voice"] != nil || body["input"] != " [happy]你好，Nimi！ " || body["response_format"] != format || body["stream"] != false || body["model"] != capabilitydriver.MistralVoxtralTTS3 {
					t.Errorf("native request %+v", body)
				}
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(map[string]any{"audio_data": base64.StdEncoding.EncodeToString(audio)})
			}))
			defer server.Close()
			p, target := mistralAudioTestTarget(server.URL, capabilitydriver.MistralVoxtralTTS3)
			artifacts, usage, _, err := p.executeMistralSpeech(context.Background(), mistralAudioTestSpeech(format), capabilitydriver.MistralVoxtralTTS3, target)
			if err != nil || usage != nil || len(artifacts) != 1 || !bytes.Equal(artifacts[0].GetBytes(), audio) || artifacts[0].GetSampleRateHz() != 24000 || artifacts[0].GetDurationMs() <= 0 {
				t.Fatalf("native file %v %v", artifacts, err)
			}
		})
	}
}
func TestMistralSpeechNativeSSERequiresDoneAndPreservesFileChunks(t *testing.T) {
	audio := testGeminiTTSWAV()
	for _, mode := range []string{"complete", "missing-done", "invalid-base64", "wrong-event", "invalid-audio"} {
		t.Run(mode, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body map[string]any
				json.NewDecoder(r.Body).Decode(&body)
				if body["stream"] != true || body["voice_id"] != "voice_3142" || r.Header.Get("Accept") != "text/event-stream" {
					t.Errorf("SSE request %+v", body)
				}
				w.Header().Set("Content-Type", "text/event-stream")
				for i, part := range [][]byte{audio[:18], audio[18:]} {
					encoded := base64.StdEncoding.EncodeToString(part)
					if mode == "invalid-base64" {
						encoded = "@@@"
					}
					if mode == "invalid-audio" {
						encoded = base64.StdEncoding.EncodeToString([]byte("not audio"))
					}
					eventType := "speech.audio.delta"
					if mode == "wrong-event" {
						eventType = "response.audio.delta"
					}
					raw, _ := json.Marshal(map[string]any{"type": eventType, "audio_data": encoded})
					fmt.Fprintf(w, ": comment\nevent: %s\ndata: %s\n\n", eventType, raw)
					if i == 0 {
						w.(http.Flusher).Flush()
					}
				}
				if mode != "missing-done" {
					fmt.Fprint(w, `data: {"type":"speech.audio.done","usage":{"prompt_tokens":4,"completion_tokens":7,"total_tokens":11}}`+"\n\n")
				}
			}))
			defer server.Close()
			p, target := mistralAudioTestTarget(server.URL, capabilitydriver.MistralVoxtralTTS3)
			b, model := p.ResolveSpeechBackendForAdapter(capabilitydriver.CloudMediaAdapterMistralSpeech, capabilitydriver.MistralVoxtralTTS3, target)
			if b == nil {
				t.Fatal("native speech route rejected")
			}
			var chunks []SpeechStreamChunk
			usage, finish, err := b.StreamMistralSpeech(context.Background(), model, mistralAudioTestSpeech("wav").GetSpec().GetSpeechSynthesize(), nil, func(c SpeechStreamChunk) error { chunks = append(chunks, c); return nil })
			if mode == "complete" {
				if err != nil || finish != runtimev1.FinishReason_FINISH_REASON_STOP || usage.GetInputTokens() != 4 || usage.GetOutputTokens() != 7 || len(chunks) != 2 || chunks[1].Sequence != 2 || !bytes.Equal(append(chunks[0].Bytes, chunks[1].Bytes...), audio) {
					t.Fatalf("SSE output %v %v %v", chunks, usage, err)
				}
			} else if err == nil || finish == runtimev1.FinishReason_FINISH_REASON_STOP {
				t.Fatal("incomplete native stream succeeded")
			}
			if mode == "missing-done" {
				if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_STREAM_BROKEN {
					t.Fatal(err)
				}
			}
		})
	}
}
func TestMistralSourceDurationUsesStereoFramesWithoutChangingMonoOwners(t *testing.T) {
	stereo := testGeminiTTSWAV()
	binary.LittleEndian.PutUint16(stereo[22:], 2)
	binary.LittleEndian.PutUint32(stereo[28:], 96000)
	binary.LittleEndian.PutUint16(stereo[32:], 4)
	duration, err := mistralRecordingDuration(context.Background(), stereo, "audio/wav")
	if err != nil || duration != .05 {
		t.Fatalf("stereo sample duration %v %v", duration, err)
	}
	if _, _, _, err := inspectFiniteMonoPCMWAV(stereo); err == nil {
		t.Fatal("mono-only owner admitted stereo")
	}
	if _, _, err := mistralSpeechAudio(context.Background(), stereo, "wav"); err == nil {
		t.Fatal("native mono TTS accepted stereo")
	}
}

func TestMistralSpeechCancellationStopsProviderStream(t *testing.T) {
	stopped := make(chan struct{})
	audio := testGeminiTTSWAV()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprintf(w, "data: {\"type\":\"speech.audio.delta\",\"audio_data\":\"%s\"}\n\n", base64.StdEncoding.EncodeToString(audio[:20]))
		w.(http.Flusher).Flush()
		<-r.Context().Done()
		close(stopped)
	}))
	defer server.Close()
	p, target := mistralAudioTestTarget(server.URL, capabilitydriver.MistralVoxtralTTS3)
	b, model := p.ResolveSpeechBackendForAdapter(capabilitydriver.CloudMediaAdapterMistralSpeech, capabilitydriver.MistralVoxtralTTS3, target)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	_, finish, err := b.StreamMistralSpeech(ctx, model, mistralAudioTestSpeech("wav").GetSpec().GetSpeechSynthesize(), nil, func(SpeechStreamChunk) error { cancel(); return ctx.Err() })
	if err == nil || finish == runtimev1.FinishReason_FINISH_REASON_STOP {
		t.Fatal("canceled synthesis succeeded")
	}
	<-stopped
}

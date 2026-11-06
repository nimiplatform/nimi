package nimillm

import (
	"bytes"
	"context"
	"encoding/json"
	"encoding/xml"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestAzureNativeSpeechPreservesEscapedTextStyleVoiceAndAudioFacts(t *testing.T) {
	for _, tc := range []struct{ model, voice, style string }{
		{"azure-neural-tts", "en-US-JennyNeural", ""}, {"azure-hd-tts", "en-US-Ava:DragonHDLatestNeural", ""}, {"azure-openai-tts-preview", "en-US-NovaMultilingualNeuralHD", ""},
		{"azure-hd-flash-tts", "zh-CN-Xiaoxiao:DragonHDFlashLatestNeural", "cheerful"}, {"azure-mai-voice-2.1", "en-US-Harper:MAI-Voice-2.1", "happy"}, {"azure-mai-voice-2.1-flash", "zh-CN-Mei:MAI-Voice-2.1-Flash", "whispering"},
	} {
		t.Run(tc.model, func(t *testing.T) {
			audio := testGeminiTTSWAV()
			text := "  Hello <voice> & Nimi.  "
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "POST" || r.URL.Path != "/cognitiveservices/v1" || r.Header.Get("Ocp-Apim-Subscription-Key") != "fixture" || r.Header.Get("Authorization") != "" || r.Header.Get("X-Microsoft-OutputFormat") != "riff-24khz-16bit-mono-pcm" {
					t.Error("native route/auth/format")
				}
				raw, _ := io.ReadAll(r.Body)
				decoder := xml.NewDecoder(bytes.NewReader(raw))
				var spoken strings.Builder
				voice, style, root := "", "", false
				for {
					token, err := decoder.Token()
					if err == io.EOF {
						break
					}
					if err != nil {
						t.Error(err)
						break
					}
					switch v := token.(type) {
					case xml.StartElement:
						if v.Name.Local == "speak" {
							root = v.Name.Space == "http://www.w3.org/2001/10/synthesis"
						}
						for _, a := range v.Attr {
							if v.Name.Local == "voice" && a.Name.Local == "name" {
								voice = a.Value
							}
							if v.Name.Local == "express-as" && a.Name.Local == "style" {
								style = a.Value
							}
						}
					case xml.CharData:
						spoken.Write(v)
					}
				}
				if !root || voice != tc.voice || style != tc.style || spoken.String() != text {
					t.Errorf("SSML altered the request: %s", raw)
				}
				w.Header().Set("Content-Type", "audio/wav")
				_, _ = w.Write(audio)
			}))
			defer server.Close()
			req := googleTTSTestRequest("wav", 24000)
			s := req.GetSpec().GetSpeechSynthesize()
			s.Text = text
			s.Language = tc.voice[:5]
			s.Emotion = tc.style
			s.VoiceRef = &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET, Reference: &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: tc.voice}}
			out, usage, _, err := ExecuteAzureSpeechTTS(context.Background(), MediaAdapterConfig{BaseURL: server.URL, APIKey: "fixture", AllowLoopbackEndpoint: true}, req, tc.model)
			if err != nil || len(out) != 1 || !bytes.Equal(out[0].GetBytes(), audio) || out[0].GetSampleRateHz() != 24000 || out[0].GetDurationMs() != 100 || usage != nil {
				t.Fatalf("native audio %v %v", out, err)
			}
		})
	}
}

func TestAzureNativeFormatHeadersUseCapturedSampleRate(t *testing.T) {
	for _, tc := range []struct {
		format string
		rate   int32
		want   string
	}{
		{"mp3", 16000, "audio-16khz-128kbitrate-mono-mp3"}, {"mp3", 48000, "audio-48khz-192kbitrate-mono-mp3"}, {"wav", 22050, "riff-22050hz-16bit-mono-pcm"}, {"wav", 44100, "riff-44100hz-16bit-mono-pcm"}, {"pcm", 16000, "raw-16khz-16bit-mono-pcm"}, {"ogg", 48000, "ogg-48khz-16bit-mono-opus"},
	} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("X-Microsoft-OutputFormat") != tc.want {
				t.Error(r.Header.Get("X-Microsoft-OutputFormat"))
			}
			w.Header().Set("Content-Type", "text/html")
			_, _ = w.Write([]byte("upstream error page"))
		}))
		out, _, _, err := ExecuteAzureSpeechTTS(context.Background(), MediaAdapterConfig{BaseURL: server.URL, APIKey: "fixture", AllowLoopbackEndpoint: true}, googleTTSTestRequest(tc.format, tc.rate), "azure-neural-tts")
		server.Close()
		if err == nil || len(out) != 0 {
			t.Fatal("HTML published as audio")
		}
	}
}

func TestPollyNativeOggAndRawCodecs(t *testing.T) {
	dir := os.Getenv("NIMI_TEST_FFMPEG_DIR")
	if dir == "" {
		t.Skip("actual codec fixture requires NIMI_TEST_FFMPEG_DIR")
	}
	ffmpeg := filepath.Join(dir, "ffmpeg.exe")
	if _, err := os.Stat(ffmpeg); err != nil {
		ffmpeg = filepath.Join(dir, "ffmpeg")
	}
	for _, tc := range []struct {
		format, wire, codec, mux, mime string
		rate                           int32
	}{
		{"ogg", "ogg_vorbis", "libvorbis", "ogg", "audio/ogg", 24000}, {"ogg_opus", "ogg_opus", "libopus", "ogg", "audio/ogg", 48000}, {"pcm", "pcm", "pcm_s16le", "s16le", "audio/pcm", 16000}, {"mulaw", "mulaw", "pcm_mulaw", "mulaw", "audio/mulaw", 8000}, {"alaw", "alaw", "pcm_alaw", "alaw", "audio/alaw", 8000},
	} {
		t.Run(tc.format, func(t *testing.T) {
			file := filepath.Join(t.TempDir(), "native.bin")
			if output, err := exec.Command(ffmpeg, "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.4", "-ac", "1", "-ar", strconv.FormatInt(int64(tc.rate), 10), "-c:a", tc.codec, "-f", tc.mux, file).CombinedOutput(); err != nil {
				t.Fatalf("encode: %v %s", err, output)
			}
			audio, err := os.ReadFile(file)
			if err != nil {
				t.Fatal(err)
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var payload map[string]any
				_ = json.NewDecoder(r.Body).Decode(&payload)
				if payload["OutputFormat"] != tc.wire || payload["SampleRate"] != strconv.FormatInt(int64(tc.rate), 10) {
					t.Errorf("wire controls: %v", payload)
				}
				w.Header().Set("Content-Type", tc.mime)
				_, _ = w.Write(audio)
			}))
			defer server.Close()
			req := googleTTSTestRequest(tc.format, tc.rate)
			req.GetSpec().GetSpeechSynthesize().VoiceRef = &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET, Reference: &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: "Joanna"}}
			out, _, _, err := ExecuteAWSPollyTTS(context.Background(), MediaAdapterConfig{BaseURL: server.URL, APIKey: "fixture", AllowLoopbackEndpoint: true}, req, "polly-neural-tts")
			if err != nil || len(out) != 1 || out[0].GetMimeType() != tc.mime || out[0].GetSampleRateHz() != tc.rate || out[0].GetDurationMs() < 390 || !bytes.Equal(out[0].GetBytes(), audio) {
				t.Fatalf("Polly native audio: %v %v", out, err)
			}
		})
	}
}

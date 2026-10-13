package nimillm

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func TestAlibabaQwenTTSCompletedWAV(t *testing.T) {
	for _, tc := range []struct {
		name        string
		finite      bool
		extraChunks bool
		finish      string
		inline      bool
		code        string
		badMarker   bool
		finiteRIFF  bool
		partialPCM  bool
		truncated   bool
		wantError   bool
	}{
		{name: "complete URL", finish: "stop"},
		{name: "complete URL with prefix chunks", finish: "stop", extraChunks: true},
		{name: "finite unchanged", finish: "stop", finite: true, extraChunks: true},
		{name: "missing completion", wantError: true},
		{name: "nonterminal completion", finish: "length", wantError: true},
		{name: "inline is not the final download", finish: "stop", inline: true, wantError: true},
		{name: "native error", finish: "stop", code: "SynthesisFailed", wantError: true},
		{name: "unknown length marker", finish: "stop", badMarker: true, wantError: true},
		{name: "finite RIFF with streaming data marker", finish: "stop", finiteRIFF: true, wantError: true},
		{name: "incomplete PCM frame", finish: "stop", partialPCM: true, wantError: true},
		{name: "incomplete HTTP download", finish: "stop", truncated: true, wantError: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			audio, dataOffset := cosyVoiceWAVForTest(!tc.finite, tc.extraChunks)
			if tc.finiteRIFF {
				binary.LittleEndian.PutUint32(audio[4:8], uint32(len(audio)-8))
			}
			if tc.partialPCM {
				audio = audio[:len(audio)-1]
			}
			if tc.badMarker {
				binary.LittleEndian.PutUint32(audio[4:8], 0xffffffff)
				binary.LittleEndian.PutUint32(audio[dataOffset+4:dataOffset+8], 0xffffffff)
			}
			var server *httptest.Server
			server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/audio.wav" {
					w.Header().Set("Content-Type", "audio/wav")
					w.Header().Set("Content-Length", strconv.Itoa(len(audio)))
					if tc.truncated {
						_, _ = w.Write(audio[:len(audio)-2])
					} else {
						_, _ = w.Write(audio)
					}
					return
				}
				w.Header().Set("Content-Type", "application/json")
				audioResult := map[string]any{"url": server.URL + "/audio.wav", "data": ""}
				if tc.inline {
					audioResult = map[string]any{"data": base64.StdEncoding.EncodeToString(audio)}
				}
				_ = json.NewEncoder(w).Encode(map[string]any{
					"code":   tc.code,
					"output": map[string]any{"finish_reason": tc.finish, "audio": audioResult},
				})
			}))
			defer server.Close()
			artifacts, _, _, err := ExecuteAlibabaNative(context.Background(),
				MediaAdapterConfig{BaseURL: server.URL, APIKey: "test-api-key", AllowLoopbackEndpoint: true},
				noopJobStateUpdater{}, "job", &runtimev1.SubmitScenarioJobRequest{
					ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
					Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
						SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "Hello", AudioFormat: "wav"},
					}},
				}, "qwen3-tts-flash")
			if tc.wantError {
				if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_OUTPUT_INVALID || len(artifacts) != 0 {
					t.Fatalf("expected no artifact and AI_OUTPUT_INVALID, got %d artifacts, err=%v", len(artifacts), err)
				}
				return
			}
			if err != nil || len(artifacts) != 1 {
				t.Fatalf("artifacts=%d err=%v", len(artifacts), err)
			}
			result := artifacts[0].GetBytes()
			if _, _, err := finiteASRWAVInfo(result); err != nil {
				t.Fatalf("finite media consumer rejected Qwen output: %v", err)
			}
			if tc.finite {
				if !bytes.Equal(result, audio) {
					t.Fatal("finite WAV changed")
				}
				return
			}
			expected := append([]byte(nil), audio...)
			binary.LittleEndian.PutUint32(expected[4:8], uint32(len(expected)-8))
			binary.LittleEndian.PutUint32(expected[dataOffset+4:dataOffset+8], uint32(len(expected)-dataOffset-8))
			if !bytes.Equal(result, expected) {
				t.Fatal("PCM, format or other chunk bytes changed")
			}
		})
	}
}

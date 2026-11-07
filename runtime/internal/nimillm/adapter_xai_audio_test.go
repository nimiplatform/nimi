package nimillm

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

func TestXAITranscriptNativeBoundaries(t *testing.T) {
	valid := `{"text":"Hello.","language":"en","duration":1.0,"words":[{"text":"Hello.","start":0,"end":0.8,"speaker":0}]}`
	for _, timing := range []bool{false, true} {
		out, err := parseXAITranscript([]byte(valid), timing, true, 1)
		if err != nil || out.GetText() != "Hello." || out.GetLanguage() != "en" || len(out.GetWords()) != map[bool]int{true: 1, false: 0}[timing] || out.GetDiarization().GetIntervals()[0].GetSpeakerId() != "0" || out.GetDiarization().GetDurationSeconds() != 1 {
			t.Fatal("native transcript", out, err)
		}
	}
	for name, raw := range map[string]string{
		"missing text":            `{"duration":1,"words":[]}`,
		"null duration":           strings.Replace(valid, `"duration":1.0`, `"duration":null`, 1),
		"null time":               strings.Replace(valid, `"start":0`, `"start":null`, 1),
		"negative time":           strings.Replace(valid, `"start":0`, `"start":-1`, 1),
		"source overrun":          strings.Replace(valid, `"end":0.8`, `"end":1.1`, 1),
		"reported overrun":        strings.Replace(valid, `"duration":1.0`, `"duration":0.5`, 1),
		"missing speaker":         strings.Replace(valid, `,"speaker":0`, ``, 1),
		"negative speaker":        strings.Replace(valid, `"speaker":0`, `"speaker":-1`, 1),
		"fractional speaker":      strings.Replace(valid, `"speaker":0`, `"speaker":0.5`, 1),
		"zero speaker span":       strings.Replace(valid, `"end":0.8`, `"end":0`, 1),
		"multichannel":            strings.Replace(valid, `"text":"Hello."`, `"channels":[{}],"text":"Hello."`, 1),
		"silent with words":       strings.Replace(valid, `"text":"Hello."`, `"text":""`, 1),
		"missing requested words": `{"text":"Hello.","duration":1,"words":[]}`,
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := parseXAITranscript([]byte(raw), true, true, 1); err == nil {
				t.Fatal("invalid output accepted")
			}
		})
	}
	out, err := parseXAITranscript([]byte(`{"text":"","language":"en","duration":1,"words":[]}`), true, true, 1)
	if err != nil || out.GetStatus() != runtimev1.SpeechTranscriptStatus_SPEECH_TRANSCRIPT_STATUS_NO_SPEECH || out.GetLanguage() != "" || out.GetDiarization().GetStatus() != runtimev1.SpeechDiarizationStatus_SPEECH_DIARIZATION_STATUS_NO_SPEAKERS {
		t.Fatal("silent output", out, err)
	}
}

func TestXAISpeechRejectsErrorEnvelopesAndWrongAudio(t *testing.T) {
	for _, tc := range []struct{ contentType, body string }{{"application/json", `{"error":"failed"}`}, {"audio/wav", "not a wav"}, {"audio/pcm", "raw"}} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", tc.contentType)
			_, _ = fmt.Fprint(w, tc.body)
		}))
		req := &runtimev1.SubmitScenarioJobRequest{Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "Hello.", Language: "auto", AudioFormat: "wav", SampleRateHz: proto.Int32(24000)}}}}
		artifacts, _, _, err := ExecuteXAISpeech(context.Background(), MediaAdapterConfig{BaseURL: server.URL + "/v1", APIKey: "test", AllowLoopbackEndpoint: true}, req)
		server.Close()
		if err == nil || len(artifacts) != 0 {
			t.Fatal("bad audio published", tc.contentType)
		}
	}
}

package ai

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

func TestCosyVoiceWordPublicJobGetCarriesAlignmentAndRejectsMissingTiming(t *testing.T) {
	for _, missing := range []bool{false, true} {
		t.Run(fmt.Sprint("missing=", missing), func(t *testing.T) {
			wave := make([]byte, 44+96000)
			copy(wave, "RIFF")
			binary.LittleEndian.PutUint32(wave[4:], uint32(len(wave)-8))
			copy(wave[8:], "WAVEfmt ")
			binary.LittleEndian.PutUint32(wave[16:], 16)
			binary.LittleEndian.PutUint16(wave[20:], 1)
			binary.LittleEndian.PutUint16(wave[22:], 1)
			binary.LittleEndian.PutUint32(wave[24:], 24000)
			binary.LittleEndian.PutUint32(wave[28:], 48000)
			binary.LittleEndian.PutUint16(wave[32:], 2)
			binary.LittleEndian.PutUint16(wave[34:], 16)
			copy(wave[36:], "data")
			binary.LittleEndian.PutUint32(wave[40:], 96000)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("X-DashScope-SSE") != "enable" {
					t.Error("protected WORD did not reach SSE")
				}
				w.Header().Set("Content-Type", "text/event-stream")
				write := func(kind string, words any, data string, stop bool) {
					out := map[string]any{"type": kind, "sentence": map[string]any{"index": 0, "words": words}, "audio": map[string]any{"data": data}}
					if stop {
						delete(out, "type")
						delete(out, "sentence")
						out["finish_reason"] = "stop"
					}
					raw, _ := json.Marshal(map[string]any{"request_id": "public-word-request", "output": out})
					_, _ = fmt.Fprintf(w, "data: %s\n\n", raw)
				}
				write("sentence-begin", []any{}, "", false)
				write("sentence-synthesis", nil, base64.StdEncoding.EncodeToString(wave), false)
				words := []any{map[string]any{"text": "Hello", "begin_time": 0, "end_time": 400}, map[string]any{"text": "Nimi", "begin_time": 650, "end_time": 1050}}
				if missing {
					words = nil
				}
				write("sentence-end", words, "", false)
				write("", nil, "", true)
			}))
			defer server.Close()
			fixture := newManagedCloudScenarioTestFixture(t, "dashscope", "cosyvoice-v3-plus", server.URL, Config{AllowLoopbackEndpoint: true})
			const appID = "app.word-timing"
			intent := publicCloudFeatureIntent(t, fixture, appID, "audio.synthesize")
			w, err := fixture.service.OverwriteAppAIConfig(protectedAppAIConfigPrincipalContext("user-001", appID), &runtimev1.OverwriteAppAIConfigRequest{Config: appAIConfig(appID, intent), ExpectedRevision: "0"})
			if err != nil || !w.GetCommitted() {
				t.Fatalf("public config = %v %v", w, err)
			}
			decision := func(op accountservice.LocalAppOperation, id string) context.Context {
				return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{AccountID: "user-001", AppID: appID, RegisteredAppSubject: "word-principal", Operation: op, AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: id})
			}
			created, err := fixture.service.SubmitLocalAppScenarioJob(decision(accountservice.LocalAppOperationScenarioJobSubmit, localappop.AppOperationIDScenarioJobSubmit), &runtimev1.SubmitLocalAppScenarioJobRequest{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_SpeechSynthesize{SpeechSynthesize: &runtimev1.LocalAppSpeechSynthesizeJobSpec{Text: "Hello Nimi.", AudioFormat: "wav", TimingMode: runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_WORD, VoiceRef: &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET, Reference: &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: "longanyang"}}}}})
			if err != nil {
				t.Fatal(err)
			}
			var get *runtimev1.GetLocalAppScenarioJobResponse
			deadline := time.Now().Add(3 * time.Second)
			for time.Now().Before(deadline) {
				get, err = fixture.service.GetLocalAppScenarioJob(decision(accountservice.LocalAppOperationScenarioJobGet, localappop.AppOperationIDScenarioJobGet), &runtimev1.GetLocalAppScenarioJobRequest{JobId: created.GetJob().GetJobId()})
				if err != nil || get.GetJob().GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || get.GetJob().GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED {
					break
				}
				time.Sleep(10 * time.Millisecond)
			}
			if err != nil {
				t.Fatal(err)
			}
			if missing {
				if get.GetJob().GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED || len(get.GetJob().GetArtifacts()) != 0 {
					t.Fatalf("missing timing succeeded: %v", get)
				}
				return
			}
			if get.GetJob().GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || len(get.GetJob().GetArtifacts()) != 1 {
				t.Fatalf("word Job = %v", get)
			}
			a := get.GetJob().GetArtifacts()[0]
			if a.GetSpeechAlignment().GetUnit() != runtimev1.SpeechAlignmentUnit_SPEECH_ALIGNMENT_UNIT_WORD || len(a.GetSpeechAlignment().GetTokens()) != 2 || a.GetSpeechAlignment().GetTokens()[0].GetStartMs() != 0 || a.GetSpeechAlignment().GetTokens()[1].GetEndMs() != 1050 || a.GetSizeBytes() != int64(len(wave)) {
				t.Fatalf("trimmed alignment = %v", a)
			}
		})
	}
}

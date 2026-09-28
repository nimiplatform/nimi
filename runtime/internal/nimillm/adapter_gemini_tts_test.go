package nimillm

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func testGeminiTTSWAV() []byte {
	wav := make([]byte, 44+4800)
	copy(wav[:4], "RIFF")
	binary.LittleEndian.PutUint32(wav[4:8], uint32(len(wav)-8))
	copy(wav[8:12], "WAVE")
	copy(wav[12:16], "fmt ")
	binary.LittleEndian.PutUint32(wav[16:20], 16)
	binary.LittleEndian.PutUint16(wav[20:22], 1)
	binary.LittleEndian.PutUint16(wav[22:24], 1)
	binary.LittleEndian.PutUint32(wav[24:28], 24000)
	binary.LittleEndian.PutUint32(wav[28:32], 48000)
	binary.LittleEndian.PutUint16(wav[32:34], 2)
	binary.LittleEndian.PutUint16(wav[34:36], 16)
	copy(wav[36:40], "data")
	binary.LittleEndian.PutUint32(wav[40:44], 4800)
	return wav
}

func TestGeminiTTSGenerateContentUsesNativeVoiceAndMeasuredWAV(t *testing.T) {
	wav := testGeminiTTSWAV()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1beta/models/gemini-3.8-flash-tts:generateContent" ||
			r.Header.Get("x-goog-api-key") != "gemini-key" || r.Header.Get("Authorization") != "" {
			t.Errorf("wrong native Gemini TTS call: %s %s", r.Method, r.URL.Path)
			http.Error(w, "invalid call", http.StatusBadRequest)
			return
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode request: %v", err)
		}
		config, _ := body["generationConfig"].(map[string]any)
		voice := MapField(MapField(config["speechConfig"], "voiceConfig"), "prebuiltVoiceConfig")
		if ValueAsString(MapField(voice, "voiceName")) != "Kore" {
			t.Errorf("Kore voice missing from request")
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"candidates": []any{map[string]any{"content": map[string]any{"parts": []any{map[string]any{"inlineData": map[string]any{"mimeType": "audio/wav", "data": base64.StdEncoding.EncodeToString(wav)}}}}}}})
	}))
	defer server.Close()
	req := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "Hello from Nimi.", VoiceRef: &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET, Reference: &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: "Kore"}}}}}}
	artifacts, usage, providerJobID, err := ExecuteGeminiTTSGenerateContent(context.Background(), MediaAdapterConfig{BaseURL: server.URL + "/v1beta/openai", APIKey: "gemini-key", AllowLoopbackEndpoint: true}, req, "gemini-3.8-flash-tts")
	if err != nil || providerJobID != "" || usage != nil || len(artifacts) != 1 || artifacts[0].GetMimeType() != "audio/wav" || artifacts[0].GetSampleRateHz() != 24000 || artifacts[0].GetDurationMs() != 100 || len(artifacts[0].GetBytes()) != len(wav) {
		t.Fatalf("Gemini TTS output artifacts=%+v usage=%+v providerJob=%q err=%v", artifacts, usage, providerJobID, err)
	}
}

func TestGeminiTTSAudioResultRejectsMalformedWAV(t *testing.T) {
	_, _, err := geminiTTSAudioResult(map[string]any{"candidates": []any{map[string]any{"content": map[string]any{"parts": []any{map[string]any{"inlineData": map[string]any{"mimeType": "audio/wav", "data": base64.StdEncoding.EncodeToString([]byte("RIFFnot-a-wave"))}}}}}}})
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
		t.Fatalf("malformed WAV reason=%v ok=%v err=%v", reason, ok, err)
	}
}

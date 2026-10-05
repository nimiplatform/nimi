package nimillm

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
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
	var submittedTexts []string
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
		contents, _ := body["contents"].([]any)
		if len(contents) != 1 {
			t.Errorf("Gemini TTS content count = %d", len(contents))
		} else if parts, ok := MapField(contents[0], "parts").([]any); !ok || len(parts) != 1 {
			t.Error("Gemini TTS text part is missing")
		} else {
			submittedTexts = append(submittedTexts, ValueAsString(MapField(parts[0], "text")))
		}
		config, _ := body["generationConfig"].(map[string]any)
		voice := MapField(config["speechConfig"], "voiceConfig")
		if ValueAsString(MapField(voice, "voice")) != "Kore" || MapField(voice, "prebuiltVoiceConfig") != nil {
			t.Errorf("current Kore voice field missing or legacy shape retained")
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"candidates": []any{map[string]any{"finishReason": "STOP", "content": map[string]any{"parts": []any{map[string]any{"inlineData": map[string]any{"mimeType": "audio/wav", "data": base64.StdEncoding.EncodeToString(wav)}}}}}}})
	}))
	defer server.Close()
	req := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "Hello from Nimi.", VoiceRef: &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET, Reference: &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: "Kore"}}}}}}
	artifacts, usage, providerJobID, err := ExecuteGeminiTTSGenerateContent(context.Background(), MediaAdapterConfig{BaseURL: server.URL + "/v1beta/openai", APIKey: "gemini-key", AllowLoopbackEndpoint: true}, req, "gemini-3.8-flash-tts")
	if err != nil || providerJobID != "" || usage != nil || len(artifacts) != 1 || artifacts[0].GetMimeType() != "audio/wav" || artifacts[0].GetSampleRateHz() != 24000 || artifacts[0].GetDurationMs() != 100 || len(artifacts[0].GetBytes()) != len(wav) {
		t.Fatalf("Gemini TTS output artifacts=%+v usage=%+v providerJob=%q err=%v", artifacts, usage, providerJobID, err)
	}
	chinese := req.GetSpec().GetSpeechSynthesize()
	chinese.Text = "你好，欢迎使用 Nimi。"
	chinese.Language = "zh"
	if _, _, _, err := ExecuteGeminiTTSGenerateContent(context.Background(), MediaAdapterConfig{BaseURL: server.URL + "/v1beta/openai", APIKey: "gemini-key", AllowLoopbackEndpoint: true}, req, "gemini-3.8-flash-tts"); err != nil {
		t.Fatalf("Chinese Gemini TTS failed: %v", err)
	}
	if !reflect.DeepEqual(submittedTexts, []string{"Hello from Nimi.", "你好，欢迎使用 Nimi。"}) {
		t.Fatalf("Gemini TTS transcript text changed: %q", submittedTexts)
	}
	chinese.Language = "ja"
	if _, _, _, err := ExecuteGeminiTTSGenerateContent(context.Background(), MediaAdapterConfig{BaseURL: server.URL + "/v1beta/openai", APIKey: "gemini-key", AllowLoopbackEndpoint: true}, req, "gemini-3.8-flash-tts"); err != nil {
		if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
			t.Fatalf("unsupported Host language reason=%v ok=%v err=%v", reason, ok, err)
		}
	} else {
		t.Fatal("Gemini TTS Host accepted an unadmitted language")
	}
	if len(submittedTexts) != 2 {
		t.Fatalf("unsupported language reached Gemini Host: %q", submittedTexts)
	}
}

func TestGeminiTTSAudioResultRejectsMalformedWAV(t *testing.T) {
	_, _, err := geminiTTSAudioResult(map[string]any{"candidates": []any{map[string]any{"finishReason": "STOP", "content": map[string]any{"parts": []any{map[string]any{"inlineData": map[string]any{"mimeType": "audio/wav", "data": base64.StdEncoding.EncodeToString([]byte("RIFFnot-a-wave"))}}}}}}})
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
		t.Fatalf("malformed WAV reason=%v ok=%v err=%v", reason, ok, err)
	}
}

func TestGeminiTTSGenerateContentKeepsEmotionSeparateFromVerbatimTranscript(t *testing.T) {
	for _, tc := range []struct {
		model, voice, text, language, emotion string
	}{
		{"gemini-3.8-flash-tts", "Puck", "  Hello, 世界!\n", "en", "warm and enthusiastic"},
		{"gemini-3.8-flash-lite-tts", "Sulafat", "你好，欢迎回来。\n", "zh", "calm and relaxed"},
	} {
		t.Run(tc.model, func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.URL.Path != "/v1beta/models/"+tc.model+":generateContent" {
					t.Errorf("unexpected model path %s", r.URL.Path)
				}
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
				}
				contents, _ := body["contents"].([]any)
				if len(contents) != 1 {
					t.Errorf("contents=%+v", contents)
					http.Error(w, "invalid content count", http.StatusBadRequest)
					return
				}
				parts, _ := MapField(contents[0], "parts").([]any)
				if len(parts) != 1 || MapField(parts[0], "text") != tc.text || MapField(MapField(parts[0], "speech_metadata"), "style") != tc.emotion {
					t.Errorf("verbatim transcript/style mapping=%+v", parts)
				}
				voice := MapField(MapField(body["generationConfig"], "speechConfig"), "voiceConfig")
				if MapField(voice, "voice") != tc.voice || MapField(voice, "prebuiltVoiceConfig") != nil {
					t.Errorf("voice mapping=%+v", voice)
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"candidates": []any{map[string]any{"finishReason": "STOP", "content": map[string]any{"parts": []any{map[string]any{"inlineData": map[string]any{"mimeType": "audio/wav", "data": base64.StdEncoding.EncodeToString(testGeminiTTSWAV())}}}}}}})
			}))
			defer server.Close()
			spec := &runtimev1.SpeechSynthesizeScenarioSpec{Text: tc.text, Language: tc.language, Emotion: tc.emotion, VoiceRef: &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET, Reference: &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: tc.voice}}}
			req := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: spec}}}
			cfg := MediaAdapterConfig{BaseURL: server.URL + "/v1beta/openai", APIKey: "key", AllowLoopbackEndpoint: true}
			if _, _, _, err := ExecuteGeminiTTSGenerateContent(context.Background(), cfg, req, tc.model); err != nil {
				t.Fatal(err)
			}
			pitch := float32(0)
			spec.Pitch = &pitch
			if _, _, _, err := ExecuteGeminiTTSGenerateContent(context.Background(), cfg, req, tc.model); err == nil {
				t.Fatal("Host accepted unsupported exact pitch")
			}
			if calls != 1 {
				t.Fatalf("unsupported control reached provider: calls=%d", calls)
			}
		})
	}
}

func TestGeminiTTSAudioResultRejectsValidPCM24Output(t *testing.T) {
	wav := testGeminiTTSWAV()
	binary.LittleEndian.PutUint32(wav[28:32], 72000)
	binary.LittleEndian.PutUint16(wav[32:34], 3)
	binary.LittleEndian.PutUint16(wav[34:36], 24)
	_, _, err := geminiTTSAudioResult(map[string]any{"candidates": []any{map[string]any{"finishReason": "STOP", "content": map[string]any{"parts": []any{map[string]any{"inlineData": map[string]any{"mimeType": "audio/wav", "data": base64.StdEncoding.EncodeToString(wav)}}}}}}})
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
		t.Fatalf("24-bit WAV reason=%v ok=%v err=%v", reason, ok, err)
	}
}

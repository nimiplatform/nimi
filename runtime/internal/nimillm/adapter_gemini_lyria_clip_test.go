package nimillm

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/status"
)

func TestGeminiLyriaClipUsesNativeTextAndInlineMP3(t *testing.T) {
	providerAudio := []byte("ID3-real-provider-test-body")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1beta/models/lyria-3-clip-preview:generateContent" ||
			r.Header.Get("x-goog-api-key") != "gemini-key" || r.Header.Get("Authorization") != "" {
			t.Errorf("unexpected Lyria native call: %s %s", r.Method, r.URL.Path)
			http.Error(w, "invalid call", http.StatusBadRequest)
			return
		}
		body := map[string]any{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode request: %v", err)
		}
		contents, _ := body["contents"].([]any)
		parts, _ := MapField(contents[0], "parts").([]any)
		if len(contents) != 1 || len(parts) != 1 || ValueAsString(MapField(parts[0], "text")) != "A short melodic loop." || body["generationConfig"] != nil {
			t.Errorf("Lyria prompt or request shape changed: %+v", body)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"candidates": []any{map[string]any{"finishReason": "STOP", "content": map[string]any{"parts": []any{
			map[string]any{"text": "Generated lyrics"},
			map[string]any{"inlineData": map[string]any{"mimeType": "audio/mpeg", "data": base64.StdEncoding.EncodeToString(providerAudio)}},
		}}}}})
	}))
	defer server.Close()
	req := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_MusicGenerate{MusicGenerate: &runtimev1.MusicGenerateScenarioSpec{Prompt: "A short melodic loop.", DurationSeconds: 35}}}}
	artifacts, usage, providerJobID, err := ExecuteGeminiLyriaClipGenerateContent(context.Background(), MediaAdapterConfig{BaseURL: server.URL + "/v1beta/openai", APIKey: "gemini-key", AllowLoopbackEndpoint: true}, req, geminiLyriaClipModel)
	if err != nil || usage != nil || providerJobID != "" || len(artifacts) != 1 || string(artifacts[0].GetBytes()) != string(providerAudio) || artifacts[0].GetMimeType() != "audio/mpeg" {
		t.Fatalf("native Lyria result artifacts=%+v usage=%+v providerJob=%q err=%v", artifacts, usage, providerJobID, err)
	}
}

func TestGeminiLyriaClipRejectsMultipleAudioParts(t *testing.T) {
	part := map[string]any{"inlineData": map[string]any{"mimeType": "audio/mpeg", "data": base64.StdEncoding.EncodeToString([]byte("audio"))}}
	_, err := geminiLyriaInlineMP3(map[string]any{"candidates": []any{map[string]any{"finishReason": "STOP", "content": map[string]any{"parts": []any{part, part}}}}})
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
		t.Fatalf("ambiguous Lyria output reason=%v present=%v err=%v", reason, ok, err)
	}
}

func TestGeminiLyriaInvalidOutputHasSafeActionableDiagnostics(t *testing.T) {
	inline := func(mime, data string) any {
		return map[string]any{"inlineData": map[string]any{"mimeType": mime, "data": data}}
	}
	valid := inline("audio/mpeg", base64.StdEncoding.EncodeToString([]byte("audio")))
	for _, tc := range []struct {
		name, finish, want string
		parts              []any
	}{
		{"incomplete", "MAX_TOKENS", "completed candidate", []any{valid}},
		{"text-only", "STOP", "no inline audio", []any{map[string]any{"text": "private provider content"}}},
		{"wrong-format", "STOP", "MP3 format", []any{inline("private provider MIME", "private provider bytes")}},
		{"empty", "STOP", "encoded size limit", []any{inline("audio/mpeg", "")}},
		{"invalid-base64", "STOP", "valid nonempty base64", []any{inline("audio/mpeg", "private provider bytes")}},
		{"ambiguous", "STOP", "multiple inline audio parts", []any{valid, valid}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			audio, err := geminiLyriaInlineMP3(map[string]any{"candidates": []any{map[string]any{
				"finishReason": tc.finish, "content": map[string]any{"parts": tc.parts},
			}}})
			reason, ok := grpcerr.ExtractReasonCode(err)
			metadata, _ := grpcerr.ExtractReasonMetadata(err)
			message := status.Convert(err).Message()
			if audio != nil || !ok || reason != runtimev1.ReasonCode_AI_OUTPUT_INVALID ||
				!strings.Contains(message, tc.want) || strings.Contains(message, "private provider") ||
				!strings.HasPrefix(metadata["action_hint"], "inspect_lyria_") {
				t.Fatalf("unsafe or missing diagnostic: audio=%v reason=%v message=%q", audio, reason, message)
			}
		})
	}
}

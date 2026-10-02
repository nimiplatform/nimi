package capabilitydriver

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestGeminiNativeMaterializationPlanCountsJSONAndEncodedBodiesBeforeReading(t *testing.T) {
	spec := &runtimev1.TextGenerateScenarioSpec{SystemPrompt: "Captured system.", Input: []*runtimev1.ChatMessage{{Role: "user", Parts: []*runtimev1.ChatContentPart{{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF, Content: &runtimev1.ChatContentPart_ArtifactRef{ArtifactRef: &runtimev1.ChatContentArtifactRef{ArtifactId: "owned", MimeType: "audio/wav"}}}}}}}
	ctx := textbehavior.WithInternalOutputBudget(context.Background(), 123)
	prepared, budget, err := Gemini38FlashPlanMaterialization(ctx, spec, false)
	if err != nil || prepared.GetMaxTokens() != 123 || spec.MaxTokens != nil {
		t.Fatalf("planning changed caller or missed captured output reserve: %v %v", prepared, err)
	}
	plan, err := gemini38BaseSerialize(prepared, true)
	if err != nil {
		t.Fatal(err)
	}
	remaining := int64(GeminiNativeMaxRequestBytes - len(plan.Payload))
	allowed := remaining / 4 * 3
	if budget.Reserve(allowed) != nil || budget.Reserve(4) == nil {
		t.Fatal("native encoded boundary did not include JSON overhead")
	}
	if _, err := Gemini38FlashBaseRequestSerializer(prepared, false); err == nil {
		t.Fatal("size template became a dispatched unresolved media request")
	}
}

func TestGemini38NativeBasePreservesOrderedMediaAndMIME(t *testing.T) {
	wav := make([]byte, 44+32)
	copy(wav, "RIFF")
	binary.LittleEndian.PutUint32(wav[4:], uint32(len(wav)-8))
	copy(wav[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(wav[16:], 16)
	binary.LittleEndian.PutUint16(wav[20:], 1)
	binary.LittleEndian.PutUint16(wav[22:], 1)
	binary.LittleEndian.PutUint32(wav[24:], 16000)
	binary.LittleEndian.PutUint32(wav[28:], 32000)
	binary.LittleEndian.PutUint16(wav[32:], 2)
	binary.LittleEndian.PutUint16(wav[34:], 16)
	copy(wav[36:], "data")
	binary.LittleEndian.PutUint32(wav[40:], 32)
	spec := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "system", Content: "Be concise."}, {Role: "user", Parts: []*runtimev1.ChatContentPart{
		{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT, Content: &runtimev1.ChatContentPart_Text{Text: "Listen"}},
		{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_AUDIO_URL, Content: &runtimev1.ChatContentPart_AudioUrl{AudioUrl: "data:audio/wav;base64," + base64.StdEncoding.EncodeToString(wav)}},
		{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT, Content: &runtimev1.ChatContentPart_Text{Text: "then explain"}},
	}}}}
	request, err := Gemini38FlashRequestSerializer(spec, true)
	if err != nil || request.Protocol != GeminiNativeBaseProtocol {
		t.Fatalf("native request=%v err=%v", request, err)
	}
	var body struct {
		Contents []struct {
			Role  string
			Parts []map[string]any
		}
		SystemInstruction struct{ Parts []map[string]any }
		GenerationConfig  map[string]any
	}
	if json.Unmarshal(request.Payload, &body) != nil || len(body.Contents) != 1 || len(body.Contents[0].Parts) != 3 || body.Contents[0].Parts[0]["text"] != "Listen" || body.Contents[0].Parts[2]["text"] != "then explain" {
		t.Fatalf("part order changed: %s", request.Payload)
	}
	inline := body.Contents[0].Parts[1]["inlineData"].(map[string]any)
	if inline["mimeType"] != "audio/wav" || inline["data"] != base64.StdEncoding.EncodeToString(wav) || body.SystemInstruction.Parts[0]["text"] != "Be concise." {
		t.Fatal("owned bytes/MIME/system changed")
	}
	for _, location := range []string{"file:///private.wav", "https://example.com/audio.wav", "data:video/mp4;base64,AAAA", "data:audio/wav;base64,%%%"} {
		if _, err := gemini38NativeMediaPart(runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_AUDIO_URL, location); err == nil {
			t.Fatalf("unsupported audio source admitted: %q", location)
		}
	}
}

func TestGemini38NativeBaseStreamRequiresTerminalAndDropsPrivateThoughts(t *testing.T) {
	stream := &gemini38BaseStream{}
	first, err := stream.Append([]byte(`{"candidates":[{"content":{"parts":[{"thought":true,"text":"private"},{"text":"Hello"}]}}]}`))
	if err != nil || len(first) != 1 || first[0].Text != "Hello" {
		t.Fatalf("first=%v err=%v", first, err)
	}
	if _, err := stream.Finish(); err == nil {
		t.Fatal("missing terminal succeeded")
	}
	last, err := stream.Append([]byte(`{"candidates":[{"content":{"parts":[{"text":"."}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":8,"totalTokenCount":12}}`))
	result, finishErr := stream.Finish()
	if err != nil || finishErr != nil || len(last) != 1 || !last[0].ItemCompleted || result.Items[0].Text != "Hello." || result.Usage.GetInputTokens() != 8 || result.Usage.GetOutputTokens() != 4 {
		t.Fatalf("result=%v last=%v err=%v %v", result, last, err, finishErr)
	}
	if _, err := stream.Append([]byte(`{"candidates":[{"content":{"parts":[{"text":"late"}]}}]}`)); err == nil {
		t.Fatal("late content accepted")
	}
	for _, payload := range []string{
		`{"candidates":[{"content":{"parts":[{"text":"x"}]} }]}`,
		`{"candidates":[{"content":{"parts":[{"text":"x","functionCall":{"name":"hidden"}}]},"finishReason":"STOP"}]}`,
		`{"candidates":[{"content":{"parts":[{"text":""}]},"finishReason":"STOP"}]}`,
		`{"candidates":[{"content":{"parts":[{"text":"x"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":-1,"totalTokenCount":2}}`,
	} {
		if _, err := Gemini38FlashBaseNonStreamParser([]byte(payload), nil); err == nil {
			t.Fatalf("invalid response succeeded: %s", payload)
		}
	}
	result, err = Gemini38FlashBaseNonStreamParser([]byte(`{"candidates":[{"content":{"parts":[{"text":"x"}]},"finishReason":"STOP"}]}`), nil)
	if err != nil || result.Usage != nil {
		t.Fatal("missing usage was fabricated")
	}
}

func TestGeminiNativeCapturedSystemPrecedesDirectRuntimeSystemMessages(t *testing.T) {
	spec := &runtimev1.TextGenerateScenarioSpec{SystemPrompt: "Captured first.", Input: []*runtimev1.ChatMessage{{Role: "system", Content: "Direct second."}, {Role: "system", Content: "Direct third."}, {Role: "user", Content: "Answer."}}}
	request, err := Gemini38FlashBaseRequestSerializer(spec, false)
	if err != nil {
		t.Fatal(err)
	}
	var body struct {
		SystemInstruction struct {
			Parts []struct {
				Text string `json:"text"`
			} `json:"parts"`
		} `json:"systemInstruction"`
	}
	if json.Unmarshal(request.Payload, &body) != nil || len(body.SystemInstruction.Parts) != 3 || body.SystemInstruction.Parts[0].Text != "Captured first." || body.SystemInstruction.Parts[1].Text != "Direct second." || body.SystemInstruction.Parts[2].Text != "Direct third." {
		t.Fatalf("system order or duplication changed: %s", request.Payload)
	}
}

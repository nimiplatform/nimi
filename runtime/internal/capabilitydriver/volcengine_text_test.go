package capabilitydriver

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/png"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/protobuf/proto"
)

func arkTextSpec() *runtimev1.TextGenerateScenarioSpec {
	return &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "17 plus 26"}}, MaxTokens: proto.Int32(4096)}
}
func arkWire(t *testing.T, p VolcengineTextBehavior, s *runtimev1.TextGenerateScenarioSpec, stream bool) map[string]any {
	t.Helper()
	w, err := p.Serialize(s, stream)
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	if err = json.Unmarshal(w.Payload, &body); err != nil {
		t.Fatal(err)
	}
	return body
}
func TestVolcengineTextExactControls(t *testing.T) {
	if _, err := NewVolcengineTextBehavior("doubao-seed-translation-250915"); err == nil {
		t.Fatal("the separate Responses translation operation was admitted as Chat")
	}
	for _, model := range VolcengineTextModels() {
		t.Run(model, func(t *testing.T) {
			p, _ := NewVolcengineTextBehavior(model)
			s := arkTextSpec()
			b := arkWire(t, p, s, true)
			if b["max_completion_tokens"] != float64(4096) || b["max_tokens"] != nil {
				t.Fatal(b)
			}
			if model == "deepseek-v4-1-flash-261017" || model == "deepseek-v4-1-flash-economy-261017" {
				if b["stream_options"] != nil {
					t.Fatal("unsupported usage control")
				}
			}
			for _, effort := range p.Efforts() {
				s.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED, Intensity: &runtimev1.ReasoningConfig_Effort{Effort: effort}}
				arkWire(t, p, s, false)
			}
			s.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED, Intensity: &runtimev1.ReasoningConfig_ExactBudgetTokens{ExactBudgetTokens: 1024}}
			if _, err := p.Serialize(s, false); err == nil {
				t.Fatal("unsupported exact budget")
			}
		})
	}
}
func TestVolcengineTextRejectsIgnoredControls(t *testing.T) {
	for _, tc := range []struct {
		model  string
		change func(*runtimev1.TextGenerateScenarioSpec)
	}{
		{"doubao-seed-2-0-pro-260215", func(s *runtimev1.TextGenerateScenarioSpec) { s.Temperature = proto.Float32(.2) }},
		{"kimi-k3-1-pro-261024", func(s *runtimev1.TextGenerateScenarioSpec) {
			s.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED}
		}},
		{"doubao-seed-2-1-pro-260915", func(s *runtimev1.TextGenerateScenarioSpec) { s.Stop = []string{"stop"} }},
		{"deepseek-v4-1-flash-261017", func(s *runtimev1.TextGenerateScenarioSpec) { s.TopP = proto.Float32(.8) }},
		{"deepseek-v4-1-flash-261017", func(s *runtimev1.TextGenerateScenarioSpec) {
			s.TopP = proto.Float32(.95)
			s.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED}
		}},
		{"doubao-seed-2-1-lite-260915", func(s *runtimev1.TextGenerateScenarioSpec) { s.FrequencyPenalty = proto.Float32(0) }},
		{"glm-5-2-260617", func(s *runtimev1.TextGenerateScenarioSpec) {
			s.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED, Intensity: &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_MEDIUM}}
		}},
	} {
		p, _ := NewVolcengineTextBehavior(tc.model)
		s := arkTextSpec()
		tc.change(s)
		if _, err := p.Serialize(s, false); err == nil {
			t.Fatal(tc.model)
		}
	}
}

func TestVolcengineEncryptedSummaryAndNativeReplay(t *testing.T) {
	p, _ := NewVolcengineTextBehavior("doubao-seed-2-1-pro-260915")
	s := arkTextSpec()
	s.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED, Intensity: &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_MODEL_DEFAULT}, Presentation: runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY}
	raw := []byte(`{"choices":[{"index":0,"message":{"role":"assistant","reasoning_content":"Reviewed arithmetic.","encrypted_content":"  opaque-state+/=\n","content":"43"},"finish_reason":"stop"}],"usage":{"prompt_tokens":7,"completion_tokens":9}}`)
	r, err := p.Parse(raw, s)
	if err != nil || len(r.Items) != 3 || r.Items[0].Kind != textbehavior.OrderedItemReasoningSummary || r.Items[0].Text != "Reviewed arithmetic." || r.Items[2].Text != "43" {
		t.Fatalf("%+v %v", r, err)
	}
	carrier := r.Items[1].ReasoningContinuity
	var native string
	_ = json.Unmarshal(carrier.Payload, &native)
	if native != "  opaque-state+/=\n" {
		t.Fatal("encrypted state altered")
	}
	s.Input = append(s.Input, &runtimev1.ChatMessage{Role: "assistant", TurnItems: []*runtimev1.TextTurnItem{
		{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ReasoningSummary{ReasoningSummary: &runtimev1.ReasoningSummary{Text: r.Items[0].Text}}}}},
		{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ReasoningContinuity{ReasoningContinuity: carrier}}}},
		{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_Text{Text: &runtimev1.TextOutputText{Text: "43"}}}}},
	}})
	before := proto.Clone(s)
	b := arkWire(t, p, s, false)
	message := b["messages"].([]any)[1].(map[string]any)
	if message["encrypted_content"] != native || message["reasoning_content"] != nil || !proto.Equal(s, before) {
		t.Fatal("display summary replaced native state")
	}
	other, _ := NewVolcengineTextBehavior("doubao-seed-2-1-lite-260915")
	if _, err = other.Serialize(s, false); err == nil {
		t.Fatal("cross-model carrier accepted")
	}
	s.Input[1].TurnItems = append(s.Input[1].TurnItems[:1], s.Input[1].TurnItems[2:]...)
	if _, err = p.Serialize(s, false); err == nil {
		t.Fatal("summary alone became replay")
	}
	s = arkTextSpec()
	r, err = p.Parse(raw, s)
	if err != nil || len(r.Items) != 2 || r.Items[0].Kind != textbehavior.OrderedItemReasoningContinuity {
		t.Fatal("hidden summary exposed", err)
	}
	for _, bad := range []string{strings.Replace(string(raw), `"encrypted_content":"  opaque-state+/=\n",`, "", 1), strings.Replace(string(raw), `"stop"`, `"length"`, 1), `{"model":"other","choices":[]}`, `{"error":{"code":"AuthenticationError","message":"invalid"}}`} {
		if _, err = p.Parse([]byte(bad), s); err == nil {
			t.Fatal("invalid envelope accepted")
		}
	}
}

func TestVolcengineEncryptedStreamOrdersSummaryCarrierAndAnswer(t *testing.T) {
	p, _ := NewVolcengineTextBehavior("doubao-seed-2-1-pro-260915")
	s := arkTextSpec()
	s.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED, Intensity: &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_LOW}, Presentation: runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY}
	a, _ := p.Stream(s)
	var got []textbehavior.OrderedDelta
	for _, chunk := range [][]byte{deepseekToolChunk(t, map[string]any{"reasoning_content": "short "}, nil), deepseekToolChunk(t, map[string]any{"reasoning_content": "summary"}, nil), deepseekToolChunk(t, map[string]any{"encrypted_content": "opaque", "content": "", "reasoning_content": ""}, nil), deepseekToolChunk(t, map[string]any{"content": "43"}, "stop")} {
		d, err := a.Append(chunk)
		if err != nil {
			t.Fatal(err)
		}
		got = append(got, d...)
	}
	if _, err := a.Finish(); err == nil {
		t.Fatal("missing DONE accepted")
	}
	if _, err := a.Append([]byte("[DONE]")); err != nil {
		t.Fatal(err)
	}
	r, err := a.Finish()
	if err != nil || len(r.Items) != 3 || r.Items[0].Text != "short summary" {
		t.Fatal(r, err)
	}
	for _, d := range got {
		switch d.Kind {
		case textbehavior.OrderedItemReasoningSummary:
			if d.ItemIndex != 0 {
				t.Fatal(d)
			}
		case textbehavior.OrderedItemReasoningContinuity:
			if d.ItemIndex != 1 {
				t.Fatal(d)
			}
		case textbehavior.OrderedItemText:
			if d.ItemIndex != 2 {
				t.Fatal(d)
			}
		}
	}
	for _, bad := range []map[string]any{{"reasoning_content": "late"}, {"encrypted_content": "duplicate"}} {
		a, _ = p.Stream(s)
		_, _ = a.Append(deepseekToolChunk(t, map[string]any{"encrypted_content": "opaque"}, nil))
		if _, err = a.Append(deepseekToolChunk(t, bad, nil)); err == nil {
			t.Fatal("late or duplicate state accepted")
		}
	}
}

func TestVolcengineMediaUsesNativeAudioAndExactModalities(t *testing.T) {
	var imageBytes bytes.Buffer
	_ = png.Encode(&imageBytes, image.NewRGBA(image.Rect(0, 0, 16, 16)))
	imagePart := &runtimev1.ChatContentPart{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL, Content: &runtimev1.ChatContentPart_ImageUrl{ImageUrl: &runtimev1.ChatContentImageURL{Url: "data:image/png;base64," + base64.StdEncoding.EncodeToString(imageBytes.Bytes())}}}
	audioPart := &runtimev1.ChatContentPart{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_AUDIO_URL, Content: &runtimev1.ChatContentPart_AudioUrl{AudioUrl: "data:audio/wav;base64,UklGRg=="}}
	lite, _ := NewVolcengineTextBehavior("doubao-seed-2-1-lite-260915")
	s := arkTextSpec()
	s.Input[0].Content = ""
	s.Input[0].Parts = []*runtimev1.ChatContentPart{imagePart, audioPart}
	b := arkWire(t, lite, s, false)
	audio := b["messages"].([]any)[0].(map[string]any)["content"].([]any)[1].(map[string]any)["input_audio"].(map[string]any)
	if audio["data"] != "UklGRg==" || audio["format"] != "wav" || audio["url"] != nil {
		t.Fatal(audio)
	}
	pro, _ := NewVolcengineTextBehavior("doubao-seed-2-1-pro-260915")
	if _, err := pro.Serialize(s, false); err == nil {
		t.Fatal("audio projected to non-audio model")
	}
	s.Input[0].Parts = s.Input[0].Parts[:1]
	imagePart.GetImageUrl().Detail = "auto"
	if _, err := pro.Serialize(s, false); err == nil {
		t.Fatal("undocumented auto detail")
	}
	imagePart.GetImageUrl().Detail = ""
	imagePart.GetImageUrl().Url = "https://example.com/photo.png"
	kimi, _ := NewVolcengineTextBehavior("kimi-k3-1-pro-261024")
	if _, err := kimi.Serialize(s, false); err == nil {
		t.Fatal("Kimi URL media accepted")
	}
}

package capabilitydriver

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/png"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

func deepseekVisionImage(t *testing.T, width int) string {
	t.Helper()
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, image.NewRGBA(image.Rect(0, 0, width, 1))); err != nil {
		t.Fatal(err)
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(encoded.Bytes())
}
func deepseekVisionSpec(location string) *runtimev1.TextGenerateScenarioSpec {
	return &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Parts: []*runtimev1.ChatContentPart{
		{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT, Content: &runtimev1.ChatContentPart_Text{Text: "  Describe this image.\n"}},
		{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL, Content: &runtimev1.ChatContentPart_ImageUrl{ImageUrl: &runtimev1.ChatContentImageURL{Url: location}}},
	}}}}
}

func TestDeepseekFlashVisionPreservesNativeInputAndExistingToolSchemaCells(t *testing.T) {
	location := deepseekVisionImage(t, 2)
	spec := deepseekVisionSpec(location)
	for _, stream := range []bool{false, true} {
		wire, err := mustDeepseekBehavior(t, "deepseek-flash").Serialize(spec, stream)
		if err != nil {
			t.Fatal(err)
		}
		var body map[string]any
		if err = json.Unmarshal(wire.Payload, &body); err != nil {
			t.Fatal(err)
		}
		parts := body["messages"].([]any)[0].(map[string]any)["content"].([]any)
		if body["model"] != "deepseek-flash" || body["thinking"].(map[string]any)["type"] != "disabled" || parts[0].(map[string]any)["text"] != "  Describe this image.\n" || parts[1].(map[string]any)["image_url"].(map[string]any)["url"] != location {
			t.Fatal("native image or text changed")
		}
	}
	spec.ResponseFormat = &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT}
	spec.Input[0].Parts[0].Content = &runtimev1.ChatContentPart_Text{Text: "Return JSON for this image."}
	wire, err := mustDeepseekBehavior(t, "deepseek-flash").Serialize(spec, false)
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	_ = json.Unmarshal(wire.Payload, &body)
	if len(body["messages"].([]any)) != 1 {
		t.Fatal("invented extra system cue despite existing JSON text part")
	}
	parsed, err := mustDeepseekBehavior(t, "deepseek-flash").Parse([]byte(`{"choices":[{"index":0,"message":{"content":"{\"ok\":true}"},"finish_reason":"stop"}]}`), spec)
	if err != nil || len(parsed.Items) != 1 {
		t.Fatalf("JSON response: %v", err)
	}
}

func TestDeepseekFlashVisionLimitsAndRoleBoundary(t *testing.T) {
	valid := deepseekVisionSpec(deepseekVisionImage(t, 4097))
	if _, err := mustDeepseekBehavior(t, "deepseek-flash").Serialize(valid, false); err != nil {
		t.Fatal(err)
	}
	many := proto.Clone(valid).(*runtimev1.TextGenerateScenarioSpec)
	for len(many.Input[0].Parts) < 16 {
		many.Input[0].Parts = append(many.Input[0].Parts, proto.Clone(valid.Input[0].Parts[1]).(*runtimev1.ChatContentPart))
	}
	if _, err := mustDeepseekBehavior(t, "deepseek-flash").Serialize(many, false); err == nil {
		t.Fatal("15-image request kept the 8192 side limit")
	}
	for _, role := range []string{"system", "assistant"} {
		s := proto.Clone(valid).(*runtimev1.TextGenerateScenarioSpec)
		s.Input[0].Role = role
		if _, err := mustDeepseekBehavior(t, "deepseek-flash").Serialize(s, false); err == nil {
			t.Fatal("non-user image admitted")
		}
	}
	for _, location := range []string{"https://user:secret@example.com/a.png", "https://example.com/a#part", "http://example.com/a.png", "file:///a.png", "https://example.com/" + strings.Repeat("a", 8192), "data:image/png;base64,YWJj"} {
		if _, err := mustDeepseekBehavior(t, "deepseek-flash").Serialize(deepseekVisionSpec(location), false); err == nil {
			t.Fatal("invalid source admitted")
		}
	}
	s := proto.Clone(valid).(*runtimev1.TextGenerateScenarioSpec)
	s.TopP = proto.Float32(.8)
	if _, err := mustDeepseekBehavior(t, "deepseek-flash").Serialize(s, false); err == nil {
		t.Fatal("ignored top_p accepted")
	}
	s.TopP = proto.Float32(1)
	s.PresencePenalty = proto.Float32(0)
	if _, err := mustDeepseekBehavior(t, "deepseek-flash").Serialize(s, false); err == nil {
		t.Fatal("ignored penalty accepted")
	}
}

func TestDeepseekFlashOwnedBudgetIncludesNativeEnvelope(t *testing.T) {
	spec := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Parts: []*runtimev1.ChatContentPart{{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF, Content: &runtimev1.ChatContentPart_ArtifactRef{ArtifactRef: &runtimev1.ChatContentArtifactRef{ArtifactId: "owned", MimeType: "image/png"}}}}}}}
	captured, budget, err := mustDeepseekBehavior(t, "deepseek-flash").PlanMaterialization(context.Background(), spec, true)
	if err != nil || budget == nil {
		t.Fatal(err)
	}
	if captured == spec || captured.Input[0].Parts[0].GetArtifactRef().GetArtifactId() != "owned" {
		t.Fatal("capture mutated original input")
	}
	if err = budget.Reserve(32 << 20); err != nil {
		t.Fatal(err)
	}
	if err = budget.Reserve(5 << 20); err == nil {
		t.Fatal("base64 plus native overhead exceeded 48 MiB without rejection")
	}
}

func mustDeepseekBehavior(t *testing.T, model string) DeepseekTextBehavior {
	t.Helper()
	profile, err := NewDeepseekTextBehavior(model)
	if err != nil {
		t.Fatal(err)
	}
	return profile
}

package capabilitydriver

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestKimiK3NativeControlsAndSchema(t *testing.T) {
	for _, model := range []string{"kimi-k3.1-pro", "kimi-k3.1-pro-highspeed", "kimi-k3"} {
		t.Run(model, func(t *testing.T) {
			p, err := NewKimiK3TextBehavior(model)
			if err != nil {
				t.Fatal(err)
			}
			s := xaiTestSpec()
			s.MaxTokens = proto.Int32(256)
			schema, _ := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{"answer": map[string]any{"type": "integer"}}, "required": []any{"answer"}, "additionalProperties": false})
			s.ResponseFormat = &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA, Strict: true, JsonSchema: schema}
			wire, err := p.Serialize(s, true)
			if err != nil {
				t.Fatal(err)
			}
			var body map[string]any
			if err := json.Unmarshal(wire.Payload, &body); err != nil {
				t.Error(err)
				return
			}
			if body["max_completion_tokens"] != float64(256) || body["max_tokens"] != nil || body["thinking"] != nil || body["reasoning_effort"] != "max" || body["stream_options"].(map[string]any)["include_usage"] != true || body["response_format"].(map[string]any)["type"] != "json_schema" {
				t.Fatalf("native mapping %+v", body)
			}
			for name, change := range map[string]func(*runtimev1.TextGenerateScenarioSpec){
				"off": func(s *runtimev1.TextGenerateScenarioSpec) {
					s.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED}
				},
				"summary": func(s *runtimev1.TextGenerateScenarioSpec) {
					s.Reasoning = &runtimev1.ReasoningConfig{Presentation: runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY}
				},
				"medium": func(s *runtimev1.TextGenerateScenarioSpec) {
					s.Reasoning = &runtimev1.ReasoningConfig{Intensity: &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_MEDIUM}}
				},
				"temperature": func(s *runtimev1.TextGenerateScenarioSpec) { s.Temperature = proto.Float32(.7) },
				"top p":       func(s *runtimev1.TextGenerateScenarioSpec) { s.TopP = proto.Float32(1) },
				"named tool": func(s *runtimev1.TextGenerateScenarioSpec) {
					s.ToolChoice = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL
					s.ToolChoiceName = "lookup"
				},
				"output bound": func(s *runtimev1.TextGenerateScenarioSpec) { s.MaxTokens = proto.Int32(1048577) },
				"long stop":    func(s *runtimev1.TextGenerateScenarioSpec) { s.Stop = []string{strings.Repeat("a", 33)} },
			} {
				t.Run(name, func(t *testing.T) {
					r := proto.Clone(s).(*runtimev1.TextGenerateScenarioSpec)
					change(r)
					if _, err := p.Serialize(r, false); err == nil {
						t.Fatal("unsupported control accepted")
					}
				})
			}
			for _, answer := range []string{`{"answer":19}`, `{"answer":"wrong"}`} {
				payload := []byte(`{"choices":[{"index":0,"message":{"role":"assistant","reasoning_content":"native private trace","content":` + strconvQuote(answer) + `},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":7,"total_tokens":10}}`)
				result, err := p.Parse(payload, s)
				if answer == `{"answer":19}` {
					if err != nil || len(result.Items) != 2 || result.Items[0].ReasoningContinuity.GetKind() != p.ContinuityKind() {
						t.Fatalf("schema/replay %v %v", result, err)
					}
				} else if err == nil {
					t.Fatal("invalid final schema passed")
				}
			}
		})
	}
}
func strconvQuote(s string) string { raw, _ := json.Marshal(s); return string(raw) }
func TestKimiK3StreamsFinalUsageAndNeverExposesRawThinking(t *testing.T) {
	p, _ := NewKimiK3TextBehavior("kimi-k3.1-pro")
	spec := xaiTestSpec()
	stream, _ := p.Stream(spec)
	var deltas []textbehavior.OrderedDelta
	for _, raw := range []string{
		`{"choices":[{"index":0,"delta":{"reasoning_content":"native "},"finish_reason":null}]}`,
		`{"choices":[{"index":0,"delta":{"reasoning_content":"thinking"},"finish_reason":null}]}`,
		`{"choices":[{"index":0,"delta":{"content":"Answer"},"finish_reason":null}]}`,
		`{"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}`,
		`{"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":22,"total_tokens":33}}`,
		"[DONE]",
	} {
		part, err := stream.Append([]byte(raw))
		if err != nil {
			t.Fatal(err)
		}
		deltas = append(deltas, part...)
	}
	result, err := stream.Finish()
	if err != nil || result.Usage.GetInputTokens() != 11 || result.Usage.GetOutputTokens() != 22 || len(result.Items) != 2 {
		t.Fatalf("stream %v %v", result, err)
	}
	for _, d := range deltas {
		if strings.Contains(d.Text, "thinking") || strings.Contains(d.Text, "native") {
			t.Fatal("raw reasoning exposed")
		}
	}
	replay, err := readNativeReasoningReplay(result.Items[0].ReasoningContinuity, p.ContinuityKind())
	if err != nil || replay != "native thinking" {
		t.Fatal("native replay altered", err)
	}
}
func TestKimiK3VisionAcceptsInlineMP4AndRejectsRemoteHandles(t *testing.T) {
	p, _ := NewKimiK3TextBehavior("kimi-k3.1-pro")
	s := xaiTestSpec()
	s.Input[0].Content = ""
	s.Input[0].Parts = []*runtimev1.ChatContentPart{{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_VIDEO_URL, Content: &runtimev1.ChatContentPart_VideoUrl{VideoUrl: "data:video/mp4;base64," + base64.StdEncoding.EncodeToString([]byte{0, 0, 0, 24, 'f', 't', 'y', 'p', 'i', 's', 'o', 'm'})}}}
	wire, err := p.Serialize(s, false)
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	if err := json.Unmarshal(wire.Payload, &body); err != nil {
		t.Error(err)
		return
	}
	item := body["messages"].([]any)[0].(map[string]any)["content"].([]any)[0].(map[string]any)
	if item["type"] != "video_url" || item["video_url"].(map[string]any)["url"] != s.Input[0].Parts[0].GetVideoUrl() {
		t.Fatal("video replaced by summaries or frames")
	}
	for _, uri := range []string{"https://media.example/video.mp4", "ms://foreign-file", "data:video/mp4;base64,bm90LXZpZGVv"} {
		s.Input[0].Parts[0].Content = &runtimev1.ChatContentPart_VideoUrl{VideoUrl: uri}
		if _, err := p.Serialize(s, false); err == nil {
			t.Fatal("unowned or invalid media accepted")
		}
	}
}

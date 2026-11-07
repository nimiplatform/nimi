package capabilitydriver

import (
	"encoding/json"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

func TestQianfanNativeBoundsAndUnreviewedControls(t *testing.T) {
	p := QianfanTextBehavior{}
	base := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "原文"}}, MaxTokens: proto.Int32(65536), Seed: proto.Int64(1), Stop: []string{strings.Repeat("中", 20)}}
	data, err := p.Serialize(base, false)
	if err != nil {
		t.Fatal(err)
	}
	var b map[string]any
	_ = json.Unmarshal(data.Payload, &b)
	if b["max_tokens"] != float64(65536) || b["max_completion_tokens"] != nil || b["seed"] != float64(1) || b["thinking"] != nil {
		t.Fatal(b)
	}
	for name, change := range map[string]func(*runtimev1.TextGenerateScenarioSpec){
		"seed zero":  func(s *runtimev1.TextGenerateScenarioSpec) { s.Seed = proto.Int64(0) },
		"seed limit": func(s *runtimev1.TextGenerateScenarioSpec) { s.Seed = proto.Int64(2147483647) },
		"output":     func(s *runtimev1.TextGenerateScenarioSpec) { s.MaxTokens = proto.Int32(65537) },
		"stop":       func(s *runtimev1.TextGenerateScenarioSpec) { s.Stop = []string{strings.Repeat("中", 21)} },
		"sampling":   func(s *runtimev1.TextGenerateScenarioSpec) { s.Temperature = proto.Float32(1) },
		"schema": func(s *runtimev1.TextGenerateScenarioSpec) {
			s.ResponseFormat = &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA}
		},
		"thinking": func(s *runtimev1.TextGenerateScenarioSpec) {
			s.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED}
		},
	} {
		t.Run(name, func(t *testing.T) {
			s := proto.Clone(base).(*runtimev1.TextGenerateScenarioSpec)
			change(s)
			if _, err := p.Serialize(s, false); err == nil {
				t.Fatal("unsupported control serialized")
			}
		})
	}
}

func TestQianfanNativeFailureEnvelopesAndIncompleteStreams(t *testing.T) {
	p := QianfanTextBehavior{}
	s := &runtimev1.TextGenerateScenarioSpec{}
	for _, body := range []string{
		`{"code":"invalid_api_key","message":"unauthorized","model":"ernie-5.1","choices":[{"index":0,"message":{"content":"answer"},"finish_reason":"stop"}]}`,
		`{"error":{"code":"invalid_api_key","message":"unauthorized"}}`,
		`{"model":"wrong","choices":[{"index":0,"message":{"content":"answer"},"finish_reason":"stop"}]}`,
		`{"model":"ernie-5.1","choices":[{"index":0,"message":{"content":"answer","reasoning_content":{}},"finish_reason":"stop"}]}`,
		`{"model":"ernie-5.1","choices":[{"index":0,"message":{"content":"answer"},"finish_reason":"content_filter"}]}`,
	} {
		if _, err := p.Parse([]byte(body), s); err == nil {
			t.Fatal("native failure accepted", body)
		}
	}
	stream, _ := p.Stream(s)
	if _, err := stream.Append([]byte(`{"model":"ernie-5.1","choices":[{"index":0,"delta":{"reasoning_content":"private"}}]}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := stream.Append([]byte("[DONE]")); err == nil {
		t.Fatal("unfinished thought accepted")
	}
}

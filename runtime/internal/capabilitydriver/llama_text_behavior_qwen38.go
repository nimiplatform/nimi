package capabilitydriver

import (
	"encoding/json"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.r119
// @nimi-authority: rule.nimi.runtime.ai-provider.r123
// The exact 27B template uses llama.cpp's reviewed OpenAI function, grammar,
// and bounded thinking dialect. Media stays on the independent base path;
// neither this registration nor the qwen35 architecture widens the 4B cohort.
func Qwen38TextBehaviorRequestSerializer(spec *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
	if spec == nil || textbehavior.RequiresOrderedSystemMessages(spec) {
		return textbehavior.SerializedRequest{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED)
	}
	for _, message := range spec.GetInput() {
		for _, part := range message.GetParts() {
			if part.GetType() != runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT {
				return textbehavior.SerializedRequest{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED)
			}
		}
	}
	if llamaBehaviorReasoningEnabled(spec) {
		if effort, ok := spec.GetReasoning().GetIntensity().(*runtimev1.ReasoningConfig_Effort); ok {
			level := map[runtimev1.ReasoningEffort]string{runtimev1.ReasoningEffort_REASONING_EFFORT_LOW: "low", runtimev1.ReasoningEffort_REASONING_EFFORT_MEDIUM: "medium", runtimev1.ReasoningEffort_REASONING_EFFORT_XHIGH: "xhigh"}[effort.Effort]
			if level == "" {
				return textbehavior.SerializedRequest{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED)
			}
			base := proto.Clone(spec).(*runtimev1.TextGenerateScenarioSpec)
			base.Reasoning = nil
			wire, err := Gemma4TextBehaviorRequestSerializer(base, stream)
			if err != nil {
				return textbehavior.SerializedRequest{}, err
			}
			var body map[string]any
			if err := json.Unmarshal(wire.Payload, &body); err != nil {
				return textbehavior.SerializedRequest{}, err
			}
			// This exact GGUF's Jinja accepts low/medium/xhigh. Do not map an
			// effort to an invented token count or widen another Qwen template.
			body["chat_template_kwargs"] = map[string]any{"enable_thinking": true, "reasoning_effort": level}
			body["reasoning_format"] = "deepseek"
			wire.Payload, err = json.Marshal(body)
			return wire, err
		}
	}
	return Gemma4TextBehaviorRequestSerializer(spec, stream)
}

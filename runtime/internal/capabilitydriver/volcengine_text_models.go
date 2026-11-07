package capabilitydriver

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

type VolcengineTextBehavior struct{ model string }

func VolcengineTextModels() []string {
	return []string{"doubao-seed-evolving", "doubao-seed-2-1-pro-260915", "doubao-seed-2-1-lite-260915", "doubao-seed-2-1-turbo-260628", "doubao-seed-2-1-pro-260628", "doubao-seed-2-0-lite-260428", "doubao-seed-2-0-mini-260428", "doubao-seed-2-0-pro-260215", "doubao-seed-2-0-code-preview-260215", "doubao-seed-character-260628", "doubao-seed-character-251128", "glm-5-3-flash-260828", "glm-5-2-260617", "kimi-k3-1-pro-261024", "deepseek-v4-1-flash-261017", "deepseek-v4-1-flash-260910", "deepseek-v4-1-flash-economy-261017", "deepseek-v4-pro-ga-260813", "deepseek-v4-flash-ga-260731", "deepseek-v4-pro-260425"}
}
func NewVolcengineTextBehavior(model string) (VolcengineTextBehavior, error) {
	if !contains(VolcengineTextModels(), model) {
		return VolcengineTextBehavior{}, volcengineTextUnsupported("unreviewed target")
	}
	return VolcengineTextBehavior{model: model}, nil
}
func volcengineTextUnsupported(detail string) error {
	return (&responsesProfile{label: "Volcengine Ark Chat"}).unsupported(detail)
}
func (p VolcengineTextBehavior) EncryptedReasoning() bool {
	return contains([]string{"doubao-seed-evolving", "doubao-seed-2-1-pro-260915", "doubao-seed-2-1-lite-260915", "doubao-seed-2-1-turbo-260628", "doubao-seed-2-1-pro-260628", "doubao-seed-2-0-lite-260428"}, p.model)
}
func (p VolcengineTextBehavior) ContinuityKind() string {
	field := "reasoning-content"
	if p.EncryptedReasoning() {
		field = "encrypted-content"
	}
	return "volcengine." + p.model + "." + field
}
func (p VolcengineTextBehavior) HasThinking() bool {
	return p.model != "doubao-seed-character-251128"
}
func (p VolcengineTextBehavior) AlwaysThinking() bool {
	return p.model == "glm-5-3-flash-260828" || p.model == "kimi-k3-1-pro-261024"
}
func (p VolcengineTextBehavior) Schema() bool {
	return p.model != "doubao-seed-character-251128" && p.model != "doubao-seed-2-0-code-preview-260215" && p.model != "glm-5-3-flash-260828" && p.model != "glm-5-2-260617" && p.model != "deepseek-v4-pro-260425"
}
func (p VolcengineTextBehavior) Vision() bool {
	return p.model != "doubao-seed-character-251128" && p.model != "glm-5-2-260617" && !contains([]string{"deepseek-v4-pro-ga-260813", "deepseek-v4-flash-ga-260731", "deepseek-v4-pro-260425"}, p.model)
}
func (p VolcengineTextBehavior) Audio() bool {
	return contains([]string{"doubao-seed-2-1-lite-260915", "doubao-seed-2-0-lite-260428", "doubao-seed-2-0-mini-260428"}, p.model)
}
func (p VolcengineTextBehavior) deepseek41() bool {
	return strings.HasPrefix(p.model, "deepseek-v4-1-flash-")
}
func (p VolcengineTextBehavior) Efforts() []runtimev1.ReasoningEffort {
	if !p.HasThinking() {
		return nil
	}
	values := []runtimev1.ReasoningEffort{runtimev1.ReasoningEffort_REASONING_EFFORT_MODEL_DEFAULT, runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH}
	if p.model != "glm-5-2-260617" {
		values = append(values, runtimev1.ReasoningEffort_REASONING_EFFORT_LOW)
	}
	if strings.HasPrefix(p.model, "doubao-") {
		values = append(values, runtimev1.ReasoningEffort_REASONING_EFFORT_MEDIUM)
	} else {
		values = append(values, runtimev1.ReasoningEffort_REASONING_EFFORT_MAXIMUM)
	}
	return values
}

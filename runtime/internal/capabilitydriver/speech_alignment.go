package capabilitydriver

import runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"

// @nimi-authority: rule.nimi.runtime.ai-provider.r071
func SpeechAlignmentValid(value *runtimev1.SpeechAlignment) bool {
	if value == nil || (value.Unit != runtimev1.SpeechAlignmentUnit_SPEECH_ALIGNMENT_UNIT_WORD && value.Unit != runtimev1.SpeechAlignmentUnit_SPEECH_ALIGNMENT_UNIT_CHAR) || len(value.Tokens) == 0 {
		return false
	}
	var start, end int64
	for _, token := range value.Tokens {
		if token == nil || token.Token == "" || token.StartMs < start || token.EndMs < end || token.EndMs < token.StartMs || token.EndMs > 1<<53-1 {
			return false
		}
		start, end = token.StartMs, token.EndMs
	}
	return true
}

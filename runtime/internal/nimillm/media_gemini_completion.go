package nimillm

// @nimi-authority: rule.nimi.runtime.ai-provider.r051
// geminiCompletedCandidateParts requires the provider's terminal success before
// accepting media bytes. A valid image/audio container can still be a partial
// result when generation ended at its token limit or was blocked.
func geminiCompletedCandidateParts(value any) ([]any, bool) {
	candidates, ok := value.([]any)
	if !ok || len(candidates) != 1 || ValueAsString(MapField(candidates[0], "finishReason")) != "STOP" {
		return nil, false
	}
	parts, ok := MapField(MapField(candidates[0], "content"), "parts").([]any)
	return parts, ok
}

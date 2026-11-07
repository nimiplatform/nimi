package capabilitydriver

import runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"

func IsVolcengineEmbeddingModel(model string) bool {
	return model == "doubao-embedding-vision-251215" || model == "doubao-embedding-vision-250615"
}

// @nimi-authority: rule.nimi.runtime.ai-provider.embedding-output-contract
// These native instructions form the versioned text retrieval pair. They are
// separate from the original input, and must change protocol identity if edited.
func VolcengineEmbeddingInstructions(model string, purpose runtimev1.TextEmbedPurpose) string {
	if model != "doubao-embedding-vision-251215" {
		return ""
	}
	if purpose == runtimev1.TextEmbedPurpose_TEXT_EMBED_PURPOSE_RETRIEVAL_QUERY {
		return "Target_modality: text.\nInstruction:Given a search query, retrieve relevant text passages that answer the query.\nQuery:"
	}
	return "Instruction:Compress the text into one word.\nQuery:"
}

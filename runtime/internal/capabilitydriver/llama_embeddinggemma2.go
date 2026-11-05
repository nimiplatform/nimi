package capabilitydriver

import (
	"fmt"
	"math"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/ggufmeta"
)

const EmbeddingInputGemma2V1 = "embeddinggemma2/search-prefix-mrl/v1"
const EmbeddingRepresentationGemma2V1 = "embeddinggemma2-retrieval-mrl/v1"
const EmbeddingGemma2Q8ContentID = "sha256:2188ac1deca4b77dffefd603c2776a9d76d9d74ec01841392982ebb840b09135" // pragma: allowlist secret -- public model digest

func embeddingGemma2ContentMatches(contentID, digest string) bool {
	return contentID == EmbeddingGemma2Q8ContentID && digest == strings.TrimPrefix(EmbeddingGemma2Q8ContentID, "sha256:")
}

// @nimi-authority: rule.nimi.runtime.ai-provider.embeddinggemma2-local-retrieval
func embeddingGemma2ModelContract(summary ggufmeta.Summary) bool {
	if summary.Magic != "GGUF" || summary.Version != 3 || summary.TensorCount != 413 || ggufmeta.LLMDetectedArchitecture(summary) != "gemma-embedding2" {
		return false
	}
	for key, want := range map[string]uint64{
		"gemma-embedding2.block_count": 24, "gemma-embedding2.embedding_length": 512,
		"gemma-embedding2.embedding_length_out": 768, "gemma-embedding2.feed_forward_length": 2048,
		"gemma-embedding2.attention.head_count": 4, "gemma-embedding2.pooling_type": 1,
	} {
		if actual, ok := summary.Uint64Value(key); !ok || actual != want {
			return false
		}
	}
	if context, ok := ggufmeta.LLMContextLength(summary); !ok || context < 8192 {
		return false
	}
	for name, shape := range map[string][]uint64{"output.weight": {512, 768}, "token_embd.weight": {512, 262144}, "output_norm.weight": {512}} {
		actual := summary.TensorShapes[name]
		if len(actual) != len(shape) {
			return false
		}
		for i, want := range shape {
			if actual[i] != want {
				return false
			}
		}
	}
	return true
}

func embeddingGemma2OutputDimension(request *runtimev1.TextEmbedScenarioSpec) (int, error) {
	if request == nil {
		return 0, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("embedding request is required"))
	}
	if request.Dimensions == nil {
		return 768, nil
	}
	switch request.GetDimensions() {
	case 128, 256, 512, 768:
		return int(request.GetDimensions()), nil
	}
	return 0, invocationError(InvocationFailureUnsupported, fmt.Errorf("EmbeddingGemma 2 admits only 128, 256, 512 or 768 dimensions"))
}

// @nimi-authority: rule.nimi.runtime.ai-provider.embeddinggemma2-local-retrieval
// The model-authored MRL projection follows validation of the entire native
// vector. A non-finite discarded tail or wrong native width still fails.
func (p *EmbedInvocationPlan) ProjectEmbeddingGemma2Vectors(vectors []*runtimev1.EmbeddingVector) ([]*runtimev1.EmbeddingVector, error) {
	if p == nil || p.representationFamily != EmbeddingRepresentationGemma2V1 || p.outputDimension <= 0 || p.outputDimension > 768 || len(vectors) != p.expectedCount {
		return nil, fmt.Errorf("invalid captured EmbeddingGemma 2 projection")
	}
	result := make([]*runtimev1.EmbeddingVector, len(vectors))
	for i, vector := range vectors {
		if len(vector.GetValues()) != 768 {
			return nil, fmt.Errorf("EmbeddingGemma 2 native width mismatch")
		}
		norm := 0.0
		for j, value := range vector.GetValues() {
			if math.IsNaN(value) || math.IsInf(value, 0) {
				return nil, fmt.Errorf("non-finite EmbeddingGemma 2 output")
			}
			if j < p.outputDimension {
				norm = math.Hypot(norm, value)
			}
		}
		if norm == 0 || math.IsInf(norm, 0) {
			return nil, fmt.Errorf("invalid EmbeddingGemma 2 projected norm")
		}
		values := make([]float64, p.outputDimension)
		for j := range values {
			values[j] = vector.Values[j] / norm
		}
		result[i] = &runtimev1.EmbeddingVector{Values: values}
	}
	return result, nil
}

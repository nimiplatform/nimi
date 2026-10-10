package localexecution

import (
	"context"
	"fmt"
	"math"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

// @nimi-authority: rule.nimi.runtime.speaker-representation.audio-speaker-embedding-result
type SpeakerEmbeddingExecutionHost interface {
	ExecuteSpeakerEmbedding(context.Context, *capabilitydriver.SpeakerEmbeddingInvocationPlan, func() error) (*runtimev1.AudioSpeakerEmbedResult, error)
}

func ValidateSpeakerEmbeddingResult(result *runtimev1.AudioSpeakerEmbedResult, dimension int, requireSpace bool) error {
	if result == nil || dimension < 1 || dimension > 4096 || len(result.GetVector().GetValues()) != dimension || (requireSpace && result.GetSpaceId() == "") {
		return fmt.Errorf("speaker representation does not match captured semantics")
	}
	nonzero := false
	for _, value := range result.GetVector().GetValues() {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return fmt.Errorf("speaker representation is nonfinite")
		}
		nonzero = nonzero || value != 0
	}
	if !nonzero {
		return fmt.Errorf("speaker representation is empty")
	}
	return nil
}

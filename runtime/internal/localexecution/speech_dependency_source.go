package localexecution

import (
	"context"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

type capturedSpeechSourceKey struct{}

func WithCapturedSpeechSource(ctx context.Context, value capabilitydriver.InvocationExactDependencySource) context.Context {
	copy := value
	copy.Hashes = map[string]string{}
	for key, item := range value.Hashes {
		copy.Hashes[key] = item
	}
	copy.VerifiedArtifacts = append([]string(nil), value.VerifiedArtifacts...)
	return context.WithValue(ctx, capturedSpeechSourceKey{}, copy)
}
func CapturedSpeechSourceFromContext(ctx context.Context) (capabilitydriver.InvocationExactDependencySource, bool) {
	value, ok := ctx.Value(capturedSpeechSourceKey{}).(capabilitydriver.InvocationExactDependencySource)
	return value, ok
}

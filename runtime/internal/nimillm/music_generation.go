package nimillm

import (
	"bytes"
	"context"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

// MusicReferenceAudio is Runtime-captured execution material, never a public
// request field or a provider/model selector.
type MusicReferenceAudio struct {
	ArtifactID string `json:"artifact_id"`
	MIMEType   string `json:"mime_type"`
	Bytes      []byte `json:"bytes"`
}
type musicReferenceContextKey struct{}

func WithMusicReferenceAudio(ctx context.Context, reference *MusicReferenceAudio) context.Context {
	if reference == nil {
		return ctx
	}
	copy := *reference
	copy.Bytes = bytes.Clone(reference.Bytes)
	return context.WithValue(ctx, musicReferenceContextKey{}, &copy)
}
func validateMusicAdapterInput(ctx context.Context, spec *runtimev1.MusicGenerateScenarioSpec, extensions map[string]any, allowReference bool) (*MusicReferenceAudio, error) {
	unsupported := func() (*MusicReferenceAudio, error) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	if len(extensions) != 0 || spec.GetScore() != nil || spec.GetReturnGeneratedScore() || spec.Seed != nil {
		return unsupported()
	}
	if spec.GetAudioReference() == nil {
		return nil, nil
	}
	if !allowReference {
		return unsupported()
	}
	reference, _ := ctx.Value(musicReferenceContextKey{}).(*MusicReferenceAudio)
	if reference == nil || reference.ArtifactID != spec.GetAudioReference().GetArtifactId() || reference.MIMEType != "audio/wav" || len(reference.Bytes) == 0 || len(reference.Bytes) > 32<<20 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	}
	return reference, nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.music-generation
func buildMusicGenerationRequest(modelID string, spec *runtimev1.MusicGenerateScenarioSpec, extensions map[string]any) (map[string]any, error) {
	if spec == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	}
	// No current cloud adapter declares the newly typed score/reference/seed
	// paths. Reject them before transport rather than dropping their values.
	if len(extensions) != 0 || spec.GetScore() != nil || spec.GetAudioReference() != nil || spec.Seed != nil || spec.GetReturnGeneratedScore() {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	return map[string]any{"model": modelID, "prompt": spec.GetPrompt(), "lyrics": spec.GetLyrics(), "negative_prompt": spec.GetNegativePrompt(), "style": spec.GetStyle(), "title": spec.GetTitle(), "duration_seconds": spec.GetDurationSeconds(), "instrumental": spec.GetInstrumental()}, nil
}

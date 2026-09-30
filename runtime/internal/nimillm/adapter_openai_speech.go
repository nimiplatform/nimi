package nimillm

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

const adapterOpenAISpeech = "openai_speech_adapter"

// executeOpenAISpeech sends one built-in voice request to the OpenAI speech
// endpoint and keeps the complete MP3 it returns. The endpoint reports no
// usage, so none is estimated.
func (p *CloudProvider) executeOpenAISpeech(
	ctx context.Context,
	request *runtimev1.SubmitScenarioJobRequest,
	modelID string,
	target *RemoteTarget,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	if p == nil || target == nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	backend, backendModelID := p.ResolveMediaBackendWithTarget(modelID, target)
	if backend == nil || strings.TrimSpace(backendModelID) == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	audio, err := backend.synthesizeOpenAISpeech(ctx, backendModelID, scenarioSpeechSynthesizeSpec(request))
	if err != nil {
		return nil, nil, "", err
	}
	artifact := BinaryArtifact("audio/mpeg", audio, map[string]any{"adapter": adapterOpenAISpeech})
	return []*runtimev1.ScenarioArtifact{artifact}, nil, "", nil
}

func (b *Backend) synthesizeOpenAISpeech(ctx context.Context, modelID string, spec *runtimev1.SpeechSynthesizeScenarioSpec) ([]byte, error) {
	text := strings.TrimSpace(spec.GetText())
	voice := spec.GetVoiceRef().GetPresetVoiceId()
	if b == nil || text == "" || spec.GetVoiceRef().GetKind() != runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET || voice == "" ||
		(spec.GetAudioFormat() != "" && !strings.EqualFold(spec.GetAudioFormat(), "mp3")) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	payload := map[string]any{"model": modelID, "input": text, "voice": voice, "response_format": "mp3"}
	if spec.Speed != nil {
		payload["speed"] = spec.GetSpeed()
	}
	audio, err := b.postRaw(ctx, "/v1/audio/speech", payload)
	if err != nil {
		return nil, err
	}
	if !openAISpeechMP3(audio) {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	return audio, nil
}

// openAISpeechMP3 accepts an ID3-tagged file or one that starts with an MPEG
// audio frame.
func openAISpeechMP3(audio []byte) bool {
	if len(audio) >= 10 && string(audio[:3]) == "ID3" {
		return true
	}
	return len(audio) >= 4 && audio[0] == 0xFF && audio[1]&0xE0 == 0xE0
}

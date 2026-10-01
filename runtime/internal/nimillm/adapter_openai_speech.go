package nimillm

import (
	"bytes"
	"context"
	"errors"
	"io"
	"strings"

	"github.com/hajimehoshi/go-mp3"
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
	if !openAISpeechMP3(ctx, audio) {
		if ctx.Err() != nil {
			return nil, MapProviderRequestError(ctx.Err())
		}
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	return audio, nil
}

// openAISpeechMP3 requires nonempty, fully decoded audio. The HTTP byte bound
// and request cancellation/deadline bound the work; PCM is discarded rather
// than accumulated. The original compressed bytes are kept.
func openAISpeechMP3(ctx context.Context, audio []byte) (valid bool) {
	// Invalid compressed bitstreams must not take down the Runtime if the
	// decoder encounters an invalid internal index.
	defer func() {
		if recover() != nil {
			valid = false
		}
	}()
	if len(audio) < 4 || len(audio) > maxJSONOrBinaryResponseBytes {
		return false
	}
	if string(audio[:3]) == "ID3" {
		if len(audio) < 10 {
			return false
		}
		size := 0
		for _, value := range audio[6:10] {
			if value&0x80 != 0 {
				return false
			}
			size = size<<7 | int(value)
		}
		// The decoder allocates the declared tag, so bound it before decoding.
		if size > len(audio)-10 {
			return false
		}
	} else if audio[0] != 0xFF || audio[1]&0xE0 != 0xE0 {
		return false
	}
	decoder, err := mp3.NewDecoder(&completeMP3Reader{Reader: bytes.NewReader(audio), ctx: ctx})
	if err != nil || decoder.Length() <= 0 {
		return false
	}
	decoded, err := io.Copy(io.Discard, decoder)
	return err == nil && decoded > 0 && decoded == decoder.Length() && ctx.Err() == nil
}

// The decoder otherwise treats short reads as EOF and can accept a truncated
// final header or frame. Preserve that distinction through its seekable scan.
type completeMP3Reader struct {
	*bytes.Reader
	ctx context.Context
}

func (r *completeMP3Reader) Read(payload []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	remaining := r.Len()
	count, err := r.Reader.Read(payload)
	if remaining > 0 && remaining < len(payload) {
		return count, errors.New("truncated MP3 data")
	}
	return count, err
}

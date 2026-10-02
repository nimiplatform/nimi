package nimillm

import (
	"bytes"
	"context"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"mime/multipart"
	"net/http"
	"strings"
	"time"
)

type MusicReferenceVideo struct {
	ArtifactID string `json:"artifact_id"`
	MIMEType   string `json:"mime_type"`
	Bytes      []byte `json:"bytes"`
}
type musicVideoContextKey struct{}

func WithMusicReferenceVideo(ctx context.Context, value *MusicReferenceVideo) context.Context {
	if value == nil {
		return ctx
	}
	copy := *value
	copy.Bytes = bytes.Clone(value.Bytes)
	return context.WithValue(ctx, musicVideoContextKey{}, &copy)
}

// @nimi-authority: rule.nimi.runtime.ai-provider.music-generation
// The selected model consumes either native composition input or the complete
// Runtime-captured video. No App URL, transcript or alternate route replaces it.
func ExecuteElevenLabsMusic(ctx context.Context, cfg MediaAdapterConfig, request *runtimev1.SubmitScenarioJobRequest, model string) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
	spec := request.GetSpec().GetMusicGenerate()
	if model != "music_v2" || spec == nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	key, err := requireProviderAPIKey(cfg.APIKey)
	if err != nil {
		return nil, nil, "", err
	}
	base := strings.TrimRight(cfg.BaseURL, "/")
	if base == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	backend := NewBackend("cloud-elevenlabs-music", base, "", 10*time.Minute)
	headers := map[string]string{"xi-api-key": key}
	var body *JSONOrBinaryBody
	if spec.GetVideoReference() != nil {
		reference, _ := ctx.Value(musicVideoContextKey{}).(*MusicReferenceVideo)
		if reference == nil || reference.ArtifactID != spec.GetVideoReference().GetArtifactId() || reference.MIMEType != "video/mp4" || len(reference.Bytes) == 0 || len(reference.Bytes) > 32<<20 {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
		}
		body, err = doMultipartMusicRequest(ctx, backend, JoinURL(base, "/v1/music/video-to-music"), headers, func(writer *multipart.Writer) error {
			if err := writer.WriteField("model_id", model); err != nil {
				return err
			}
			if err := writer.WriteField("description", spec.GetPrompt()); err != nil {
				return err
			}
			file, err := writer.CreateFormFile("videos[]", "condition.mp4")
			if err != nil {
				return err
			}
			_, err = file.Write(reference.Bytes)
			return err
		})
	} else {
		body, err = doJSONOrBinaryRequestWithBackend(ctx, backend, http.MethodPost, JoinURL(base, "/v1/music"), map[string]any{"model_id": model, "prompt": spec.GetPrompt(), "music_length_ms": spec.GetDurationSeconds() * 1000, "force_instrumental": spec.GetInstrumental()}, headers)
	}
	if err != nil {
		return nil, nil, "", err
	}
	if body == nil || len(body.Bytes) == 0 {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	// This binary protocol provides no provider usage. Audio bytes and prompt
	// length are not token or billing facts.
	return []*runtimev1.ScenarioArtifact{BinaryArtifact(body.MIME, body.Bytes, map[string]any{"adapter": "elevenlabs_music_adapter"})}, nil, "", nil
}

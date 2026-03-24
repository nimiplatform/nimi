package nimillm

import (
	"context"
	"net/http"
	"net/url"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

// ---------------------------------------------------------------------------
// MIME resolution
// ---------------------------------------------------------------------------

// ResolveImageArtifactMIME determines the MIME type for an image artifact
// from the spec response_format or content detection.
func ResolveImageArtifactMIME(spec *runtimev1.ImageGenerateScenarioSpec, payload []byte) string {
	responseFormat := ""
	if spec != nil {
		responseFormat = strings.ToLower(strings.TrimSpace(spec.GetResponseFormat()))
	}
	switch responseFormat {
	case "png", "image/png", "b64_json":
		return "image/png"
	case "jpeg", "jpg", "image/jpeg":
		return "image/jpeg"
	case "webp", "image/webp":
		return "image/webp"
	}
	detected := strings.TrimSpace(http.DetectContentType(payload))
	if strings.HasPrefix(detected, "image/") {
		return detected
	}
	return "image/png"
}

// ResolveVideoArtifactMIME determines the MIME type for a video artifact.
func ResolveVideoArtifactMIME(spec *runtimev1.VideoGenerateScenarioSpec, payload []byte) string {
	detected := strings.TrimSpace(http.DetectContentType(payload))
	if strings.HasPrefix(detected, "video/") {
		return detected
	}
	return "video/mp4"
}

// ResolveSpeechArtifactMIME determines the MIME type for a speech artifact
// from the spec audio_format or content detection.
func ResolveSpeechArtifactMIME(spec *runtimev1.SpeechSynthesizeScenarioSpec, payload []byte) string {
	audioFormat := ""
	if spec != nil {
		audioFormat = strings.ToLower(strings.TrimSpace(spec.GetAudioFormat()))
	}
	switch audioFormat {
	case "wav", "audio/wav":
		return "audio/wav"
	case "mp3", "mpeg", "audio/mpeg":
		return "audio/mpeg"
	case "ogg", "audio/ogg":
		return "audio/ogg"
	case "flac", "audio/flac":
		return "audio/flac"
	}
	detected := strings.TrimSpace(http.DetectContentType(payload))
	if strings.HasPrefix(detected, "audio/") {
		return detected
	}
	return "audio/mpeg"
}

// ResolveTranscriptionArtifactMIME determines the MIME type for a
// transcription artifact from the spec response_format.
func ResolveTranscriptionArtifactMIME(spec *runtimev1.SpeechTranscribeScenarioSpec) string {
	responseFormat := ""
	if spec != nil {
		responseFormat = strings.ToLower(strings.TrimSpace(spec.GetResponseFormat()))
	}
	switch responseFormat {
	case "json", "application/json":
		return "application/json"
	case "srt", "text/srt":
		return "text/srt"
	case "vtt", "text/vtt":
		return "text/vtt"
	default:
		return "text/plain"
	}
}

// ---------------------------------------------------------------------------
// Spec metadata
// ---------------------------------------------------------------------------

// ApplyImageSpecMetadata applies image spec metadata (dimensions from size)
// onto the artifact.
func ApplyImageSpecMetadata(artifact *runtimev1.ScenarioArtifact, spec *runtimev1.ImageGenerateScenarioSpec) {
	if artifact == nil || spec == nil {
		return
	}
	if width, height := ParseDimensionPair(spec.GetSize()); width > 0 && height > 0 {
		artifact.Width = width
		artifact.Height = height
	}
}

// ApplyVideoSpecMetadata applies video spec metadata (duration, fps,
// resolution) onto the artifact.
func ApplyVideoSpecMetadata(artifact *runtimev1.ScenarioArtifact, spec *runtimev1.VideoGenerateScenarioSpec) {
	if artifact == nil || spec == nil {
		return
	}
	if durationSec := VideoDurationSec(spec); durationSec > 0 {
		artifact.DurationMs = int64(durationSec) * 1000
	}
	if fps := VideoFPS(spec); fps > 0 {
		artifact.Fps = fps
	}
	if width, height := ParseDimensionPair(VideoResolution(spec)); width > 0 && height > 0 {
		artifact.Width = width
		artifact.Height = height
	}
}

// ApplySpeechSpecMetadata applies speech spec metadata (sample rate) onto
// the artifact.
func ApplySpeechSpecMetadata(artifact *runtimev1.ScenarioArtifact, spec *runtimev1.SpeechSynthesizeScenarioSpec) {
	if artifact == nil || spec == nil {
		return
	}
	if spec.GetSampleRateHz() > 0 {
		artifact.SampleRateHz = spec.GetSampleRateHz()
	}
}

// ApplyMusicSpecMetadata applies music generation spec metadata onto the artifact.
func ApplyMusicSpecMetadata(artifact *runtimev1.ScenarioArtifact, spec *runtimev1.MusicGenerateScenarioSpec) {
	if artifact == nil || spec == nil {
		return
	}
	if spec.GetDurationSeconds() > 0 {
		artifact.DurationMs = int64(spec.GetDurationSeconds()) * 1000
	}
}

// ApplyTranscriptionSpecMetadata applies transcription spec metadata (audio
// URI, speaker count) onto the artifact.
func ApplyTranscriptionSpecMetadata(artifact *runtimev1.ScenarioArtifact, spec *runtimev1.SpeechTranscribeScenarioSpec, audioURI string) {
	if artifact == nil || spec == nil {
		return
	}
	if strings.TrimSpace(audioURI) != "" {
		artifact.Uri = strings.TrimSpace(audioURI)
	}
	if spec.GetSpeakerCount() > 0 {
		artifact.Channels = spec.GetSpeakerCount()
	}
}

// ---------------------------------------------------------------------------
// Audio source
// ---------------------------------------------------------------------------

// ResolveTranscriptionAudioSource resolves audio bytes, MIME type, and URI
// from a SpeechTranscribeScenarioSpec, handling bytes, URI, and chunked sources.
func ResolveTranscriptionAudioSource(ctx context.Context, spec *runtimev1.SpeechTranscribeScenarioSpec) ([]byte, string, string, error) {
	if spec == nil {
		return nil, "", "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	mimeType := strings.TrimSpace(spec.GetMimeType())
	if source := spec.GetAudioSource(); source != nil {
		switch typed := source.GetSource().(type) {
		case *runtimev1.SpeechTranscriptionAudioSource_AudioBytes:
			audio := append([]byte(nil), typed.AudioBytes...)
			if len(audio) == 0 {
				return nil, "", "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
			}
			return audio, mimeType, "", nil
		case *runtimev1.SpeechTranscriptionAudioSource_AudioUri:
			audioURI := strings.TrimSpace(typed.AudioUri)
			if audioURI == "" {
				return nil, "", "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
			}
			audio, detectedMIME, err := FetchAudioFromURI(ctx, audioURI)
			if err != nil {
				return nil, "", "", err
			}
			if mimeType == "" {
				mimeType = detectedMIME
			}
			return audio, mimeType, audioURI, nil
		case *runtimev1.SpeechTranscriptionAudioSource_AudioChunks:
			if typed.AudioChunks == nil {
				return nil, "", "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
			}
			audio := JoinAudioChunks(typed.AudioChunks.GetChunks())
			if len(audio) == 0 {
				return nil, "", "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
			}
			return audio, mimeType, "", nil
		}
	}
	return nil, "", "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
}

// FetchAudioFromURI downloads audio from a URI and returns the bytes, Content-Type,
// and any error.
func FetchAudioFromURI(ctx context.Context, audioURI string) ([]byte, string, error) {
	parsed, err := url.Parse(strings.TrimSpace(audioURI))
	if err != nil || parsed == nil || parsed.Scheme == "" {
		return nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	client, err := newSecuredHTTPClient(parsed.String(), allowLoopbackForTargetURL(parsed.String()))
	if err != nil {
		return nil, "", err
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	payload, err := readLimitedResponseBody(response.Body, maxDecodedMediaURLBytes)
	if err != nil || len(payload) == 0 {
		return nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	return payload, strings.TrimSpace(response.Header.Get("Content-Type")), nil
}

// JoinAudioChunks concatenates multiple audio byte chunks into one slice.
func JoinAudioChunks(chunks [][]byte) []byte {
	total := 0
	for _, chunk := range chunks {
		total += len(chunk)
	}
	if total == 0 {
		return nil
	}
	joined := make([]byte, 0, total)
	for _, chunk := range chunks {
		joined = append(joined, chunk...)
	}
	return joined
}

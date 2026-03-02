package nimillm

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

// JSONOrBinaryBody holds a parsed HTTP response body that may be JSON text,
// base64-decoded binary, or raw binary bytes.
type JSONOrBinaryBody struct {
	Bytes []byte
	Text  string
	MIME  string
}

// DoJSONOrBinaryRequest performs an HTTP request with a JSON body and returns
// the response parsed as either JSON (extracting text/audio fields) or raw
// binary bytes.
func DoJSONOrBinaryRequest(ctx context.Context, method, targetURL, apiKey string, body any) (*JSONOrBinaryBody, error) {
	requestBody, err := json.Marshal(body)
	if err != nil {
		return nil, MapProviderRequestError(err)
	}
	request, err := http.NewRequestWithContext(ctx, method, targetURL, strings.NewReader(string(requestBody)))
	if err != nil {
		return nil, MapProviderRequestError(err)
	}
	request.Header.Set("Content-Type", "application/json")
	if strings.TrimSpace(apiKey) != "" {
		request.Header.Set("Authorization", "Bearer "+strings.TrimSpace(apiKey))
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return nil, MapProviderRequestError(err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var payload map[string]any
		_ = json.NewDecoder(response.Body).Decode(&payload)
		return nil, MapProviderHTTPError(response.StatusCode, payload)
	}
	raw, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	contentType := strings.ToLower(strings.TrimSpace(response.Header.Get("Content-Type")))
	looksLikeJSON := len(raw) > 0 && (raw[0] == '{' || raw[0] == '[')
	if strings.Contains(contentType, "application/json") || looksLikeJSON {
		parsed := map[string]any{}
		if unmarshalErr := json.Unmarshal(raw, &parsed); unmarshalErr == nil {
			if text := strings.TrimSpace(FirstNonEmpty(
				ValueAsString(parsed["text"]),
				ValueAsString(MapField(parsed["result"], "text")),
			)); text != "" {
				return &JSONOrBinaryBody{Bytes: []byte(text), Text: text, MIME: contentType}, nil
			}
			if b64 := strings.TrimSpace(FirstNonEmpty(
				ValueAsString(parsed["audio"]),
				ValueAsString(parsed["audio_base64"]),
				ValueAsString(parsed["b64_json"]),
				ValueAsString(MapField(parsed["result"], "audio")),
				ValueAsString(MapField(parsed["result"], "audio_base64")),
				ValueAsString(MapField(parsed["data"], "audio")),
				ValueAsString(MapField(parsed["data"], "audio_base64")),
				ValueAsString(MapField(parsed["output"], "audio")),
			)); b64 != "" {
				decoded, decodeErr := base64.StdEncoding.DecodeString(b64)
				if decodeErr == nil {
					return &JSONOrBinaryBody{Bytes: decoded, MIME: contentType}, nil
				}
			}
		}
	}
	return &JSONOrBinaryBody{Bytes: raw, MIME: contentType}, nil
}

// DoJSONRequest performs an HTTP request expecting a JSON response. If body is
// nil no request body is sent. If target is nil the response body is discarded.
func DoJSONRequest(ctx context.Context, method, targetURL, apiKey string, body any, target *map[string]any) error {
	var requestBody io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return MapProviderRequestError(err)
		}
		requestBody = strings.NewReader(string(raw))
	}
	request, err := http.NewRequestWithContext(ctx, method, targetURL, requestBody)
	if err != nil {
		return MapProviderRequestError(err)
	}
	request.Header.Set("Accept", "application/json")
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if strings.TrimSpace(apiKey) != "" {
		request.Header.Set("Authorization", "Bearer "+strings.TrimSpace(apiKey))
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return MapProviderRequestError(err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var payload map[string]any
		_ = json.NewDecoder(response.Body).Decode(&payload)
		return MapProviderHTTPError(response.StatusCode, payload)
	}
	if target == nil {
		return nil
	}
	if err := json.NewDecoder(response.Body).Decode(target); err != nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	return nil
}

// JoinURL joins a base URL with a suffix path. If the suffix is already an
// absolute URL it is returned as-is.
func JoinURL(baseURL string, suffix string) string {
	base := strings.TrimSuffix(strings.TrimSpace(baseURL), "/")
	if base == "" {
		return ""
	}
	suffixPath := strings.TrimSpace(suffix)
	if suffixPath == "" {
		return base
	}
	if strings.HasPrefix(suffixPath, "http://") || strings.HasPrefix(suffixPath, "https://") {
		return suffixPath
	}
	if !strings.HasPrefix(suffixPath, "/") {
		suffixPath = "/" + suffixPath
	}
	return base + suffixPath
}

// ---------------------------------------------------------------------------
// Artifact helpers
// ---------------------------------------------------------------------------

// BinaryArtifact creates a MediaArtifact from raw bytes, computing SHA-256,
// detecting MIME type, and extracting metadata from providerRaw.
func BinaryArtifact(mimeType string, payload []byte, providerRaw map[string]any) *runtimev1.MediaArtifact {
	if len(payload) == 0 {
		payload = []byte{}
	}
	sum := sha256.Sum256(payload)
	resolvedMIME := strings.TrimSpace(mimeType)
	if resolvedMIME == "" {
		detected := strings.TrimSpace(http.DetectContentType(payload))
		if detected != "" {
			resolvedMIME = detected
		}
	}
	if resolvedMIME == "" {
		resolvedMIME = "application/octet-stream"
	}
	artifact := &runtimev1.MediaArtifact{
		ArtifactId: ulid.Make().String(),
		MimeType:   resolvedMIME,
		Bytes:      append([]byte(nil), payload...),
		Sha256:     fmt.Sprintf("%x", sum),
		SizeBytes:  int64(len(payload)),
	}
	if len(providerRaw) > 0 {
		if uri := strings.TrimSpace(FirstNonEmpty(
			ValueAsString(providerRaw["uri"]),
			ValueAsString(providerRaw["url"]),
		)); uri != "" {
			artifact.Uri = uri
		}
		if durationMS := ValueAsInt64(FirstNonNil(providerRaw["duration_ms"], providerRaw["durationMs"])); durationMS > 0 {
			artifact.DurationMs = durationMS
		} else if durationSec := ValueAsInt64(FirstNonNil(providerRaw["duration_sec"], providerRaw["durationSec"])); durationSec > 0 {
			artifact.DurationMs = durationSec * 1000
		}
		if fps := ValueAsInt32(providerRaw["fps"]); fps > 0 {
			artifact.Fps = fps
		}
		if width := ValueAsInt32(providerRaw["width"]); width > 0 {
			artifact.Width = width
		}
		if height := ValueAsInt32(providerRaw["height"]); height > 0 {
			artifact.Height = height
		}
		if artifact.GetWidth() == 0 || artifact.GetHeight() == 0 {
			if width, height := ParseDimensionPair(FirstNonEmpty(
				ValueAsString(providerRaw["size"]),
				ValueAsString(providerRaw["resolution"]),
			)); width > 0 && height > 0 {
				artifact.Width = width
				artifact.Height = height
			}
		}
		if sampleRate := ValueAsInt32(FirstNonNil(providerRaw["sample_rate_hz"], providerRaw["sampleRateHz"])); sampleRate > 0 {
			artifact.SampleRateHz = sampleRate
		}
		if channels := ValueAsInt32(providerRaw["channels"]); channels > 0 {
			artifact.Channels = channels
		}
		artifact.ProviderRaw = ToStruct(providerRaw)
	}
	return artifact
}

// ToStruct converts a Go map to a protobuf Struct. Returns nil if the map is
// empty or conversion fails.
func ToStruct(input map[string]any) *structpb.Struct {
	if len(input) == 0 {
		return nil
	}
	value, err := structpb.NewStruct(input)
	if err != nil {
		return nil
	}
	return value
}

// ParseDimensionPair parses a "WxH" or "W*H" string into width and height.
func ParseDimensionPair(raw string) (int32, int32) {
	value := strings.ToLower(strings.TrimSpace(raw))
	if value == "" {
		return 0, 0
	}
	value = strings.ReplaceAll(value, " ", "")
	for _, separator := range []string{"x", "*"} {
		parts := strings.Split(value, separator)
		if len(parts) != 2 {
			continue
		}
		width, widthErr := strconv.ParseInt(parts[0], 10, 32)
		height, heightErr := strconv.ParseInt(parts[1], 10, 32)
		if widthErr == nil && heightErr == nil && width > 0 && height > 0 {
			return int32(width), int32(height)
		}
	}
	return 0, 0
}

// ---------------------------------------------------------------------------
// MIME resolution
// ---------------------------------------------------------------------------

// ResolveImageArtifactMIME determines the MIME type for an image artifact
// from the spec response_format or content detection.
func ResolveImageArtifactMIME(spec *runtimev1.ImageGenerationSpec, payload []byte) string {
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
func ResolveVideoArtifactMIME(spec *runtimev1.VideoGenerationSpec, payload []byte) string {
	detected := strings.TrimSpace(http.DetectContentType(payload))
	if strings.HasPrefix(detected, "video/") {
		return detected
	}
	return "video/mp4"
}

// ResolveSpeechArtifactMIME determines the MIME type for a speech artifact
// from the spec audio_format or content detection.
func ResolveSpeechArtifactMIME(spec *runtimev1.SpeechSynthesisSpec, payload []byte) string {
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
func ResolveTranscriptionArtifactMIME(spec *runtimev1.SpeechTranscriptionSpec) string {
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
func ApplyImageSpecMetadata(artifact *runtimev1.MediaArtifact, spec *runtimev1.ImageGenerationSpec) {
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
func ApplyVideoSpecMetadata(artifact *runtimev1.MediaArtifact, spec *runtimev1.VideoGenerationSpec) {
	if artifact == nil || spec == nil {
		return
	}
	if spec.GetDurationSec() > 0 {
		artifact.DurationMs = int64(spec.GetDurationSec()) * 1000
	}
	if spec.GetFps() > 0 {
		artifact.Fps = spec.GetFps()
	}
	if width, height := ParseDimensionPair(spec.GetResolution()); width > 0 && height > 0 {
		artifact.Width = width
		artifact.Height = height
	}
}

// ApplySpeechSpecMetadata applies speech spec metadata (sample rate) onto
// the artifact.
func ApplySpeechSpecMetadata(artifact *runtimev1.MediaArtifact, spec *runtimev1.SpeechSynthesisSpec) {
	if artifact == nil || spec == nil {
		return
	}
	if spec.GetSampleRateHz() > 0 {
		artifact.SampleRateHz = spec.GetSampleRateHz()
	}
}

// ApplyTranscriptionSpecMetadata applies transcription spec metadata (audio
// URI, speaker count) onto the artifact.
func ApplyTranscriptionSpecMetadata(artifact *runtimev1.MediaArtifact, spec *runtimev1.SpeechTranscriptionSpec, audioURI string) {
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
// from a SpeechTranscriptionSpec, handling bytes, URI, and chunked sources.
func ResolveTranscriptionAudioSource(ctx context.Context, spec *runtimev1.SpeechTranscriptionSpec) ([]byte, string, string, error) {
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
	if len(spec.GetAudioBytes()) > 0 {
		return append([]byte(nil), spec.GetAudioBytes()...), mimeType, "", nil
	}
	if uriText := strings.TrimSpace(spec.GetAudioUri()); uriText != "" {
		audio, detectedMIME, err := FetchAudioFromURI(ctx, uriText)
		if err != nil {
			return nil, "", "", err
		}
		if mimeType == "" {
			mimeType = detectedMIME
		}
		return audio, mimeType, uriText, nil
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
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	payload, err := io.ReadAll(response.Body)
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

// ---------------------------------------------------------------------------
// Async task helpers
// ---------------------------------------------------------------------------

// ExtractTaskIDFromPayload extracts a task/job ID from a provider response
// payload, searching common field names and nested objects.
func ExtractTaskIDFromPayload(payload map[string]any) string {
	if payload == nil {
		return ""
	}
	return strings.TrimSpace(FirstNonEmpty(
		ValueAsString(payload["task_id"]),
		ValueAsString(payload["taskId"]),
		ValueAsString(payload["id"]),
		ValueAsString(MapField(payload["task"], "id")),
		ValueAsString(MapField(payload["task"], "task_id")),
		ValueAsString(MapField(payload["result"], "id")),
		ValueAsString(MapField(payload["result"], "task_id")),
		ValueAsString(MapField(payload["data"], "id")),
		ValueAsString(MapField(payload["data"], "task_id")),
		ValueAsString(MapField(payload["output"], "id")),
		ValueAsString(MapField(payload["output"], "task_id")),
	))
}

// ResolveAsyncTaskStatus extracts and normalises the status string from a
// provider async task response.
func ResolveAsyncTaskStatus(payload map[string]any) string {
	if payload == nil {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(FirstNonEmpty(
		ValueAsString(payload["status"]),
		ValueAsString(payload["task_status"]),
		ValueAsString(MapField(payload["result"], "status")),
		ValueAsString(MapField(payload["result"], "task_status")),
		ValueAsString(MapField(payload["data"], "status")),
		ValueAsString(MapField(payload["data"], "task_status")),
		ValueAsString(MapField(payload["output"], "status")),
		ValueAsString(MapField(payload["output"], "task_status")),
	)))
}

// IsAsyncTaskPendingStatus returns true if the status text indicates the task
// is still in progress.
func IsAsyncTaskPendingStatus(statusText string) bool {
	switch strings.ToLower(strings.TrimSpace(statusText)) {
	case "", "submitted", "queued", "pending", "running", "processing", "in_progress":
		return true
	default:
		return false
	}
}

// IsAsyncTaskFailedStatus returns true if the status text indicates the task
// has failed.
func IsAsyncTaskFailedStatus(statusText string) bool {
	switch strings.ToLower(strings.TrimSpace(statusText)) {
	case "failed", "error", "canceled", "cancelled":
		return true
	default:
		return false
	}
}

// ExtractTaskArtifactBytesAndMIME extracts artifact bytes, MIME type, and URI
// from a provider async task response, searching nested result/data/output
// objects.
func ExtractTaskArtifactBytesAndMIME(payload map[string]any) ([]byte, string, string) {
	if artifactBytes, mimeType, artifactURI := ExtractArtifactBytesAndMIME(payload); len(artifactBytes) > 0 {
		return artifactBytes, mimeType, artifactURI
	}
	if artifactBytes, mimeType, artifactURI := ExtractImageArtifactFromAny(payload["result"]); len(artifactBytes) > 0 {
		return artifactBytes, mimeType, artifactURI
	}
	if artifactBytes, mimeType, artifactURI := ExtractImageArtifactFromAny(payload["data"]); len(artifactBytes) > 0 {
		return artifactBytes, mimeType, artifactURI
	}
	if artifactBytes, mimeType, artifactURI := ExtractImageArtifactFromAny(payload["output"]); len(artifactBytes) > 0 {
		return artifactBytes, mimeType, artifactURI
	}
	return nil, "", ""
}

// ResolveTaskQueryPath substitutes a provider job ID into a query path
// template, replacing {task_id} or appending it.
func ResolveTaskQueryPath(queryTemplate, providerJobID string) string {
	template := strings.TrimSpace(queryTemplate)
	if template == "" {
		return ""
	}
	taskID := url.PathEscape(strings.TrimSpace(providerJobID))
	if taskID == "" {
		return template
	}
	if strings.Contains(template, "{task_id}") {
		return strings.ReplaceAll(template, "{task_id}", taskID)
	}
	if strings.HasSuffix(template, "/") {
		return template + taskID
	}
	return template + "/" + taskID
}

// ---------------------------------------------------------------------------
// Artifact extraction
// ---------------------------------------------------------------------------

// ExtractArtifactBytesAndMIME extracts artifact bytes (binary or text) from a
// provider response payload.
func ExtractArtifactBytesAndMIME(payload map[string]any) ([]byte, string, string) {
	if payload == nil {
		return nil, "", ""
	}
	if artifactBytes, mimeType, artifactURI := ExtractBinaryArtifactBytesAndMIME(payload); len(artifactBytes) > 0 {
		return artifactBytes, mimeType, artifactURI
	}
	if text := strings.TrimSpace(FirstNonEmpty(
		ValueAsString(payload["artifact_text"]),
		ValueAsString(payload["text"]),
		ValueAsString(MapField(payload["result"], "text")),
	)); text != "" {
		return []byte(text), "text/plain", ""
	}
	return nil, "", ""
}

// ExtractBinaryArtifactBytesAndMIME extracts binary artifact bytes from a
// provider response payload by checking base64 fields then downloading URLs.
func ExtractBinaryArtifactBytesAndMIME(payload map[string]any) ([]byte, string, string) {
	if payload == nil {
		return nil, "", ""
	}
	paths := []string{
		ValueAsString(payload["b64_json"]),
		ValueAsString(payload["b64_mp4"]),
		ValueAsString(payload["audio"]),
		ValueAsString(payload["audio_base64"]),
		ValueAsString(MapField(payload["artifact"], "b64_json")),
		ValueAsString(MapField(payload["artifact"], "b64_mp4")),
		ValueAsString(MapField(payload["artifact"], "audio")),
		ValueAsString(MapField(payload["artifact"], "audio_base64")),
		ValueAsString(MapField(payload["result"], "b64_json")),
		ValueAsString(MapField(payload["result"], "b64_mp4")),
		ValueAsString(MapField(payload["result"], "audio")),
		ValueAsString(MapField(payload["result"], "audio_base64")),
		ValueAsString(MapField(payload["data"], "audio")),
		ValueAsString(MapField(payload["data"], "audio_base64")),
		ValueAsString(MapField(payload["output"], "audio")),
		// DashScope qwen3-tts: output.audio is a nested object with data field
		ValueAsString(MapField(MapField(payload["output"], "audio"), "data")),
	}
	for _, raw := range paths {
		trimmed := strings.TrimSpace(raw)
		if trimmed == "" {
			continue
		}
		decoded, err := base64.StdEncoding.DecodeString(trimmed)
		if err == nil && len(decoded) > 0 {
			return decoded, FirstNonEmpty(
				ValueAsString(payload["mime_type"]),
				ValueAsString(MapField(payload["artifact"], "mime_type")),
				ValueAsString(MapField(payload["result"], "mime_type")),
			), ""
		}
	}
	artifactURI := strings.TrimSpace(FirstNonEmpty(
		ValueAsString(payload["url"]),
		ValueAsString(payload["audio_url"]),
		ValueAsString(MapField(payload["artifact"], "url")),
		ValueAsString(MapField(payload["artifact"], "audio_url")),
		ValueAsString(MapField(payload["result"], "url")),
		ValueAsString(MapField(payload["result"], "audio_url")),
		ValueAsString(MapField(payload["data"], "url")),
		ValueAsString(MapField(payload["data"], "audio_url")),
		ValueAsString(MapField(payload["output"], "url")),
		ValueAsString(MapField(payload["output"], "audio_url")),
		// DashScope qwen3-tts: output.audio is a nested object with url field
		ValueAsString(MapField(MapField(payload["output"], "audio"), "url")),
	))
	if artifactURI != "" {
		response, err := http.Get(artifactURI) //nolint:gosec
		if err == nil {
			defer response.Body.Close()
			if response.StatusCode >= 200 && response.StatusCode < 300 {
				raw, readErr := io.ReadAll(response.Body)
				if readErr == nil && len(raw) > 0 {
					return raw, FirstNonEmpty(
						ValueAsString(payload["mime_type"]),
						response.Header.Get("Content-Type"),
					), artifactURI
				}
			}
		}
	}
	return nil, "", ""
}

// ExtractImageArtifactFromAny recursively extracts image artifact bytes from
// a generic value (map, slice, or URL string).
func ExtractImageArtifactFromAny(value any) ([]byte, string, string) {
	switch typed := value.(type) {
	case map[string]any:
		return ExtractImageArtifactFromMap(typed)
	case []any:
		for _, item := range typed {
			if artifactBytes, mimeType, artifactURI := ExtractImageArtifactFromAny(item); len(artifactBytes) > 0 {
				return artifactBytes, mimeType, artifactURI
			}
		}
	case string:
		uri := strings.TrimSpace(typed)
		if strings.HasPrefix(uri, "http://") || strings.HasPrefix(uri, "https://") {
			return ExtractBinaryArtifactBytesAndMIME(map[string]any{
				"url": uri,
			})
		}
	}
	return nil, "", ""
}

// ExtractImageArtifactFromMap extracts image artifact bytes from a map by
// checking binary fields, base64 fields, image_url nesting, and content/message
// recursion.
func ExtractImageArtifactFromMap(payload map[string]any) ([]byte, string, string) {
	if payload == nil {
		return nil, "", ""
	}
	if artifactBytes, mimeType, artifactURI := ExtractBinaryArtifactBytesAndMIME(payload); len(artifactBytes) > 0 {
		return artifactBytes, mimeType, artifactURI
	}

	mimeType := FirstNonEmpty(
		ValueAsString(payload["mime_type"]),
		ValueAsString(payload["content_type"]),
	)
	for _, key := range []string{"b64_json", "image_base64", "base64", "data", "image"} {
		if decoded, ok := DecodeBase64ArtifactPayload(ValueAsString(payload[key])); ok {
			return decoded, mimeType, ""
		}
	}
	if imageURL := payload["image_url"]; imageURL != nil {
		switch typed := imageURL.(type) {
		case string:
			return ExtractBinaryArtifactBytesAndMIME(map[string]any{
				"url":       typed,
				"mime_type": mimeType,
			})
		case map[string]any:
			if artifactBytes, nestedMIME, artifactURI := ExtractImageArtifactFromMap(typed); len(artifactBytes) > 0 {
				return artifactBytes, FirstNonEmpty(mimeType, nestedMIME), artifactURI
			}
		}
	}
	if artifactBytes, nestedMIME, artifactURI := ExtractImageArtifactFromAny(payload["content"]); len(artifactBytes) > 0 {
		return artifactBytes, FirstNonEmpty(mimeType, nestedMIME), artifactURI
	}
	if artifactBytes, nestedMIME, artifactURI := ExtractImageArtifactFromAny(payload["message"]); len(artifactBytes) > 0 {
		return artifactBytes, FirstNonEmpty(mimeType, nestedMIME), artifactURI
	}
	return nil, "", ""
}

// DecodeBase64ArtifactPayload decodes a possibly data-URI-prefixed base64
// string into raw bytes.
func DecodeBase64ArtifactPayload(raw string) ([]byte, bool) {
	encoded := strings.TrimSpace(raw)
	if encoded == "" {
		return nil, false
	}
	if strings.HasPrefix(strings.ToLower(encoded), "data:") {
		separator := strings.Index(encoded, ",")
		if separator <= 0 {
			return nil, false
		}
		encoded = strings.TrimSpace(encoded[separator+1:])
	}
	decoded, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(decoded) == 0 {
		return nil, false
	}
	return decoded, true
}

// ExtractSpeechArtifactFromResponseBody extracts speech audio bytes and MIME
// from a JSONOrBinaryBody response. If the body contains text (not audio), it
// returns nil.
func ExtractSpeechArtifactFromResponseBody(body *JSONOrBinaryBody) ([]byte, string) {
	if body == nil {
		return nil, ""
	}
	if strings.TrimSpace(body.Text) != "" {
		return nil, ""
	}
	mimeType := strings.TrimSpace(body.MIME)
	payload := append([]byte(nil), body.Bytes...)
	if len(payload) == 0 {
		return nil, mimeType
	}
	looksLikeJSON := payload[0] == '{' || payload[0] == '['
	if strings.Contains(strings.ToLower(mimeType), "application/json") || looksLikeJSON {
		parsed := map[string]any{}
		if err := json.Unmarshal(payload, &parsed); err == nil {
			if artifactBytes, parsedMIME, _ := ExtractArtifactBytesAndMIME(parsed); len(artifactBytes) > 0 {
				if strings.TrimSpace(parsedMIME) != "" {
					mimeType = strings.TrimSpace(parsedMIME)
				}
				return artifactBytes, mimeType
			}
			return nil, mimeType
		}
	}
	return payload, mimeType
}

// ---------------------------------------------------------------------------
// Endpoint resolution
// ---------------------------------------------------------------------------

// ResolveProviderEndpointPaths resolves provider endpoint paths from provider
// options, checking single-value keys, list-value keys, and defaults.
// Paths are deduplicated and normalised.
func ResolveProviderEndpointPaths(providerOptions map[string]any, singleKeys, listKeys, defaults []string) []string {
	paths := make([]string, 0, len(defaults)+len(singleKeys))
	seen := map[string]bool{}
	addPath := func(raw string) {
		normalized := NormalizeProviderEndpointPath(raw)
		if normalized == "" || seen[normalized] {
			return
		}
		seen[normalized] = true
		paths = append(paths, normalized)
	}
	for _, key := range singleKeys {
		addPath(ValueAsString(providerOptions[key]))
	}
	for _, key := range listKeys {
		switch typed := providerOptions[key].(type) {
		case string:
			addPath(typed)
		case []string:
			for _, item := range typed {
				addPath(item)
			}
		case []any:
			for _, item := range typed {
				addPath(ValueAsString(item))
			}
		}
	}
	for _, item := range defaults {
		addPath(item)
	}
	return paths
}

// NormalizeProviderEndpointPath normalises a provider endpoint path, ensuring
// it starts with "/" unless it is an absolute URL.
func NormalizeProviderEndpointPath(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	if strings.HasPrefix(trimmed, "http://") || strings.HasPrefix(trimmed, "https://") {
		return trimmed
	}
	if !strings.HasPrefix(trimmed, "/") {
		trimmed = "/" + trimmed
	}
	return trimmed
}

// FirstProviderEndpointPath returns the first resolved provider endpoint path,
// or empty string if none are found.
func FirstProviderEndpointPath(providerOptions map[string]any, singleKeys, listKeys, defaults []string) string {
	paths := ResolveProviderEndpointPaths(providerOptions, singleKeys, listKeys, defaults)
	if len(paths) == 0 {
		return ""
	}
	return paths[0]
}

// ResolveTaskQueryPathTemplate resolves a task query path template from
// provider options, ensuring it contains a {task_id} placeholder.
func ResolveTaskQueryPathTemplate(providerOptions map[string]any, singleKeys, listKeys, defaults []string) string {
	candidates := ResolveProviderEndpointPaths(providerOptions, singleKeys, listKeys, defaults)
	for _, candidate := range candidates {
		trimmed := strings.TrimSpace(candidate)
		if trimmed == "" {
			continue
		}
		if strings.Contains(trimmed, "{task_id}") {
			return trimmed
		}
		if strings.HasSuffix(trimmed, "/") {
			return trimmed + "{task_id}"
		}
		return trimmed + "/{task_id}"
	}
	return ""
}

// ---------------------------------------------------------------------------
// Value conversion
// ---------------------------------------------------------------------------

// ValueAsString converts a generic value to a string. Returns empty string
// for nil or unsupported types.
func ValueAsString(value any) string {
	switch item := value.(type) {
	case string:
		return item
	case fmt.Stringer:
		return item.String()
	default:
		return ""
	}
}

// ValueAsBool converts a generic value to a boolean. Supports bool, string
// ("true"/"1"/"yes"), and float64.
func ValueAsBool(value any) bool {
	switch item := value.(type) {
	case bool:
		return item
	case string:
		lower := strings.ToLower(strings.TrimSpace(item))
		return lower == "true" || lower == "1" || lower == "yes"
	case float64:
		return item != 0
	default:
		return false
	}
}

// ValueAsInt64 converts a generic value to an int64. Supports int, int32,
// int64, float32, float64, and string.
func ValueAsInt64(value any) int64 {
	switch item := value.(type) {
	case int:
		return int64(item)
	case int32:
		return int64(item)
	case int64:
		return item
	case float32:
		return int64(item)
	case float64:
		return int64(item)
	case string:
		parsed, err := strconv.ParseInt(strings.TrimSpace(item), 10, 64)
		if err == nil {
			return parsed
		}
		parsedFloat, floatErr := strconv.ParseFloat(strings.TrimSpace(item), 64)
		if floatErr == nil {
			return int64(parsedFloat)
		}
	}
	return 0
}

// ValueAsInt32 converts a generic value to an int32 via int64. Returns 0 for
// negative values or overflow.
func ValueAsInt32(value any) int32 {
	parsed := ValueAsInt64(value)
	if parsed <= 0 {
		return 0
	}
	if parsed > int64(^uint32(0)>>1) {
		return 0
	}
	return int32(parsed)
}

// MapField returns the value of a key from a map[string]any, or nil if the
// value is not a map.
func MapField(value any, key string) any {
	object, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	return object[key]
}

// FirstNonNil returns the first non-nil value from the arguments.
func FirstNonNil(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// Model helpers
// ---------------------------------------------------------------------------

// StripProviderModelPrefix removes a known provider prefix (e.g. "kimi/")
// from a model ID, returning the bare model name.
func StripProviderModelPrefix(modelID string, prefixes ...string) string {
	trimmed := strings.TrimSpace(modelID)
	if trimmed == "" {
		return trimmed
	}
	parts := strings.SplitN(trimmed, "/", 2)
	if len(parts) != 2 {
		return trimmed
	}
	prefix := strings.ToLower(strings.TrimSpace(parts[0]))
	rest := strings.TrimSpace(parts[1])
	if rest == "" {
		return trimmed
	}
	for _, candidate := range prefixes {
		if prefix == strings.ToLower(strings.TrimSpace(candidate)) {
			return rest
		}
	}
	return trimmed
}

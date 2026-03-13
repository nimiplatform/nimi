package nimillm

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
)

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
		ValueAsString(payload["job_id"]),
		ValueAsString(payload["jobId"]),
		ValueAsString(payload["task_id"]),
		ValueAsString(payload["taskId"]),
		ValueAsString(payload["id"]),
		ValueAsString(MapField(payload["task"], "id")),
		ValueAsString(MapField(payload["task"], "task_id")),
		ValueAsString(MapField(payload["task"], "job_id")),
		ValueAsString(MapField(payload["result"], "id")),
		ValueAsString(MapField(payload["result"], "task_id")),
		ValueAsString(MapField(payload["result"], "job_id")),
		ValueAsString(MapField(payload["data"], "id")),
		ValueAsString(MapField(payload["data"], "task_id")),
		ValueAsString(MapField(payload["data"], "job_id")),
		ValueAsString(MapField(payload["output"], "id")),
		ValueAsString(MapField(payload["output"], "task_id")),
		ValueAsString(MapField(payload["output"], "job_id")),
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
	case "failed", "error":
		return true
	default:
		return false
	}
}

// IsAsyncTaskCanceledStatus returns true if the status text indicates the task
// was canceled before completion.
func IsAsyncTaskCanceledStatus(statusText string) bool {
	switch strings.ToLower(strings.TrimSpace(statusText)) {
	case "canceled", "cancelled":
		return true
	default:
		return false
	}
}

// IsAsyncTaskExpiredStatus returns true if the status text indicates the task
// expired before completion.
func IsAsyncTaskExpiredStatus(statusText string) bool {
	switch strings.ToLower(strings.TrimSpace(statusText)) {
	case "expired":
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
		ValueAsString(payload["mimeType"]),
		ValueAsString(payload["content_type"]),
	)
	for _, key := range []string{"b64_json", "image_base64", "base64", "data", "image"} {
		if decoded, ok := DecodeBase64ArtifactPayload(ValueAsString(payload[key])); ok {
			return decoded, mimeType, ""
		}
	}
	if imageURL := strings.TrimSpace(ValueAsString(payload["image"])); imageURL != "" {
		if strings.HasPrefix(strings.ToLower(imageURL), "http://") || strings.HasPrefix(strings.ToLower(imageURL), "https://") {
			return ExtractBinaryArtifactBytesAndMIME(map[string]any{
				"url":       imageURL,
				"mime_type": mimeType,
			})
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
	if inlineData := payload["inlineData"]; inlineData != nil {
		if typed, ok := inlineData.(map[string]any); ok {
			if artifactBytes, nestedMIME, artifactURI := ExtractImageArtifactFromMap(typed); len(artifactBytes) > 0 {
				return artifactBytes, FirstNonEmpty(mimeType, nestedMIME), artifactURI
			}
		}
	}
	if inlineData := payload["inline_data"]; inlineData != nil {
		if typed, ok := inlineData.(map[string]any); ok {
			if artifactBytes, nestedMIME, artifactURI := ExtractImageArtifactFromMap(typed); len(artifactBytes) > 0 {
				return artifactBytes, FirstNonEmpty(mimeType, nestedMIME), artifactURI
			}
		}
	}
	if fileData := payload["fileData"]; fileData != nil {
		if typed, ok := fileData.(map[string]any); ok {
			if artifactBytes, nestedMIME, artifactURI := ExtractImageArtifactFromMap(typed); len(artifactBytes) > 0 {
				return artifactBytes, FirstNonEmpty(mimeType, nestedMIME), artifactURI
			}
		}
	}
	if fileData := payload["file_data"]; fileData != nil {
		if typed, ok := fileData.(map[string]any); ok {
			if artifactBytes, nestedMIME, artifactURI := ExtractImageArtifactFromMap(typed); len(artifactBytes) > 0 {
				return artifactBytes, FirstNonEmpty(mimeType, nestedMIME), artifactURI
			}
		}
	}
	if artifactURI := strings.TrimSpace(FirstNonEmpty(
		ValueAsString(payload["fileUri"]),
		ValueAsString(payload["file_uri"]),
		ValueAsString(payload["uri"]),
	)); artifactURI != "" {
		if artifactBytes, nestedMIME, resolvedURI := ExtractImageArtifactFromAny(artifactURI); len(artifactBytes) > 0 {
			return artifactBytes, FirstNonEmpty(mimeType, nestedMIME), FirstNonEmpty(resolvedURI, artifactURI)
		}
	}
	if artifactBytes, nestedMIME, artifactURI := ExtractImageArtifactFromAny(payload["content"]); len(artifactBytes) > 0 {
		return artifactBytes, FirstNonEmpty(mimeType, nestedMIME), artifactURI
	}
	if artifactBytes, nestedMIME, artifactURI := ExtractImageArtifactFromAny(payload["parts"]); len(artifactBytes) > 0 {
		return artifactBytes, FirstNonEmpty(mimeType, nestedMIME), artifactURI
	}
	if artifactBytes, nestedMIME, artifactURI := ExtractImageArtifactFromAny(payload["choices"]); len(artifactBytes) > 0 {
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
func ResolveProviderEndpointPaths(scenarioExtensions map[string]any, singleKeys, listKeys, defaults []string) []string {
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
		addPath(ValueAsString(scenarioExtensions[key]))
	}
	for _, key := range listKeys {
		switch typed := scenarioExtensions[key].(type) {
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
func FirstProviderEndpointPath(scenarioExtensions map[string]any, singleKeys, listKeys, defaults []string) string {
	paths := ResolveProviderEndpointPaths(scenarioExtensions, singleKeys, listKeys, defaults)
	if len(paths) == 0 {
		return ""
	}
	return paths[0]
}

// ResolveTaskQueryPathTemplate resolves a task query path template from
// provider options, ensuring it contains a {task_id} placeholder.
func ResolveTaskQueryPathTemplate(scenarioExtensions map[string]any, singleKeys, listKeys, defaults []string) string {
	candidates := ResolveProviderEndpointPaths(scenarioExtensions, singleKeys, listKeys, defaults)
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

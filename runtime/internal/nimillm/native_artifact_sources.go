package nimillm

import (
	"fmt"
	"strings"
)

type nativeArtifactSource struct {
	data      []byte
	mime, uri string
}

// This parser cannot perform IO. In particular it never calls the legacy
// bytes-and-URL helper, which may download a URL while decoding a response.
// Preserve every item in an output array; the Job checks the required set
// against its frozen effective specification before opening any body.
func nativeArtifactSources(value any) ([]nativeArtifactSource, error) {
	var walk func(any, int) ([]nativeArtifactSource, error)
	walk = func(value any, depth int) ([]nativeArtifactSource, error) {
		if depth > 32 {
			return nil, fmt.Errorf("native output nesting exceeds control bound")
		}
		switch v := value.(type) {
		case string:
			uri := strings.TrimSpace(v)
			if strings.HasPrefix(uri, "https://") || strings.HasPrefix(uri, "http://") {
				return []nativeArtifactSource{{uri: uri}}, nil
			}
		case []any:
			var out []nativeArtifactSource
			for _, item := range v {
				sources, err := walk(item, depth+1)
				if err != nil {
					return nil, err
				}
				out = append(out, sources...)
				if len(out) > 16 {
					return nil, fmt.Errorf("native output set exceeds body count bound")
				}
			}
			return out, nil
		case map[string]any:
			mime := FirstNonEmpty(ValueAsString(v["mime_type"]), ValueAsString(v["mimeType"]), ValueAsString(v["content_type"]))
			for _, key := range []string{"url", "video_url", "audio_url", "image_url", "fileUri", "file_uri", "uri", "sample", "video", "image"} {
				if child, ok := v[key]; ok {
					sources, err := walk(child, depth+1)
					if err != nil {
						return nil, err
					}
					if len(sources) > 0 {
						for i := range sources {
							if sources[i].mime == "" {
								sources[i].mime = mime
							}
						}
						if frame := ValueAsString(v["last_frame_url"]); frame != "" {
							sources = append(sources, nativeArtifactSource{uri: frame, mime: "image/png"})
						}
						return sources, nil
					}
				}
			}
			for _, key := range []string{"b64_json", "b64_mp4", "audio_base64", "audio", "image", "data"} {
				if raw := ValueAsString(v[key]); raw != "" {
					if data, ok := DecodeBase64ArtifactPayload(raw); ok {
						return []nativeArtifactSource{{data: data, mime: mime}}, nil
					}
				}
			}
			for _, key := range []string{"artifact", "result", "data", "output", "results", "assets", "task_result", "video_result", "videos", "images", "content", "parts", "choices", "message", "inlineData", "inline_data", "fileData", "file_data"} {
				if child, ok := v[key]; ok {
					sources, err := walk(child, depth+1)
					if err != nil {
						return nil, err
					}
					if len(sources) > 0 {
						for i := range sources {
							if sources[i].mime == "" {
								sources[i].mime = mime
							}
						}
						return sources, nil
					}
				}
			}
		}
		return nil, nil
	}
	return walk(value, 0)
}

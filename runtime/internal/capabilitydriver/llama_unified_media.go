package capabilitydriver

import (
	"encoding/base64"
	"fmt"
	"path/filepath"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const LlamaUnifiedMaxRequestBytes = 64 << 20

func llamaInlineAVPart(part *runtimev1.ChatContentPart) (map[string]any, error) {
	kind, value := "input_audio", part.GetAudioUrl()
	allowed := []string{"data:audio/wav;base64,", "data:audio/mpeg;base64,"}
	if part.GetType() == runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_VIDEO_URL {
		kind, value = "input_video", part.GetVideoUrl()
		allowed = []string{"data:video/mp4;base64,"}
	}
	for _, prefix := range allowed {
		if !strings.HasPrefix(value, prefix) {
			continue
		}
		encoded := strings.TrimPrefix(value, prefix)
		if encoded == "" || len(encoded) > base64.StdEncoding.EncodedLen(32<<20) {
			break
		}
		if _, err := base64.StdEncoding.DecodeString(encoded); err != nil {
			break
		}
		return map[string]any{"type": kind, kind: map[string]any{"data": encoded}}, nil
	}
	return nil, invocationError(InvocationFailureUnsupported, fmt.Errorf("unified audio/video input requires bounded owned WAV, MP3 or MP4 content"))
}

// @nimi-authority: rule.nimi.runtime.local-compute.media-codec-dependency
func llamaCapturedVideoCodecDirectory(sources []InvocationExactDependencySource) (string, error) {
	var directory string
	for _, source := range sources {
		if source.DependencyFamily != "native-tool.media-codec" || source.DependencyID != "ffmpeg.codec" {
			continue
		}
		if directory != "" || source.ConsumerScope != "media-codec" || !filepath.IsAbs(source.CanonicalRoot) {
			return "", fmt.Errorf("captured media codec source is invalid")
		}
		directory = filepath.Join(source.CanonicalRoot, "bin")
	}
	if directory == "" {
		return "", fmt.Errorf("unified video requires the captured managed media codec")
	}
	return directory, nil
}

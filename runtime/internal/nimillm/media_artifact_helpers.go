package nimillm

import (
	"crypto/sha256"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/oklog/ulid/v2"
	"google.golang.org/protobuf/types/known/structpb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

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

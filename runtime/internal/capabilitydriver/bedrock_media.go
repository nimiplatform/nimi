package capabilitydriver

import (
	"bytes"
	"encoding/base64"
	"image"
	"strings"
)

// Bedrock's native image input is inline bytes, at most 3.75 MB and 8000px per
// edge. The original encoded bytes are retained after boundary validation.
func bedrockInlineImage(location string, maxBytes int) (string, string, error) {
	invalid := func() (string, string, error) {
		return "", "", deepseekJSONInputError("Bedrock inline image format, dimensions or byte limit")
	}
	header, encoded, ok := strings.Cut(location, ",")
	mime := strings.TrimSuffix(strings.TrimPrefix(header, "data:"), ";base64")
	if !ok || !strings.HasPrefix(header, "data:") || !strings.HasSuffix(header, ";base64") || encoded == "" || len(encoded) > base64.StdEncoding.EncodedLen(maxBytes) {
		return invalid()
	}
	switch mime {
	case "image/png", "image/jpeg", "image/webp", "image/gif":
	default:
		return invalid()
	}
	data, err := base64.StdEncoding.Strict().DecodeString(encoded)
	if err != nil || len(data) > maxBytes {
		return invalid()
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || mime != "image/"+format || config.Width < 1 || config.Height < 1 || config.Width > 8000 || config.Height > 8000 || format == "gif" && !singleFrameGIF(data) {
		return invalid()
	}
	return format, encoded, nil
}

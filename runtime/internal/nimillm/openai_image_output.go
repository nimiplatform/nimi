package nimillm

import (
	"bytes"
	"encoding/binary"
	"fmt"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/mediaimage"
	"google.golang.org/grpc/codes"
	"image/gif"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.openai-image26
func validateOpenAIImageOutput(data []byte, s *runtimev1.ImageGenerateScenarioSpec) (*openAIImageOutput, error) {
	invalid := grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	format := s.GetOutputFormat()
	if format == "" {
		format = "png"
	}
	output := &openAIImageOutput{bytes: data, mimeType: "image/" + format}
	switch format {
	case "png", "jpeg", "webp":
		info, err := mediaimage.Inspect(data, 32<<20, 16<<20)
		if err != nil || info.Format != format {
			return nil, invalid
		}
		output.width, output.height = int32(info.Width), int32(info.Height)
	case "svg":
		w, h, err := mediaimage.InspectStaticSVG(data, 4<<20)
		if err != nil {
			return nil, invalid
		}
		output.mimeType = "image/svg+xml"
		output.width, output.height = w, h
	case "gif":
		count, err := boundedGIFFrameCount(data)
		if err != nil {
			return nil, invalid
		}
		expected := int(s.GetFrameCount())
		if s.FrameCount == nil {
			expected = 9
		}
		if count != expected {
			return nil, invalid
		}
		animation, err := gif.DecodeAll(bytes.NewReader(data))
		if err != nil || len(animation.Image) != count {
			return nil, invalid
		}
		delay := int(s.GetFrameDurationMs())
		if s.FrameDurationMs == nil {
			delay = 200
		}
		delay = (delay + 5) / 10
		for _, actual := range animation.Delay {
			if actual != delay {
				return nil, invalid
			}
			output.durationMs += int64(actual) * 10
		}
		output.width, output.height = int32(animation.Config.Width), int32(animation.Config.Height)
	default:
		return nil, invalid
	}
	return output, nil
}

// Check frame allocations before the standard GIF decoder allocates palettes
// and rasters. The canvas-times-frame bound also limits downstream compositing.
func boundedGIFFrameCount(data []byte) (int, error) {
	bad := fmt.Errorf("invalid or oversized GIF")
	if len(data) < 14 || len(data) > 32<<20 || (string(data[:6]) != "GIF89a" && string(data[:6]) != "GIF87a") {
		return 0, bad
	}
	width, height := int(binary.LittleEndian.Uint16(data[6:])), int(binary.LittleEndian.Uint16(data[8:]))
	if width == 0 || height == 0 {
		return 0, bad
	}
	pos := 13
	if data[10]&0x80 != 0 {
		pos += 3 * (1 << ((data[10] & 7) + 1))
	}
	blocks := func() bool {
		for pos < len(data) {
			n := int(data[pos])
			pos++
			if n == 0 {
				return true
			}
			if n > len(data)-pos {
				return false
			}
			pos += n
		}
		return false
	}
	count := 0
	for pos < len(data) {
		marker := data[pos]
		pos++
		switch marker {
		case 0x3b:
			if count < 2 || pos != len(data) {
				return 0, bad
			}
			return count, nil
		case 0x21:
			if pos >= len(data) {
				return 0, bad
			}
			pos++
			if !blocks() {
				return 0, bad
			}
		case 0x2c:
			if len(data)-pos < 9 {
				return 0, bad
			}
			left, top := int(binary.LittleEndian.Uint16(data[pos:])), int(binary.LittleEndian.Uint16(data[pos+2:]))
			w, h := int(binary.LittleEndian.Uint16(data[pos+4:])), int(binary.LittleEndian.Uint16(data[pos+6:]))
			packed := data[pos+8]
			pos += 9
			if w == 0 || h == 0 || left+w > width || top+h > height {
				return 0, bad
			}
			count++
			if count > 16 || int64(width)*int64(height)*int64(count) > 64<<20 {
				return 0, bad
			}
			if packed&0x80 != 0 {
				pos += 3 * (1 << ((packed & 7) + 1))
			}
			if pos >= len(data) {
				return 0, bad
			}
			pos++
			if !blocks() {
				return 0, bad
			}
		default:
			return 0, bad
		}
	}
	return 0, bad
}

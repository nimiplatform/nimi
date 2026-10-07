// @nimi-authority: rule.nimi.runtime.ai-provider.r051
package mediaimage

import (
	"bytes"
	"encoding/binary"
	"fmt"
	_ "golang.org/x/image/webp"
	"image"
	"image/gif"
	_ "image/jpeg"
	_ "image/png"
)

type Info struct {
	Width, Height uint32
	Format        string
	Orientation   uint16
}

// Inspect validates the complete static image before allocation beyond its
// caller-owned bound and returns its explicit EXIF-oriented geometry.
func Inspect(data []byte, maxBytes int, maxPixels int64) (Info, error) {
	if len(data) == 0 || len(data) > maxBytes {
		return Info{}, fmt.Errorf("image exceeds its byte bound")
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return Info{}, fmt.Errorf("decode image: %w", err)
	}
	if config.Width <= 0 || config.Height <= 0 || int64(config.Width)*int64(config.Height) > maxPixels {
		return Info{}, fmt.Errorf("image exceeds its pixel bound")
	}
	orientation := uint16(1)
	var exif []byte
	switch format {
	case "jpeg":
		for offset := 2; offset+4 <= len(data); {
			if data[offset] != 0xff {
				break
			}
			marker := data[offset+1]
			if marker == 0xda || marker == 0xd9 {
				break
			}
			if marker == 0xff {
				offset++
				continue
			}
			length := int(binary.BigEndian.Uint16(data[offset+2:]))
			if length < 2 || offset+2+length > len(data) {
				return Info{}, fmt.Errorf("JPEG segment is invalid")
			}
			segment := data[offset+4 : offset+2+length]
			if marker == 0xe1 && bytes.HasPrefix(segment, []byte("Exif\x00\x00")) {
				exif = segment[6:]
				break
			}
			offset += 2 + length
		}
	case "png":
		for offset := 8; offset+12 <= len(data); {
			length := int(binary.BigEndian.Uint32(data[offset:]))
			if length > len(data)-offset-12 {
				return Info{}, fmt.Errorf("PNG chunk is invalid")
			}
			kind := string(data[offset+4 : offset+8])
			if kind == "acTL" {
				return Info{}, fmt.Errorf("accepts only static images")
			}
			if kind == "eXIf" {
				exif = data[offset+8 : offset+8+length]
			}
			offset += 12 + length
		}
	case "webp":
		for offset := 12; offset+8 <= len(data); {
			length := int(binary.LittleEndian.Uint32(data[offset+4:]))
			if length > len(data)-offset-8 {
				return Info{}, fmt.Errorf("WebP chunk is invalid")
			}
			kind := string(data[offset : offset+4])
			if kind == "ANIM" || kind == "ANMF" {
				return Info{}, fmt.Errorf("accepts only static images")
			}
			if kind == "EXIF" {
				exif = bytes.TrimPrefix(data[offset+8:offset+8+length], []byte("Exif\x00\x00"))
			}
			offset += 8 + length + (length % 2)
		}
	case "gif":
		decoded, decodeErr := gif.DecodeAll(bytes.NewReader(data))
		if decodeErr != nil || len(decoded.Image) != 1 {
			return Info{}, fmt.Errorf("accepts only one decodable static image")
		}
	default:
		return Info{}, fmt.Errorf("image format is unsupported")
	}
	if len(exif) > 0 {
		orientation, err = exifOrientation(exif)
		if err != nil {
			return Info{}, err
		}
	}
	if format != "gif" {
		if _, _, err := image.Decode(bytes.NewReader(data)); err != nil {
			return Info{}, fmt.Errorf("decode complete image: %w", err)
		}
	}
	width, height := uint32(config.Width), uint32(config.Height)
	if orientation >= 5 && orientation <= 8 {
		width, height = height, width
	}
	return Info{Width: width, Height: height, Format: format, Orientation: orientation}, nil
}

func exifOrientation(data []byte) (uint16, error) {
	invalid := fmt.Errorf("image EXIF orientation is invalid")
	if len(data) < 8 {
		return 0, invalid
	}
	var order binary.ByteOrder
	switch string(data[:2]) {
	case "II":
		order = binary.LittleEndian
	case "MM":
		order = binary.BigEndian
	default:
		return 0, invalid
	}
	if order.Uint16(data[2:]) != 42 {
		return 0, invalid
	}
	offset := int(order.Uint32(data[4:]))
	if offset < 8 || offset > len(data)-2 {
		return 0, invalid
	}
	count := int(order.Uint16(data[offset:]))
	offset += 2
	if count > (len(data)-offset)/12 {
		return 0, invalid
	}
	for index := 0; index < count; index++ {
		entry := data[offset+index*12:]
		if order.Uint16(entry) != 0x0112 {
			continue
		}
		if order.Uint16(entry[2:]) != 3 || order.Uint32(entry[4:]) != 1 {
			return 0, invalid
		}
		value := order.Uint16(entry[8:])
		if value < 1 || value > 8 {
			return 0, invalid
		}
		return value, nil
	}
	return 1, nil
}

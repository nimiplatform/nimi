package localexecution

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"testing"
)

func TestVisionImageEXIFFrameAndMultiFrameRejection(t *testing.T) {
	var original bytes.Buffer
	if err := jpeg.Encode(&original, image.NewRGBA(image.Rect(0, 0, 6, 4)), nil); err != nil {
		t.Fatal(err)
	}
	for orientation := uint16(1); orientation <= 8; orientation++ {
		exif := []byte{'E', 'x', 'i', 'f', 0, 0, 'I', 'I', 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 1, 3, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0}
		binary.LittleEndian.PutUint16(exif[24:], orientation)
		segment := []byte{0xff, 0xe1, 0, 0}
		binary.BigEndian.PutUint16(segment[2:], uint16(len(exif)+2))
		data := append(append(append([]byte{}, original.Bytes()[:2]...), segment...), exif...)
		data = append(data, original.Bytes()[2:]...)
		width, height, err := VisionLocateImageSize(data)
		if err != nil {
			t.Fatal(err)
		}
		wantWidth, wantHeight := uint32(6), uint32(4)
		if orientation >= 5 {
			wantWidth, wantHeight = 4, 6
		}
		if width != wantWidth || height != wantHeight {
			t.Fatalf("orientation %d gave %dx%d", orientation, width, height)
		}
	}
	frame := image.NewPaletted(image.Rect(0, 0, 2, 2), color.Palette{color.Black, color.White})
	var animation bytes.Buffer
	if err := gif.EncodeAll(&animation, &gif.GIF{Image: []*image.Paletted{frame, frame}, Delay: []int{10, 10}}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := VisionLocateImageSize(animation.Bytes()); err == nil {
		t.Fatal("multi-frame image accepted")
	}
}

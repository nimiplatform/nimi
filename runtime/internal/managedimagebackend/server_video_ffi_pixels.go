//go:build windows || (darwin && arm64 && cgo)

package managedimagebackend

import (
	"bytes"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"unsafe"
)

const (
	maxFFIVideoFrames  = 512
	maxFFIAudioSamples = 1 << 30
)

func decodeFFIReferenceImage(encoded []byte) (sdImage, []byte, error) {
	decoded, _, err := image.Decode(bytes.NewReader(encoded))
	if err != nil {
		return sdImage{}, nil, videoError(VideoErrorInference, fmt.Errorf("decode reference image: %w", err))
	}
	bounds := decoded.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	count, overflow := checkedVideoByteCount(width, height, 3)
	if overflow {
		return sdImage{}, nil, videoError(VideoErrorInference, fmt.Errorf("reference image shape overflows"))
	}
	pixels := make([]byte, count)
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			r, g, b, _ := decoded.At(bounds.Min.X+x, bounds.Min.Y+y).RGBA()
			offset := (y*width + x) * 3
			pixels[offset] = byte(r >> 8)
			pixels[offset+1] = byte(g >> 8)
			pixels[offset+2] = byte(b >> 8)
		}
	}
	return sdImage{Width: uint32(width), Height: uint32(height), Channel: 3, Data: unsafe.Pointer(&pixels[0])}, pixels, nil
}

func copyFFIVideoCandidate(framesPointer unsafe.Pointer, frameCount int32, audioPointer unsafe.Pointer, fps int) (VideoCandidate, error) {
	if framesPointer == nil || frameCount <= 0 || frameCount > maxFFIVideoFrames {
		return VideoCandidate{}, videoError(VideoErrorPostcondition, fmt.Errorf("stable-diffusion returned invalid video frame array"))
	}
	frames := unsafe.Slice((*sdImage)(framesPointer), int(frameCount))
	candidate := VideoCandidate{Frames: make([]VideoFrame, 0, len(frames)), FrameCount: int(frameCount), FPS: fps}
	for index, frame := range frames {
		count, overflow := checkedVideoByteCount(int(frame.Width), int(frame.Height), int(frame.Channel))
		if overflow || frame.Channel != 3 || frame.Data == nil {
			return VideoCandidate{}, videoError(VideoErrorPostcondition, fmt.Errorf("stable-diffusion returned invalid frame %d", index))
		}
		payload := unsafe.Slice((*byte)(frame.Data), count)
		candidate.Frames = append(candidate.Frames, VideoFrame{RGBBytes: append([]byte(nil), payload...), Width: int(frame.Width), Height: int(frame.Height)})
	}
	if audioPointer == nil {
		return candidate, nil
	}
	audio := *(*sdAudio)(audioPointer)
	totalSamples := audio.SampleCount * uint64(audio.Channels)
	if audio.Data == nil || totalSamples == 0 || totalSamples > maxFFIAudioSamples {
		return VideoCandidate{}, videoError(VideoErrorPostcondition, fmt.Errorf("stable-diffusion returned invalid audio"))
	}
	samples := unsafe.Slice((*float32)(audio.Data), int(totalSamples))
	candidate.Audio = VideoAudio{PCMSamples: append([]float32(nil), samples...), Channels: int(audio.Channels), SampleRate: int(audio.SampleRate)}
	return candidate, nil
}

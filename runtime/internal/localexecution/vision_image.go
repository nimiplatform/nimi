package localexecution

import "github.com/nimiplatform/nimi/runtime/internal/mediaimage"

const MaxVisionLocateImageBytes = 32 * 1024 * 1024
const MaxVisionLocateQueryBytes = 8 * 1024
const MaxVisionLocateImagePixels = 64 * 1024 * 1024

// @nimi-authority: rule.nimi.runtime.ai-provider.r126
func VisionLocateImageSize(data []byte) (uint32, uint32, error) {
	info, err := mediaimage.Inspect(data, MaxVisionLocateImageBytes, MaxVisionLocateImagePixels)
	return info.Width, info.Height, err
}

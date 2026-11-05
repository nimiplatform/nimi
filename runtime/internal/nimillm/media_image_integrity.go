package nimillm

import (
	"bytes"
	"image"
	_ "image/jpeg"
	_ "image/png"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.r051
// Validate the whole image before publishing it, with the same bounded pixel
// allocation used by the existing OpenAI image path. Model-specific geometry
// constraints are applied by the caller after this shared container check.
func decodedMediaImageConfig(payload []byte) (image.Config, string, bool) {
	return decodedMediaImageConfigWithPixelLimit(payload, 16<<20)
}

// A reviewed target may need a larger finite output canvas. Callers select
// their exact contract's limit; ordinary image paths keep the 16 Mi-pixel cap.
func decodedMediaImageConfigWithPixelLimit(payload []byte, maxPixels int64) (image.Config, string, bool) {
	config, format, err := image.DecodeConfig(bytes.NewReader(payload))
	if err != nil || (format != "png" && format != "jpeg") || config.Width <= 0 || config.Height <= 0 ||
		config.Width > 1<<15 || config.Height > 1<<15 || int64(config.Width)*int64(config.Height) > maxPixels {
		return image.Config{}, "", false
	}
	if _, _, err := image.Decode(bytes.NewReader(payload)); err != nil {
		return image.Config{}, "", false
	}
	return config, format, true
}

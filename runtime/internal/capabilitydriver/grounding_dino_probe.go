package capabilitydriver

import (
	"fmt"
	"io"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.grounding-dino-swin-box-admission
func (GroundingDinoDriver) ProbeModelAsset(input ModelAssetFormatProbeInput, source io.ReaderAt, size int64) ([]byte, error) {
	if input.Entry {
		return probeSafetensorsHeader(source, size)
	}
	switch input.RelativePath {
	case "config.json", "preprocessor_config.json", "tokenizer_config.json", "tokenizer.json", "special_tokens_map.json", "added_tokens.json":
		return probeCompleteModelAssetJSON(source, size)
	case "vocab.txt":
		// Token IDs are validated against every line of the complete vocabulary.
		if size <= 0 || size > MaxAssetFormatProbeBytes {
			return nil, fmt.Errorf("GroundingDino vocabulary exceeds its probe bound")
		}
		data := make([]byte, int(size))
		if _, err := source.ReadAt(data, 0); err != nil {
			return nil, err
		}
		return data, nil
	default:
		return nil, nil
	}
}

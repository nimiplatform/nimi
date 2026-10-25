package capabilitydriver

import (
	"io"
	"path/filepath"
)

// LocateAnything validates every declared shard header and the complete model
// configuration/index. Tokenizer companions contribute presence and verified
// file identity, not their opaque prefix bytes, to this Driver's projection.
func (LocateAnythingDriver) ProbeModelAsset(input ModelAssetFormatProbeInput, source io.ReaderAt, size int64) ([]byte, error) {
	if filepath.Ext(input.RelativePath) == ".safetensors" {
		return probeSafetensorsHeader(source, size)
	}
	switch input.RelativePath {
	case "config.json", "model.safetensors.index.json":
		return probeCompleteModelAssetJSON(source, size)
	default:
		return nil, nil
	}
}

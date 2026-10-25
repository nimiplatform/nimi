package capabilitydriver

import "io"

// @nimi-authority: rule.nimi.runtime.ai-provider.r112
func (VoxCPMDriver) ProbeModelAsset(input ModelAssetFormatProbeInput, source io.ReaderAt, size int64) ([]byte, error) {
	if input.Entry {
		return probeSafetensorsHeader(source, size)
	}
	if input.RelativePath == "config.json" {
		return probeCompleteModelAssetJSON(source, size)
	}
	// Audio VAE and tokenizer companions contribute verified file presence;
	// this Driver does not interpret their prefix bytes.
	return nil, nil
}

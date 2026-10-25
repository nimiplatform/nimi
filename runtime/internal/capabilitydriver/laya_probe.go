package capabilitydriver

import (
	"io"
	"strings"
)

func layaConfigProbePath(relativePath string) bool {
	for _, name := range []string{layaAgentConfigFile, layaEncoderConfigFile, layaTokenizerConfigFile} {
		if relativePath == name || strings.HasSuffix(relativePath, "/"+name) {
			return true
		}
	}
	return false
}

// @nimi-authority: rule.nimi.runtime.ai-provider.laya-local-decision
func (LayaDriver) ProbeModelAsset(input ModelAssetFormatProbeInput, source io.ReaderAt, size int64) ([]byte, error) {
	if input.Entry {
		return probeSafetensorsHeader(source, size)
	}
	if !layaConfigProbePath(input.RelativePath) || size <= 0 {
		return nil, nil
	}
	// The selected checkpoint prefix is known only when all file facts are
	// projected. Read its possible config files within the existing bound;
	// validate completeness and JSON only for the selected checkpoint there.
	data := make([]byte, int(min(size, int64(layaConfigProbeBytes))))
	if _, err := source.ReadAt(data, 0); err != nil {
		return nil, err
	}
	return data, nil
}

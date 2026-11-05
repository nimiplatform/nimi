package engine

import (
	"fmt"
	"strings"
)

type managedBinaryReleaseAsset struct {
	Name        string
	DownloadURL string
	SHA256      string
}

// @nimi-authority: rule.nimi.runtime.local-compute.r037
// Official v0.8.0 binaries live under its b11960 build tag. Acquisition uses
// these reviewed immutable identities without a GitHub metadata API request.
func llamaReleaseAsset(version string) (managedBinaryReleaseAsset, error) {
	names, err := llamaAssetNameCandidates(version, currentGOOS(), currentGOARCH(), detectLocalGPUVendor())
	if err != nil {
		return managedBinaryReleaseAsset{}, err
	}
	return llamaReleaseAssetByName(version, names[0])
}

func llamaReleaseAssetByName(version string, assetName string) (managedBinaryReleaseAsset, error) {
	if strings.TrimSpace(version) != defaultLlamaVersion {
		return managedBinaryReleaseAsset{}, fmt.Errorf("%w: unadmitted llama release %q", ErrEngineBinaryDownloadFailed, version)
	}
	name := strings.TrimSpace(assetName)
	var digest string
	switch name {
	case "llama-b11960-bin-win-cuda-12.4-x64.zip":
		digest = "8d9d819261de10cc2f03921b8b79c779c5c458e21edb60c170ee30a7d462d684" // pragma: allowlist secret -- public archive checksum
	case "llama-b11960-bin-macos-arm64.tar.gz":
		digest = "58e5a5e1d7c2bf66cedd9c29e0323f3e570660a70a1e2156d32eed08f4cc1e3c" // pragma: allowlist secret -- public archive checksum
	default:
		return managedBinaryReleaseAsset{}, fmt.Errorf("%w: unadmitted llama release asset %q", ErrEngineBinaryDownloadFailed, name)
	}
	return managedBinaryReleaseAsset{Name: name, DownloadURL: "https://github.com/ggml-org/llama.cpp/releases/download/" + defaultLlamaVersion + "/" + name, SHA256: digest}, nil
}

func llamaExpectedSHA256(version string, assetName string) (string, error) {
	asset, err := llamaReleaseAssetByName(version, assetName)
	return asset.SHA256, err
}

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
// Official v0.7.0 binaries live under its b11669 build tag. Acquisition uses
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
	case "llama-b11669-bin-win-cuda-12.4-x64.zip":
		digest = "c2da1f73ed176ae093ac5aceb978a7b167a16113f6d74c6789eeaee2135cb8dc" // pragma: allowlist secret -- public archive checksum
	case "llama-b11669-bin-macos-arm64.tar.gz":
		digest = "dbed55493d72bc1ba2babc8770d669c2289b5bc4ee9fb2a4dfc158d45b7d13fd" // pragma: allowlist secret -- public archive checksum
	default:
		return managedBinaryReleaseAsset{}, fmt.Errorf("%w: unadmitted llama release asset %q", ErrEngineBinaryDownloadFailed, name)
	}
	return managedBinaryReleaseAsset{Name: name, DownloadURL: "https://github.com/ggml-org/llama.cpp/releases/download/" + defaultLlamaVersion + "/" + name, SHA256: digest}, nil
}

func llamaExpectedSHA256(version string, assetName string) (string, error) {
	asset, err := llamaReleaseAssetByName(version, assetName)
	return asset.SHA256, err
}

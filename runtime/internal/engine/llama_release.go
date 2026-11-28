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
// Official binaries live under the b12823 build tag. Acquisition uses
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
	case "llama-b12823-bin-win-cuda-12.4-x64.zip":
		digest = "5e850de49760bf246dd6a080a3a8a6cbc5d230ba0fda315a97a0570312b6f1d8" // pragma: allowlist secret -- public archive checksum
	case "llama-b12823-bin-macos-arm64.tar.gz":
		digest = "709005367a1fa0e3bc025355a956b8cdb0e9eeea70f70ed9e9c5b1a04fff483a" // pragma: allowlist secret -- public archive checksum
	default:
		return managedBinaryReleaseAsset{}, fmt.Errorf("%w: unadmitted llama release asset %q", ErrEngineBinaryDownloadFailed, name)
	}
	return managedBinaryReleaseAsset{Name: name, DownloadURL: "https://github.com/ggml-org/llama.cpp/releases/download/" + defaultLlamaVersion + "/" + name, SHA256: digest}, nil
}

func llamaExpectedSHA256(version string, assetName string) (string, error) {
	asset, err := llamaReleaseAssetByName(version, assetName)
	return asset.SHA256, err
}

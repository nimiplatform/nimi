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
// Official v0.6.0 binaries live under its b11429 build tag. Acquisition uses
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
	case "llama-b11429-bin-win-cuda-12.4-x64.zip":
		digest = "dd6df685c1024e6aa55ca55ad35038692d5e284d4dc895e7a646c3245d3d14ff" // pragma: allowlist secret -- public archive checksum
	case "llama-b11429-bin-macos-arm64.tar.gz":
		digest = "740288ec6887be94280a5dfa25b5e23a78285cab104519e6c7e218904ee82459" // pragma: allowlist secret -- public archive checksum
	default:
		return managedBinaryReleaseAsset{}, fmt.Errorf("%w: unadmitted llama release asset %q", ErrEngineBinaryDownloadFailed, name)
	}
	return managedBinaryReleaseAsset{Name: name, DownloadURL: "https://github.com/ggml-org/llama.cpp/releases/download/" + defaultLlamaVersion + "/" + name, SHA256: digest}, nil
}

func llamaExpectedSHA256(version string, assetName string) (string, error) {
	asset, err := llamaReleaseAssetByName(version, assetName)
	return asset.SHA256, err
}

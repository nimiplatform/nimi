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
// Official binaries live under the b12648 build tag. Acquisition uses
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
	case "llama-b12648-bin-win-cuda-12.4-x64.zip":
		digest = "26b82a04c99449d19641e3db392ef2c5a2977ad087bb64c8d74e538b490b9649" // pragma: allowlist secret -- public archive checksum
	case "llama-b12648-bin-macos-arm64.tar.gz":
		digest = "0bd241a5dae70c6c98db113862de1abdccb60aa250cd7623f7eb1614c14b7708" // pragma: allowlist secret -- public archive checksum
	default:
		return managedBinaryReleaseAsset{}, fmt.Errorf("%w: unadmitted llama release asset %q", ErrEngineBinaryDownloadFailed, name)
	}
	return managedBinaryReleaseAsset{Name: name, DownloadURL: "https://github.com/ggml-org/llama.cpp/releases/download/" + defaultLlamaVersion + "/" + name, SHA256: digest}, nil
}

func llamaExpectedSHA256(version string, assetName string) (string, error) {
	asset, err := llamaReleaseAssetByName(version, assetName)
	return asset.SHA256, err
}

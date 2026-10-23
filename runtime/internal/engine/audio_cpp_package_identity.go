package engine

import "fmt"

// @nimi-authority: rule.nimi.runtime.local-compute.audio-cpp-package
type AudioCppPackageIdentity struct {
	Platform, AssetName, ArchiveURL, ArchiveSHA256, ExecutableName, AcceleratorPlane string
	ArchiveBytes                                                                     int64
	AdmittedFiles                                                                    []string
}

func AudioCppPackageForPlatform(platform string) (AudioCppPackageIdentity, error) {
	switch platform {
	case "windows/amd64":
		return AudioCppPackageIdentity{Platform: platform, AssetName: AudioCppPackageAssetName,
			ArchiveURL: AudioCppPackageArchiveURL, ArchiveSHA256: AudioCppPackageArchiveSHA256,
			ArchiveBytes: AudioCppPackageArchiveBytes, ExecutableName: AudioCppCLIExecutableName,
			AcceleratorPlane: "cuda13", AdmittedFiles: append([]string(nil), audioCppPackageAdmittedFiles...)}, nil
	case "darwin/arm64":
		return AudioCppPackageIdentity{Platform: platform, AssetName: "audio-v0.9.2-drama3-base-small-bin-macos-arm64-metal.tar.gz",
			ArchiveURL:    "https://github.com/0xShug0/audio.cpp/releases/download/v0.9.2-drama3-base-small/audio-v0.9.2-drama3-base-small-bin-macos-arm64-metal.tar.gz",
			ArchiveSHA256: "1281998c1acd170a7d92139853fe6ce6ab920e211d2ad3359775d43ad9ba616d", // pragma: allowlist secret -- public archive checksum
			ArchiveBytes:  32708971, ExecutableName: "audiocpp_cli", AcceleratorPlane: "cpu,metal",
			AdmittedFiles: []string{"audiocpp_cli", "LICENSE"}}, nil
	default:
		return AudioCppPackageIdentity{}, fmt.Errorf("audio.cpp package is unsupported on %s", platform)
	}
}

func AudioCppCLIExecutableForPlatform(platform string) string {
	identity, err := AudioCppPackageForPlatform(platform)
	if err != nil {
		return ""
	}
	return identity.ExecutableName
}

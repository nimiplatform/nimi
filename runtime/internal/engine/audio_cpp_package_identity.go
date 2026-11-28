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
		return AudioCppPackageIdentity{Platform: platform, AssetName: "audio-v0.9.6-bin-macos-arm64-metal.tar.gz",
			ArchiveURL:    "https://github.com/0xShug0/audio.cpp/releases/download/v0.9.6/audio-v0.9.6-bin-macos-arm64-metal.tar.gz",
			ArchiveSHA256: "11848bf10d1142f18ec852051ff8dcd90c12b65b95e6f902b487bae565e3dfe0", // pragma: allowlist secret -- public archive checksum
			ArchiveBytes:  40423741, ExecutableName: "audiocpp_cli", AcceleratorPlane: "cpu,metal",
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

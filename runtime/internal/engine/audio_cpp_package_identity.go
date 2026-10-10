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
		return AudioCppPackageIdentity{Platform: platform, AssetName: "audio-v0.9.1-bin-macos-arm64-metal.tar.gz",
			ArchiveURL:    "https://github.com/0xShug0/audio.cpp/releases/download/v0.9.1/audio-v0.9.1-bin-macos-arm64-metal.tar.gz",
			ArchiveSHA256: "960436787b84bf137a70ea1713ac460207ef2ac7b2617380fb7a1f4650d1100d", // pragma: allowlist secret -- public archive checksum
			ArchiveBytes:  30519606, ExecutableName: "audiocpp_cli", AcceleratorPlane: "cpu,metal",
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

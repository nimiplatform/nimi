package engine

import (
	"context"
	"os"
	"path/filepath"

	"github.com/nimiplatform/nimi/runtime/internal/videomedia"
)

func checkSyncMediaCodec(ctx context.Context, dataRoot string, spec mediaCodecSpec, verifyRuns func(context.Context, string, string) error) ManagedEnvironmentCheckResult {
	locator := filepath.ToSlash(filepath.Join("dependencies", "media-codec", spec.directory))
	root := filepath.Join(dataRoot, filepath.FromSlash(locator))
	result := ManagedEnvironmentCheckResult{Kind: "media_codec", Reference: MediaCodecDependencyID + "/" + spec.version, Locator: locator,
		Status: "unavailable", Reason: "MEDIA_CODEC_OWNER_MATERIAL_UNAVAILABLE"}
	status, err := mediaCodecStatus(root, spec)
	if err == nil {
		err = verifyRuns(ctx, filepath.Join(root, "bin", "ffmpeg"+spec.suffix), filepath.Join(root, "bin", "ffprobe"+spec.suffix))
	}
	if err == nil {
		result.Reason = "MEDIA_CODEC_OWNER_MATERIAL_VERIFIED_SELECTION_REQUIRED"
		result.MediaCodec = &status
	}
	return result
}

func checkSyncManagedImagePackage(dataRoot string, spec managedImageBackendPackageSpec) ManagedEnvironmentCheckResult {
	backendsPath := filepath.Join(dataRoot, "environments", "managed-image-backends")
	result := ManagedEnvironmentCheckResult{Kind: "managed_image_package", Reference: spec.BackendName + "/" + spec.ReleaseTag,
		Locator: filepath.ToSlash(filepath.Join("environments", "managed-image-backends", spec.InstallDirName)),
		Status:  "unavailable", Reason: "MANAGED_IMAGE_PACKAGE_OWNER_MATERIAL_UNAVAILABLE"}
	executable, workingDir, err := verifyManagedImageBackendPackage(backendsPath, spec.BackendName, spec)
	if err == nil {
		status := managedImageBackendDependencyStatusFromConfig(&ManagedImageBackendConfig{
			BackendName: spec.BackendName, WorkingDir: workingDir,
			Args: []string{"--backend-executable", executable},
		}, spec)
		result.Reason = "MANAGED_IMAGE_PACKAGE_OWNER_MATERIAL_VERIFIED_SELECTION_REQUIRED"
		result.ImageBackend = &status
	}
	return result
}

// @nimi-authority: rule.nimi.runtime.local-compute.r077
func checkSyncFixedDependencies(ctx context.Context, dataRoot string) []ManagedEnvironmentCheckResult {
	var results []ManagedEnvironmentCheckResult
	codecRoot := filepath.Join(dataRoot, "dependencies", "media-codec")
	knownCodecs := map[string]struct{}{}
	if spec, err := mediaCodecSpecFor(currentGOOS(), currentGOARCH()); err == nil {
		knownCodecs[spec.directory] = struct{}{}
		if _, err := os.Lstat(filepath.Join(codecRoot, spec.directory)); !os.IsNotExist(err) {
			results = append(results, checkSyncMediaCodec(ctx, dataRoot, spec, videomedia.VerifyCodecRuns))
		}
	}
	results = append(results, unclaimedManagedRootEntries(codecRoot, "dependencies/media-codec", knownCodecs)...)
	imageRoot := filepath.Join(dataRoot, "environments", "managed-image-backends")
	knownPackages := map[string]struct{}{}
	if spec, ok := resolveManagedImageBackendPackageSpecForCurrentHost("stablediffusion-ggml"); ok && spec.Supported && spec.PackageFormat == managedImageBackendPackageFormatDirectArchive && spec.LaunchMode == managedImageBackendLaunchModeRuntimeWrapper {
		knownPackages[spec.InstallDirName] = struct{}{}
		if _, err := os.Lstat(filepath.Join(imageRoot, spec.InstallDirName)); !os.IsNotExist(err) {
			results = append(results, checkSyncManagedImagePackage(dataRoot, spec))
		}
	}
	results = append(results, unclaimedManagedRootEntries(imageRoot, "environments/managed-image-backends", knownPackages)...)
	return results
}

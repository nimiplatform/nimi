package localservice

import (
	"path/filepath"
	"reflect"
	"sort"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/engine"
)

type checkSyncMaterialMatch func(kind, reference, locator, reason string, requireAvailable bool) bool

// @nimi-authority: rule.nimi.runtime.local-compute.r077
func productControlCheckSyncTorchMaterialSupportsRecord(record localEnvironmentSelectedSourceRecordState, material []engine.ManagedEnvironmentCheckResult, dataRoot string, match checkSyncMaterialMatch) bool {
	cacheRoot := filepath.Join(dataRoot, "dependencies", "python-package-cache")
	parts := strings.Split(record.EnvironmentKey, "|")
	if record.SourceKind != localEnvironmentSourceManaged || len(parts) != 8 || !productControlPathsEqual(record.CanonicalRoot, cacheRoot) ||
		len(record.VerifiedArtifacts) != 1 || !productControlPathsEqual(record.VerifiedArtifacts[0], cacheRoot) {
		return false
	}
	// A shared wheel selection is re-established only through a consuming
	// profile that passed the owner's full package/import/allocation verifier.
	// A cache directory or static lock file alone never establishes readiness.
	for _, row := range material {
		if row.PythonProfile == nil {
			continue
		}
		manifest := row.PythonProfile
		consumer := manifest.ValidationConsumer + "." + manifest.Identity.AcceleratorPlane
		wheel, err := engine.ResolvePythonTorchWheelDependencyIdentity(consumer)
		if err != nil || record.DependencyID != localEnvironmentPythonTorchWheelDependencyID(wheel) ||
			record.EnvironmentKey != localEnvironmentPythonTorchWheelKey(wheel, parts[7], dataRoot) ||
			record.Version != wheel.TorchVersion || record.Hashes["wheel_lock_hash"] != wheel.WheelLockHash {
			continue
		}
		profile, err := engine.ResolvePythonDependencyProfileIdentity(pythonTorchWheelPrerequisiteConsumer(consumer), parts[7], wheel.AcceleratorPlane)
		if err != nil || profile != manifest.Identity || profile.TorchWheelLockHash != wheel.WheelLockHash || profile.TorchVersion != wheel.TorchVersion || profile.CUDAABI != wheel.CUDAABI {
			continue
		}
		markers := []string{"wheel_index=" + strings.TrimPrefix(profile.PackageSource, "pypi=https://pypi.org/simple;pytorch="),
			"accelerator_plane=" + wheel.AcceleratorPlane, "cuda_abi=" + wheel.CUDAABI, "torch_version=" + wheel.TorchVersion}
		for _, probe := range wheel.ImportProbes {
			markers = append(markers, "import_probe="+probe)
		}
		complete := true
		for _, marker := range markers {
			complete = complete && stringSliceContains(record.CompatibilityEvidence, marker)
		}
		locator := filepath.ToSlash(filepath.Join("environments", "python-profiles", profile.ProfileDigest))
		if complete && match("python_profile", profile.ProfileDigest, locator, "PYTHON_PROFILE_OWNER_MATERIAL_VERIFIED_SELECTION_REQUIRED", false) {
			return true
		}
	}
	return false
}

func productControlCheckSyncFixedMaterialSupportsRecord(record localEnvironmentSelectedSourceRecordState, material []engine.ManagedEnvironmentCheckResult, dataRoot string, match checkSyncMaterialMatch) bool {
	if record.SourceKind != localEnvironmentSourceManaged {
		return false
	}
	for _, row := range material {
		switch record.DependencyFamily {
		case localEnvironmentFamilyMediaCodec:
			status := row.MediaCodec
			if status == nil || record.DependencyID != engine.MediaCodecDependencyID || status.Version != record.Version ||
				!productControlPathsEqual(record.CanonicalRoot, status.CanonicalRoot) ||
				!reflect.DeepEqual(record.Hashes, status.Hashes) ||
				!checkSyncArtifactSetsEqual(record.VerifiedArtifacts, status.VerifiedArtifacts) {
				continue
			}
			locator, ok := localEnvironmentOwnerRelativeLocator(dataRoot, status.CanonicalRoot)
			if ok && match("media_codec", record.DependencyID+"/"+record.Version, locator, "MEDIA_CODEC_OWNER_MATERIAL_VERIFIED_SELECTION_REQUIRED", false) {
				return true
			}
		case localEnvironmentFamilyNativeSDCPP:
			status := row.ImageBackend
			if status == nil || record.DependencyID != "stable-diffusion.cpp.package" || status.BackendName != "stablediffusion-ggml" || status.ReleaseTag != record.Version ||
				!productControlPathsEqual(record.CanonicalRoot, status.CanonicalRoot) || record.Hashes["archive_sha256"] != status.ArchiveSHA256 ||
				!checkSyncArtifactSetsEqual(record.VerifiedArtifacts, status.VerifiedArtifacts) {
				continue
			}
			for _, consumer := range record.SelectedConsumers {
				contract, ok := nativeSDCPPPackageContractForEnvironment(record.EnvironmentKey, consumer)
				if ok && nativeSDCPPPackageStatusMatchesContract(*status, contract) &&
					match("managed_image_package", status.BackendName+"/"+status.ReleaseTag, row.Locator, "MANAGED_IMAGE_PACKAGE_OWNER_MATERIAL_VERIFIED_SELECTION_REQUIRED", false) {
					return true
				}
			}
		}
	}
	return false
}

func checkSyncArtifactSetsEqual(left, right []string) bool {
	left = normalizeStringSlice(left)
	right = normalizeStringSlice(right)
	sort.Strings(left)
	sort.Strings(right)
	return reflect.DeepEqual(left, right)
}

package engine

import (
	_ "embed"
	"fmt"
	"strings"
	"sync"

	"gopkg.in/yaml.v3"
)

//go:embed generated/managed-image-backend-packages.yaml
var managedImageBackendPackagesAuthorityYAML []byte

var managedImageBackendPackageAuthority = sync.OnceValues(loadManagedImageBackendPackageSpecsFromAuthority)

type managedImageBackendPackageFormat string

const (
	managedImageBackendPackageFormatNone          managedImageBackendPackageFormat = "none"
	managedImageBackendPackageFormatOCIPayload    managedImageBackendPackageFormat = "oci_payload"
	managedImageBackendPackageFormatDirectArchive managedImageBackendPackageFormat = "direct_archive"
)

type managedImageBackendLaunchMode string

const (
	managedImageBackendLaunchModePackageEntrypoint managedImageBackendLaunchMode = "package_entrypoint"
	managedImageBackendLaunchModeRuntimeWrapper    managedImageBackendLaunchMode = "runtime_wrapper"
)

type managedImageBackendArchiveSource struct {
	URL    string
	SHA256 string
}

type managedImageBackendPackageSource string

const (
	managedImageBackendPackageSourceCanonicalLocalAIDerived   managedImageBackendPackageSource = "canonical_localai_derived"
	managedImageBackendPackageSourceExperimentalOfficialSDCPP managedImageBackendPackageSource = "experimental_official_sdcpp"
	managedImageBackendPackageSourceCanonicalRuntimeWrapper   managedImageBackendPackageSource = "canonical_runtime_wrapper"
	managedImageBackendPackageSourceCanonicalUnavailable      managedImageBackendPackageSource = "canonical_unavailable"
)

type managedImageBackendPackageSpec struct {
	BackendName            string
	PackageSource          managedImageBackendPackageSource
	OS                     string
	Arch                   string
	GPUVendor              string
	InstallDirName         string
	PackageFormat          managedImageBackendPackageFormat
	ImageRef               string
	OCILayerDigest         string
	ArchiveURL             string
	ArchiveSHA256          string
	ExecutableCandidates   []string
	SupportedModelFamilies []string
	LaunchMode             managedImageBackendLaunchMode
	WrapperDriver          string
	Supported              bool
	Detail                 string
}

type managedImageBackendPackagesDocument struct {
	Entries []managedImageBackendPackageEntry `yaml:"entries"`
}

type managedImageBackendPackageEntry struct {
	HostMatch struct {
		OS        string `yaml:"os"`
		Arch      string `yaml:"arch"`
		GPUVendor string `yaml:"gpu_vendor"`
	} `yaml:"host_match"`
	BackendFamily          string   `yaml:"backend_family"`
	PackageSource          string   `yaml:"package_source"`
	PackageFormat          string   `yaml:"package_format"`
	InstallDirName         string   `yaml:"install_dir_name"`
	ImageRef               string   `yaml:"image_ref"`
	OCILayerDigest         string   `yaml:"oci_layer_digest"`
	ArchiveURL             string   `yaml:"archive_url"`
	ArchiveSHA256          string   `yaml:"archive_sha256"`
	ExecutableCandidates   []string `yaml:"executable_candidates"`
	SupportedModelFamilies []string `yaml:"supported_model_families"`
	LaunchMode             string   `yaml:"launch_mode"`
	WrapperDriver          string   `yaml:"wrapper_driver"`
	ProductState           string   `yaml:"product_state"`
	Detail                 string   `yaml:"detail"`
}

func resolveManagedImageBackendPackageSpecForCurrentHost(backendName string) (managedImageBackendPackageSpec, bool) {
	return resolveManagedImageBackendPackageSpecForCurrentHostWithSource(backendName, "")
}

func resolveManagedImageBackendPackageSpecForCurrentHostWithSource(backendName string, source string) (managedImageBackendPackageSpec, bool) {
	return resolveManagedImageBackendPackageSpecForHostWithSource(
		backendName,
		source,
		currentGOOS(),
		currentGOARCH(),
		detectLocalGPUVendor(),
		detectMediaCUDAReady(),
	)
}

func resolveManagedImageBackendPackageSpecForHost(backendName string, goos string, goarch string, gpuVendor string, cudaReady bool) (managedImageBackendPackageSpec, bool) {
	return resolveManagedImageBackendPackageSpecForHostWithSource(backendName, "", goos, goarch, gpuVendor, cudaReady)
}

func resolveManagedImageBackendPackageSpecForHostWithSource(backendName string, source string, goos string, goarch string, gpuVendor string, cudaReady bool) (managedImageBackendPackageSpec, bool) {
	_ = cudaReady // CUDA user-space readiness is resolved as a runtime dependency, not package admission.
	specs, loadErr := managedImageBackendPackageSpecsFromAuthority()
	if loadErr != nil {
		return managedImageBackendPackageSpec{}, false
	}
	normalizedBackend := strings.ToLower(strings.TrimSpace(backendName))
	rawSource := strings.TrimSpace(source)
	normalizedSource := normalizeManagedImageBackendPackageSource(source)
	if rawSource != "" && normalizedSource == "" {
		return managedImageBackendPackageSpec{}, false
	}
	hostGPUVendor := strings.ToLower(strings.TrimSpace(gpuVendor))
	candidates := make([]managedImageBackendPackageSpec, 0, len(specs))
	for _, entry := range specs {
		if !strings.EqualFold(strings.TrimSpace(entry.BackendName), normalizedBackend) {
			continue
		}
		if !strings.EqualFold(strings.TrimSpace(entry.OS), strings.ToLower(strings.TrimSpace(goos))) {
			continue
		}
		if !strings.EqualFold(strings.TrimSpace(entry.Arch), strings.ToLower(strings.TrimSpace(goarch))) {
			continue
		}
		if strings.TrimSpace(entry.GPUVendor) != "" && !strings.EqualFold(strings.TrimSpace(entry.GPUVendor), hostGPUVendor) {
			continue
		}
		candidates = append(candidates, entry)
	}
	if len(candidates) == 0 {
		return managedImageBackendPackageSpec{}, false
	}
	for _, entry := range candidates {
		if entry.PackageSource != "" && entry.PackageSource == normalizedSource {
			return entry, true
		}
	}
	for _, entry := range candidates {
		if entry.PackageSource == "" {
			return entry, true
		}
	}
	if normalizedSource == "" {
		for _, entry := range candidates {
			if entry.PackageSource == managedImageBackendPackageSourceCanonicalLocalAIDerived {
				return entry, true
			}
		}
	}
	if normalizedSource != "" {
		return managedImageBackendPackageSpec{}, false
	}
	return candidates[0], true
}

func managedImageBackendPackageSpecsFromAuthority() ([]managedImageBackendPackageSpec, error) {
	return managedImageBackendPackageAuthority()
}

func loadManagedImageBackendPackageSpecsFromAuthority() ([]managedImageBackendPackageSpec, error) {
	if len(managedImageBackendPackagesAuthorityYAML) == 0 {
		return nil, fmt.Errorf("embedded managed image backend package authority is empty")
	}
	var doc managedImageBackendPackagesDocument
	if err := yaml.Unmarshal(managedImageBackendPackagesAuthorityYAML, &doc); err != nil {
		return nil, fmt.Errorf("parse managed image backend package authority: %w", err)
	}
	specs := make([]managedImageBackendPackageSpec, 0, len(doc.Entries))
	for _, entry := range doc.Entries {
		spec := managedImageBackendPackageSpec{
			BackendName:            strings.TrimSpace(entry.BackendFamily),
			PackageSource:          normalizeManagedImageBackendPackageSource(entry.PackageSource),
			OS:                     strings.ToLower(strings.TrimSpace(entry.HostMatch.OS)),
			Arch:                   strings.ToLower(strings.TrimSpace(entry.HostMatch.Arch)),
			GPUVendor:              strings.ToLower(strings.TrimSpace(entry.HostMatch.GPUVendor)),
			InstallDirName:         strings.TrimSpace(entry.InstallDirName),
			PackageFormat:          managedImageBackendPackageFormat(strings.TrimSpace(entry.PackageFormat)),
			ImageRef:               strings.TrimSpace(entry.ImageRef),
			OCILayerDigest:         strings.TrimSpace(entry.OCILayerDigest),
			ArchiveURL:             strings.TrimSpace(entry.ArchiveURL),
			ArchiveSHA256:          strings.TrimSpace(entry.ArchiveSHA256),
			ExecutableCandidates:   append([]string(nil), entry.ExecutableCandidates...),
			SupportedModelFamilies: normalizeManagedImageBackendModelFamilies(entry.SupportedModelFamilies),
			LaunchMode:             managedImageBackendLaunchMode(strings.TrimSpace(entry.LaunchMode)),
			WrapperDriver:          strings.TrimSpace(entry.WrapperDriver),
			Supported:              strings.TrimSpace(entry.ProductState) == "supported",
			Detail:                 strings.TrimSpace(entry.Detail),
		}
		if err := validateManagedImageBackendPackageSpec(spec); err != nil {
			return nil, err
		}
		specs = append(specs, spec)
	}
	return specs, nil
}

func validateManagedImageBackendPackageSpec(spec managedImageBackendPackageSpec) error {
	if !spec.Supported {
		return nil
	}
	if spec.PackageSource == "" ||
		spec.PackageFormat == "" ||
		spec.PackageFormat == managedImageBackendPackageFormatNone ||
		strings.TrimSpace(spec.InstallDirName) == "" ||
		len(spec.ExecutableCandidates) == 0 ||
		spec.LaunchMode == "" ||
		strings.TrimSpace(spec.WrapperDriver) == "" {
		return fmt.Errorf("supported managed image backend package %q is missing authority-owned launch metadata", spec.BackendName)
	}
	switch spec.PackageFormat {
	case managedImageBackendPackageFormatOCIPayload:
		if strings.TrimSpace(spec.ImageRef) == "" || strings.TrimSpace(spec.OCILayerDigest) == "" {
			return fmt.Errorf("supported OCI managed image backend package %q is missing image digest proof", spec.BackendName)
		}
	case managedImageBackendPackageFormatDirectArchive:
		if strings.TrimSpace(spec.ArchiveURL) == "" || strings.TrimSpace(spec.ArchiveSHA256) == "" {
			return fmt.Errorf("supported archive managed image backend package %q is missing archive hash proof", spec.BackendName)
		}
	default:
		return fmt.Errorf("supported managed image backend package %q has unsupported package format %q", spec.BackendName, spec.PackageFormat)
	}
	return nil
}

func normalizeManagedImageBackendModelFamilies(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	seen := map[string]struct{}{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		normalized := strings.ToLower(strings.TrimSpace(value))
		if normalized == "" {
			continue
		}
		if _, ok := seen[normalized]; ok {
			continue
		}
		seen[normalized] = struct{}{}
		out = append(out, normalized)
	}
	return out
}

func normalizeManagedImageBackendPackageSource(raw string) managedImageBackendPackageSource {
	switch managedImageBackendPackageSource(strings.ToLower(strings.TrimSpace(raw))) {
	case managedImageBackendPackageSourceCanonicalLocalAIDerived:
		return managedImageBackendPackageSourceCanonicalLocalAIDerived
	case managedImageBackendPackageSourceExperimentalOfficialSDCPP:
		return managedImageBackendPackageSourceExperimentalOfficialSDCPP
	case managedImageBackendPackageSourceCanonicalRuntimeWrapper:
		return managedImageBackendPackageSourceCanonicalRuntimeWrapper
	case managedImageBackendPackageSourceCanonicalUnavailable:
		return managedImageBackendPackageSourceCanonicalUnavailable
	default:
		return ""
	}
}

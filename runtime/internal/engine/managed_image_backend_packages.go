package engine

import (
	_ "embed"
	"fmt"
	"os/exec"
	"strconv"
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
	managedImageBackendPackageSourceCanonicalRuntimeWrapper managedImageBackendPackageSource = "canonical_runtime_wrapper"
	managedImageBackendPackageSourceCanonicalUnavailable    managedImageBackendPackageSource = "canonical_unavailable"
)

type managedImageBackendPackageSpec struct {
	BackendName            string
	PackageSource          managedImageBackendPackageSource
	OS                     string
	Arch                   string
	GPUVendor              string
	MinOSVersion           string
	ReleaseTag             string
	SourceCommit           string
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
		OS           string `yaml:"os"`
		Arch         string `yaml:"arch"`
		GPUVendor    string `yaml:"gpu_vendor"`
		MinOSVersion string `yaml:"min_os_version"`
	} `yaml:"host_match"`
	BackendFamily          string   `yaml:"backend_family"`
	PackageSource          string   `yaml:"package_source"`
	PackageFormat          string   `yaml:"package_format"`
	ReleaseTag             string   `yaml:"release_tag"`
	SourceCommit           string   `yaml:"source_commit"`
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
	gpuVendor, driverVisible := detectMediaHostGPU()
	spec, ok := resolveManagedImageBackendPackageSpecForHostWithSource(
		backendName,
		source,
		currentGOOS(),
		currentGOARCH(),
		gpuVendor,
		driverVisible,
	)
	if !ok || !managedImageBackendPackageHostVersionSupported(spec, managedImageBackendCurrentOSVersion()) {
		return managedImageBackendPackageSpec{}, false
	}
	return spec, true
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
	if normalizedSource != "" {
		for _, entry := range candidates {
			if entry.PackageSource == normalizedSource {
				return entry, true
			}
		}
		return managedImageBackendPackageSpec{}, false
	}
	var canonical *managedImageBackendPackageSpec
	for index := range candidates {
		if !candidates[index].Supported {
			continue
		}
		if canonical != nil {
			return managedImageBackendPackageSpec{}, false
		}
		canonical = &candidates[index]
	}
	if canonical == nil {
		return managedImageBackendPackageSpec{}, false
	}
	return *canonical, true
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r099
// @nimi-authority: rule.nimi.runtime.local-compute.r067
// admitManagedImageRecipeForHost closes the exact host/package-family/recipe
// intersection. It validates a Driver-selected recipe; it never selects or
// rewrites one, and proposed package sources are never a fallback.
func admitManagedImageRecipeForHost(recipeFamily string, packageSource string, goos string, goarch string, gpuVendor string, cudaReady bool) error {
	recipeFamily = strings.ToLower(strings.TrimSpace(recipeFamily))
	switch recipeFamily {
	case "z-image", "ideogram4", "qwen-image", "minimax-h3":
	default:
		return fmt.Errorf("managed image recipe family %q is not admitted", recipeFamily)
	}
	if !ManagedImageSupervisedPlatformSupportedFor(goos, goarch, gpuVendor, "") {
		return fmt.Errorf("managed image host tuple %s/%s/%s is recognized but unsupported", strings.ToLower(strings.TrimSpace(goos)), strings.ToLower(strings.TrimSpace(goarch)), strings.ToLower(strings.TrimSpace(gpuVendor)))
	}
	spec, ok := resolveManagedImageBackendPackageSpecForHostWithSource(
		"stablediffusion-ggml",
		packageSource,
		goos,
		goarch,
		gpuVendor,
		cudaReady,
	)
	if !ok {
		return fmt.Errorf("no canonical supported stablediffusion-ggml package is admitted for host tuple %s/%s/%s", strings.ToLower(strings.TrimSpace(goos)), strings.ToLower(strings.TrimSpace(goarch)), strings.ToLower(strings.TrimSpace(gpuVendor)))
	}
	if !spec.Supported {
		detail := strings.TrimSpace(spec.Detail)
		if detail == "" {
			detail = "selected package source is recognized but unsupported"
		}
		return fmt.Errorf("stablediffusion-ggml package source %q is not admitted: %s", spec.PackageSource, detail)
	}
	if !managedImageBackendPackageSupportsFamily(spec, recipeFamily) {
		return fmt.Errorf("stablediffusion-ggml package source %q does not admit recipe family %q", spec.PackageSource, recipeFamily)
	}
	return nil
}

func managedImageBackendPackageSupportsFamily(spec managedImageBackendPackageSpec, family string) bool {
	family = strings.ToLower(strings.TrimSpace(family))
	for _, supported := range spec.SupportedModelFamilies {
		if strings.EqualFold(strings.TrimSpace(supported), family) {
			return true
		}
	}
	return false
}

func admitManagedImageRecipeForCurrentHost(recipeFamily string, packageSource string) error {
	gpuVendor, driverVisible := detectMediaHostGPU()
	if err := admitManagedImageRecipeForHost(
		recipeFamily,
		packageSource,
		currentGOOS(),
		currentGOARCH(),
		gpuVendor,
		driverVisible,
	); err != nil {
		return err
	}
	if _, ok := resolveManagedImageBackendPackageSpecForCurrentHostWithSource("stablediffusion-ggml", packageSource); !ok {
		return fmt.Errorf("managed image package is unsupported on the exact current OS version")
	}
	return nil
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
			MinOSVersion:           strings.TrimSpace(entry.HostMatch.MinOSVersion),
			ReleaseTag:             strings.TrimSpace(entry.ReleaseTag),
			SourceCommit:           strings.ToLower(strings.TrimSpace(entry.SourceCommit)),
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
		strings.TrimSpace(spec.ReleaseTag) == "" ||
		strings.TrimSpace(spec.SourceCommit) == "" ||
		strings.TrimSpace(spec.InstallDirName) == "" ||
		len(spec.ExecutableCandidates) == 0 ||
		spec.LaunchMode == "" ||
		strings.TrimSpace(spec.WrapperDriver) == "" {
		return fmt.Errorf("supported managed image backend package %q is missing authority-owned launch metadata", spec.BackendName)
	}
	if spec.MinOSVersion != "" {
		if _, ok := parseManagedImageBackendVersion(spec.MinOSVersion); !ok {
			return fmt.Errorf("supported managed image backend package %q has an invalid minimum OS version", spec.BackendName)
		}
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

var managedImageBackendCurrentOSVersion = func() string {
	if currentGOOS() != "darwin" {
		return ""
	}
	payload, err := exec.Command("/usr/bin/sw_vers", "-productVersion").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(payload))
}

func managedImageBackendPackageHostVersionSupported(spec managedImageBackendPackageSpec, current string) bool {
	if strings.TrimSpace(spec.MinOSVersion) == "" {
		return true
	}
	want, wantOK := parseManagedImageBackendVersion(spec.MinOSVersion)
	got, gotOK := parseManagedImageBackendVersion(current)
	if !wantOK || !gotOK {
		return false
	}
	for index := range want {
		if got[index] != want[index] {
			return got[index] > want[index]
		}
	}
	return true
}

func parseManagedImageBackendVersion(value string) ([3]int, bool) {
	var result [3]int
	parts := strings.Split(strings.TrimSpace(value), ".")
	if len(parts) < 1 || len(parts) > len(result) {
		return result, false
	}
	for index, part := range parts {
		if part == "" {
			return result, false
		}
		number, err := strconv.Atoi(part)
		if err != nil || number < 0 {
			return result, false
		}
		result[index] = number
	}
	return result, true
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
	case managedImageBackendPackageSourceCanonicalRuntimeWrapper:
		return managedImageBackendPackageSourceCanonicalRuntimeWrapper
	case managedImageBackendPackageSourceCanonicalUnavailable:
		return managedImageBackendPackageSourceCanonicalUnavailable
	default:
		return ""
	}
}

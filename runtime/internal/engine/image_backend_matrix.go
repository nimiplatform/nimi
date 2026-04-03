package engine

import (
	"fmt"
	"strings"
)

// ImageAssetFamily identifies the logical execution family of an image asset.
type ImageAssetFamily string

const (
	ImageAssetFamilyGGUFImage                ImageAssetFamily = "gguf_image"
	ImageAssetFamilySafetensorsNativeImage   ImageAssetFamily = "safetensors_native_image"
	ImageAssetFamilyWorkflowSafetensorsImage ImageAssetFamily = "workflow_safetensors_image"
)

// ImageProfileKind identifies the execution model for profile/slot/materialization.
type ImageProfileKind string

const (
	ImageProfileKindSingleBinaryModel ImageProfileKind = "single_binary_model"
	ImageProfileKindWorkflowPipeline  ImageProfileKind = "workflow_pipeline"
)

// ImageBackendClass identifies the process model of a backend.
type ImageBackendClass string

const (
	ImageBackendClassNativeBinary   ImageBackendClass = "native_binary"
	ImageBackendClassPythonPipeline ImageBackendClass = "python_pipeline"
)

// ImageBackendFamily identifies the specific managed backend.
type ImageBackendFamily string

const (
	ImageBackendFamilyStableDiffusionGGML ImageBackendFamily = "stablediffusion-ggml"
	ImageBackendFamilyDiffusers           ImageBackendFamily = "diffusers"
)

// ImageControlPlane identifies the owner of the orchestration lifecycle for an
// image topology. This is intentionally independent from EngineKind because the
// runtime itself now owns image control-plane responsibilities.
type ImageControlPlane string

const (
	ImageControlPlaneRuntime ImageControlPlane = "runtime"
)

// ImageTopologyState is the structural lifecycle state of a matrix entry.
type ImageTopologyState string

const (
	ImageTopologyStateDefined    ImageTopologyState = "defined"
	ImageTopologyStateDeprecated ImageTopologyState = "deprecated"
	ImageTopologyStateRemoved    ImageTopologyState = "removed"
)

// ImageProductState is the product support surface state of a matrix entry.
type ImageProductState string

const (
	ImageProductStateSupported   ImageProductState = "supported"
	ImageProductStateProposed    ImageProductState = "proposed"
	ImageProductStateUnsupported ImageProductState = "unsupported"
)

// ImageSupervisedMatrixEntry represents one topology slot in the v2 image
// supervised backend matrix. Each entry is keyed by entry_id and describes
// a specific platform + asset_family + backend_family + profile_kind combination.
type ImageSupervisedMatrixEntry struct {
	EntryID               string
	OS                    string
	Arch                  string
	GPUVendor             string
	CUDARequired          bool
	AssetFamily           ImageAssetFamily
	ArtifactFormats       []string
	ProfileKind           ImageProfileKind
	BackendClass          ImageBackendClass
	BackendFamily         ImageBackendFamily
	ControlPlane          ImageControlPlane
	ExecutionPlane        EngineKind
	SupportedCapabilities []string
	TopologyState         ImageTopologyState
	ProductState          ImageProductState
	AdmissionGate         string
	Detail                string
}

// imageSupervisedMatrixV2 is the canonical v2 image supervised backend matrix.
// This must stay in sync with spec/runtime/kernel/tables/local-image-supervised-backend-matrix.yaml.
var imageSupervisedMatrixV2 = []ImageSupervisedMatrixEntry{
	{
		EntryID:               "macos-apple-silicon-gguf",
		OS:                    "darwin",
		Arch:                  "arm64",
		GPUVendor:             "apple",
		AssetFamily:           ImageAssetFamilyGGUFImage,
		ArtifactFormats:       []string{"gguf"},
		ProfileKind:           ImageProfileKindSingleBinaryModel,
		BackendClass:          ImageBackendClassNativeBinary,
		BackendFamily:         ImageBackendFamilyStableDiffusionGGML,
		ControlPlane:          ImageControlPlaneRuntime,
		ExecutionPlane:        EngineMedia,
		SupportedCapabilities: []string{"image.generate.t2i", "image.generate.i2i"},
		TopologyState:         ImageTopologyStateDefined,
		ProductState:          ImageProductStateSupported,
	},
	{
		EntryID:               "macos-apple-silicon-safetensors-native",
		OS:                    "darwin",
		Arch:                  "arm64",
		GPUVendor:             "apple",
		AssetFamily:           ImageAssetFamilySafetensorsNativeImage,
		ArtifactFormats:       []string{"safetensors"},
		ProfileKind:           ImageProfileKindSingleBinaryModel,
		BackendClass:          ImageBackendClassNativeBinary,
		BackendFamily:         ImageBackendFamilyStableDiffusionGGML,
		ControlPlane:          ImageControlPlaneRuntime,
		ExecutionPlane:        EngineMedia,
		SupportedCapabilities: nil,
		TopologyState:         ImageTopologyStateDefined,
		ProductState:          ImageProductStateUnsupported,
		Detail:                "defined topology for single-file safetensors image assets consumed by native binary backend; not yet validated on this host tuple",
	},
	{
		EntryID:               "macos-apple-silicon-workflow-safetensors",
		OS:                    "darwin",
		Arch:                  "arm64",
		GPUVendor:             "apple",
		AssetFamily:           ImageAssetFamilyWorkflowSafetensorsImage,
		ArtifactFormats:       []string{"safetensors", "json_config"},
		ProfileKind:           ImageProfileKindWorkflowPipeline,
		BackendClass:          ImageBackendClassPythonPipeline,
		BackendFamily:         ImageBackendFamilyDiffusers,
		ControlPlane:          ImageControlPlaneRuntime,
		ExecutionPlane:        EngineMedia,
		SupportedCapabilities: nil,
		TopologyState:         ImageTopologyStateDefined,
		ProductState:          ImageProductStateProposed,
		AdmissionGate:         "apple-mps-image-poc",
		Detail:                "recognized topology; becomes supported only after admission contract passes",
	},
	{
		EntryID:               "windows-x64-nvidia-gguf",
		OS:                    "windows",
		Arch:                  "amd64",
		GPUVendor:             "nvidia",
		CUDARequired:          true,
		AssetFamily:           ImageAssetFamilyGGUFImage,
		ArtifactFormats:       []string{"gguf"},
		ProfileKind:           ImageProfileKindSingleBinaryModel,
		BackendClass:          ImageBackendClassNativeBinary,
		BackendFamily:         ImageBackendFamilyStableDiffusionGGML,
		ControlPlane:          ImageControlPlaneRuntime,
		ExecutionPlane:        EngineMedia,
		SupportedCapabilities: []string{"image.generate.t2i", "image.generate.i2i"},
		TopologyState:         ImageTopologyStateDefined,
		ProductState:          ImageProductStateSupported,
	},
	{
		EntryID:               "linux-x64-nvidia-gguf",
		OS:                    "linux",
		Arch:                  "amd64",
		GPUVendor:             "nvidia",
		CUDARequired:          true,
		AssetFamily:           ImageAssetFamilyGGUFImage,
		ArtifactFormats:       []string{"gguf"},
		ProfileKind:           ImageProfileKindSingleBinaryModel,
		BackendClass:          ImageBackendClassNativeBinary,
		BackendFamily:         ImageBackendFamilyStableDiffusionGGML,
		ControlPlane:          ImageControlPlaneRuntime,
		ExecutionPlane:        EngineMedia,
		SupportedCapabilities: []string{"image.generate.t2i", "image.generate.i2i"},
		TopologyState:         ImageTopologyStateDefined,
		ProductState:          ImageProductStateSupported,
	},
	{
		EntryID:               "windows-x64-nvidia-safetensors-native",
		OS:                    "windows",
		Arch:                  "amd64",
		GPUVendor:             "nvidia",
		CUDARequired:          true,
		AssetFamily:           ImageAssetFamilySafetensorsNativeImage,
		ArtifactFormats:       []string{"safetensors"},
		ProfileKind:           ImageProfileKindSingleBinaryModel,
		BackendClass:          ImageBackendClassNativeBinary,
		BackendFamily:         ImageBackendFamilyStableDiffusionGGML,
		ControlPlane:          ImageControlPlaneRuntime,
		ExecutionPlane:        EngineMedia,
		SupportedCapabilities: nil,
		TopologyState:         ImageTopologyStateDefined,
		ProductState:          ImageProductStateUnsupported,
		Detail:                "defined topology for single-file safetensors image assets consumed by native binary backend; not yet validated on this host tuple",
	},
	{
		EntryID:               "windows-x64-nvidia-workflow-safetensors",
		OS:                    "windows",
		Arch:                  "amd64",
		GPUVendor:             "nvidia",
		CUDARequired:          true,
		AssetFamily:           ImageAssetFamilyWorkflowSafetensorsImage,
		ArtifactFormats:       []string{"safetensors", "json_config"},
		ProfileKind:           ImageProfileKindWorkflowPipeline,
		BackendClass:          ImageBackendClassPythonPipeline,
		BackendFamily:         ImageBackendFamilyDiffusers,
		ControlPlane:          ImageControlPlaneRuntime,
		ExecutionPlane:        EngineMedia,
		SupportedCapabilities: nil,
		TopologyState:         ImageTopologyStateDefined,
		ProductState:          ImageProductStateUnsupported,
		Detail:                "defined topology only; mixed-mode single-host local-media process model is not specified in v1",
	},
	{
		EntryID:               "linux-x64-nvidia-safetensors-native",
		OS:                    "linux",
		Arch:                  "amd64",
		GPUVendor:             "nvidia",
		CUDARequired:          true,
		AssetFamily:           ImageAssetFamilySafetensorsNativeImage,
		ArtifactFormats:       []string{"safetensors"},
		ProfileKind:           ImageProfileKindSingleBinaryModel,
		BackendClass:          ImageBackendClassNativeBinary,
		BackendFamily:         ImageBackendFamilyStableDiffusionGGML,
		ControlPlane:          ImageControlPlaneRuntime,
		ExecutionPlane:        EngineMedia,
		SupportedCapabilities: nil,
		TopologyState:         ImageTopologyStateDefined,
		ProductState:          ImageProductStateUnsupported,
		Detail:                "defined topology for single-file safetensors image assets consumed by native binary backend; not yet validated on this host tuple",
	},
	{
		EntryID:               "linux-x64-nvidia-workflow-safetensors",
		OS:                    "linux",
		Arch:                  "amd64",
		GPUVendor:             "nvidia",
		CUDARequired:          true,
		AssetFamily:           ImageAssetFamilyWorkflowSafetensorsImage,
		ArtifactFormats:       []string{"safetensors", "json_config"},
		ProfileKind:           ImageProfileKindWorkflowPipeline,
		BackendClass:          ImageBackendClassPythonPipeline,
		BackendFamily:         ImageBackendFamilyDiffusers,
		ControlPlane:          ImageControlPlaneRuntime,
		ExecutionPlane:        EngineMedia,
		SupportedCapabilities: nil,
		TopologyState:         ImageTopologyStateDefined,
		ProductState:          ImageProductStateUnsupported,
		Detail:                "defined topology only; mixed-mode single-host local-media process model is not specified in v1",
	},
}

// ImageSupervisedMatrixSelection is the output of the v2 image supervised
// backend matrix resolver. It contains the resolved topology entry plus
// derived compatibility information.
type ImageSupervisedMatrixSelection struct {
	// Matched indicates whether a topology entry was matched at all.
	Matched bool

	// Entry is the matched topology entry. Nil when Matched is false.
	Entry *ImageSupervisedMatrixEntry

	// Flattened canonical selection detail for call sites that should not
	// re-interpret topology entry internals.
	EntryID               string
	ProductState          ImageProductState
	BackendClass          ImageBackendClass
	BackendFamily         ImageBackendFamily
	ControlPlane          ImageControlPlane
	ExecutionPlane        EngineKind
	SupportedCapabilities []string

	// Conflict indicates that multiple entries matched the same canonical
	// resolution, which is a spec/configuration error.
	Conflict bool

	// ConflictEntryIDs lists the entry IDs of conflicting matches when
	// Conflict is true.
	ConflictEntryIDs []string

	// CompatibilityDetail describes why the asset cannot be used on this
	// host or why the product state prevents activation.
	CompatibilityDetail string
}

// ImageSupervisedResolverInput contains the canonical and legacy inputs for
// the v2 image supervised matrix resolver.
type ImageSupervisedResolverInput struct {
	// Host facts
	OS        string
	Arch      string
	GPUVendor string
	CUDAReady bool

	// Asset facts (canonical inputs)
	AssetFamily      ImageAssetFamily
	ArtifactFormats  []string
	ProfileKind      ImageProfileKind
	CapabilityTokens []string

	// Legacy hints are retained only for migration/audit threading. Canonical
	// resolution must not infer image topology from these fields.
	LegacyEngineConfigBackend string
	LegacyPreferredEngine     string
}

// ResolveImageSupervisedMatrix performs canonical resolution against the v2
// image supervised backend matrix. It returns a single selection or a conflict.
//
// Resolution order (per K-LENG-012):
//  1. host_match exact constraint
//  2. asset_family
//  3. profile_kind
//  4. artifact_formats
//  5. supported_capabilities / capability support
//  6. topology_state filter (removed entries excluded)
//  7. product_state filter (informational, does not exclude from match)
func ResolveImageSupervisedMatrix(input ImageSupervisedResolverInput) ImageSupervisedMatrixSelection {
	normalizedOS := strings.ToLower(strings.TrimSpace(input.OS))
	normalizedArch := strings.ToLower(strings.TrimSpace(input.Arch))
	normalizedGPUVendor := strings.ToLower(strings.TrimSpace(input.GPUVendor))

	if normalizedOS == "" || normalizedArch == "" {
		return ImageSupervisedMatrixSelection{
			CompatibilityDetail: "host platform information unavailable",
		}
	}

	assetFamily := input.AssetFamily
	profileKind := input.ProfileKind
	artifactFormats := normalizeImageTokens(input.ArtifactFormats)
	capabilityTokens := normalizeImageTokens(input.CapabilityTokens)

	if assetFamily == "" || profileKind == "" || len(artifactFormats) == 0 {
		return ImageSupervisedMatrixSelection{
			CompatibilityDetail: unresolvedFactsDetail(assetFamily, profileKind, artifactFormats),
		}
	}

	var candidates []ImageSupervisedMatrixEntry
	for _, entry := range imageSupervisedMatrixV2 {
		// 1. topology_state=removed excluded from canonical resolution
		if entry.TopologyState == ImageTopologyStateRemoved {
			continue
		}

		// 2. host_match
		if !strings.EqualFold(entry.OS, normalizedOS) {
			continue
		}
		if !strings.EqualFold(entry.Arch, normalizedArch) {
			continue
		}
		if entry.GPUVendor != "" && !strings.EqualFold(entry.GPUVendor, normalizedGPUVendor) {
			continue
		}
		if entry.CUDARequired && !input.CUDAReady {
			continue
		}

		// 3. asset_family (if known)
		if entry.AssetFamily != assetFamily {
			continue
		}

		// 4. profile_kind
		if entry.ProfileKind != profileKind {
			continue
		}

		// 5. artifact_formats
		if !artifactFormatsContained(entry.ArtifactFormats, artifactFormats) {
			continue
		}

		// 6. supported_capabilities / capability support
		if len(capabilityTokens) > 0 && entry.ProductState == ImageProductStateSupported &&
			!capabilitiesContained(entry.SupportedCapabilities, capabilityTokens) {
			continue
		}

		candidates = append(candidates, entry)
	}

	if len(candidates) == 0 {
		return ImageSupervisedMatrixSelection{
			CompatibilityDetail: noMatchDetail(normalizedOS, normalizedArch, assetFamily, profileKind, artifactFormats),
		}
	}

	if len(candidates) == 1 {
		return buildMatrixSelection(candidates[0], false, nil)
	}

	// Multiple candidates: conflict per K-LENG-012.
	ids := make([]string, len(candidates))
	for i, c := range candidates {
		ids[i] = c.EntryID
	}
	return ImageSupervisedMatrixSelection{
		Matched:          true,
		Conflict:         true,
		ConflictEntryIDs: ids,
		CompatibilityDetail: fmt.Sprintf(
			"multiple topology entries matched: %s; runtime cannot arbitrate",
			strings.Join(ids, ", "),
		),
	}
}

func normalizeImageTokens(values []string) []string {
	out := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
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

func artifactFormatsContained(entryFormats []string, assetFormats []string) bool {
	if len(entryFormats) == 0 {
		return true
	}
	assetSet := make(map[string]struct{}, len(assetFormats))
	for _, format := range normalizeImageTokens(assetFormats) {
		assetSet[format] = struct{}{}
	}
	for _, format := range normalizeImageTokens(entryFormats) {
		if _, ok := assetSet[format]; !ok {
			return false
		}
	}
	return true
}

func capabilitiesContained(entryCapabilities []string, required []string) bool {
	if len(required) == 0 {
		return true
	}
	entrySet := make(map[string]struct{}, len(entryCapabilities))
	for _, capability := range normalizeImageTokens(entryCapabilities) {
		entrySet[capability] = struct{}{}
	}
	for _, r := range normalizeImageTokens(required) {
		if _, ok := entrySet[strings.ToLower(strings.TrimSpace(r))]; !ok {
			return false
		}
	}
	return true
}

func unresolvedFactsDetail(family ImageAssetFamily, profileKind ImageProfileKind, artifactFormats []string) string {
	switch {
	case family == "" && profileKind == "" && len(artifactFormats) == 0:
		return "canonical image asset facts unavailable; asset_family, profile_kind, and artifact_formats are required for resolver selection"
	case family == "":
		return "canonical image asset facts unavailable; asset_family is required for resolver selection"
	case profileKind == "":
		return "canonical image asset facts unavailable; profile_kind is required for resolver selection"
	default:
		return "canonical image asset facts unavailable; artifact_formats are required for resolver selection"
	}
}

func noMatchDetail(goos, goarch string, family ImageAssetFamily, profileKind ImageProfileKind, artifactFormats []string) string {
	return fmt.Sprintf(
		"no image supervised topology entry matches host %s/%s with asset_family=%s profile_kind=%s artifact_formats=%s",
		goos,
		goarch,
		family,
		profileKind,
		strings.Join(artifactFormats, ","),
	)
}

func buildMatrixSelection(entry ImageSupervisedMatrixEntry, conflict bool, conflictIDs []string) ImageSupervisedMatrixSelection {
	selection := ImageSupervisedMatrixSelection{
		Matched:               true,
		Entry:                 &entry,
		EntryID:               entry.EntryID,
		ProductState:          entry.ProductState,
		BackendClass:          entry.BackendClass,
		BackendFamily:         entry.BackendFamily,
		ControlPlane:          entry.ControlPlane,
		ExecutionPlane:        entry.ExecutionPlane,
		SupportedCapabilities: append([]string(nil), entry.SupportedCapabilities...),
		Conflict:              conflict,
		ConflictEntryIDs:      append([]string(nil), conflictIDs...),
		CompatibilityDetail:   productStateDetail(&entry),
	}
	return selection
}

func productStateDetail(entry *ImageSupervisedMatrixEntry) string {
	switch entry.ProductState {
	case ImageProductStateSupported:
		return ""
	case ImageProductStateProposed:
		gate := entry.AdmissionGate
		if gate == "" {
			gate = "unknown"
		}
		return fmt.Sprintf("topology %s is recognized but not yet admitted; admission gate: %s", entry.EntryID, gate)
	case ImageProductStateUnsupported:
		detail := entry.Detail
		if detail == "" {
			detail = fmt.Sprintf("topology %s is recognized but unsupported on the current product surface", entry.EntryID)
		}
		return detail
	default:
		return entry.Detail
	}
}

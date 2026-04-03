package localservice

import (
	"context"
	"fmt"
	"path/filepath"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"
)

type canonicalImageResolverFacts struct {
	engineName      string
	capabilities    []string
	kind            runtimev1.LocalAssetKind
	entry           string
	files           []string
	hashes          map[string]string
	artifactRoles   []string
	logicalModelID  string
	preferredEngine string
	engineConfig    *structpb.Struct
}

func canonicalImageResolverFactsForLocalAsset(model *runtimev1.LocalAssetRecord) canonicalImageResolverFacts {
	if model == nil {
		return canonicalImageResolverFacts{}
	}
	return canonicalImageResolverFacts{
		engineName:      model.GetEngine(),
		capabilities:    append([]string(nil), model.GetCapabilities()...),
		kind:            model.GetKind(),
		entry:           model.GetEntry(),
		files:           append([]string(nil), model.GetFiles()...),
		hashes:          cloneStringMap(model.GetHashes()),
		artifactRoles:   append([]string(nil), model.GetArtifactRoles()...),
		logicalModelID:  model.GetLogicalModelId(),
		preferredEngine: model.GetPreferredEngine(),
		engineConfig:    cloneStruct(model.GetEngineConfig()),
	}
}

func canonicalImageResolverFactsForVerifiedAsset(item *runtimev1.LocalVerifiedAssetDescriptor) canonicalImageResolverFacts {
	if item == nil {
		return canonicalImageResolverFacts{}
	}
	return canonicalImageResolverFacts{
		engineName:      item.GetEngine(),
		capabilities:    append([]string(nil), item.GetCapabilities()...),
		kind:            item.GetKind(),
		entry:           item.GetEntry(),
		files:           append([]string(nil), item.GetFiles()...),
		hashes:          cloneStringMap(item.GetHashes()),
		artifactRoles:   append([]string(nil), item.GetArtifactRoles()...),
		logicalModelID:  item.GetLogicalModelId(),
		preferredEngine: item.GetPreferredEngine(),
		engineConfig:    cloneStruct(item.GetEngineConfig()),
	}
}

func canonicalImageResolverFactsForInstallPlan(plan *runtimev1.LocalInstallPlanDescriptor) canonicalImageResolverFacts {
	if plan == nil {
		return canonicalImageResolverFacts{}
	}
	return canonicalImageResolverFacts{
		engineName:   plan.GetEngine(),
		capabilities: append([]string(nil), plan.GetCapabilities()...),
		kind:         inferAssetKindFromCapabilities(plan.GetCapabilities()),
		entry:        plan.GetEntry(),
		files:        append([]string(nil), plan.GetFiles()...),
		hashes:       cloneStringMap(plan.GetHashes()),
		engineConfig: cloneStruct(plan.GetEngineConfig()),
	}
}

func canonicalImageResolverFactsForImport(
	engineName string,
	capabilities []string,
	kind runtimev1.LocalAssetKind,
	entry string,
	files []string,
	hashes map[string]string,
	artifactRoles []string,
	preferredEngine string,
	engineConfig *structpb.Struct,
) canonicalImageResolverFacts {
	return canonicalImageResolverFacts{
		engineName:      engineName,
		capabilities:    append([]string(nil), capabilities...),
		kind:            kind,
		entry:           entry,
		files:           append([]string(nil), files...),
		hashes:          cloneStringMap(hashes),
		artifactRoles:   append([]string(nil), artifactRoles...),
		preferredEngine: preferredEngine,
		engineConfig:    cloneStruct(engineConfig),
	}
}

func canonicalSupervisedImageSelection(
	profile *runtimev1.LocalDeviceProfile,
	facts canonicalImageResolverFacts,
) engine.ImageSupervisedMatrixSelection {
	if profile == nil {
		return engine.ImageSupervisedMatrixSelection{
			CompatibilityDetail: "device profile unavailable",
		}
	}
	input, ok := canonicalImageResolverInput(profile, facts)
	if !ok {
		return engine.ImageSupervisedMatrixSelection{
			CompatibilityDetail: "canonical image asset facts unavailable",
		}
	}
	return engine.ResolveImageSupervisedMatrix(input)
}

func canonicalSupervisedImageSelectionForAsset(
	engineName string,
	capabilities []string,
	kind runtimev1.LocalAssetKind,
	profile *runtimev1.LocalDeviceProfile,
) engine.ImageSupervisedMatrixSelection {
	if !isCanonicalSupervisedImageAsset(engineName, capabilities, kind) {
		return engine.ImageSupervisedMatrixSelection{}
	}
	return canonicalSupervisedImageSelection(
		profile,
		canonicalImageResolverFactsForImport(engineName, capabilities, kind, "", nil, nil, nil, "", nil),
	)
}

func canonicalImageResolverInput(
	profile *runtimev1.LocalDeviceProfile,
	facts canonicalImageResolverFacts,
) (engine.ImageSupervisedResolverInput, bool) {
	if profile == nil || !isCanonicalSupervisedImageAsset(facts.engineName, facts.capabilities, facts.kind) {
		return engine.ImageSupervisedResolverInput{}, false
	}

	assetFamily, profileKind, artifactFormats := deriveCanonicalImageFacts(facts)
	input := engine.ImageSupervisedResolverInput{
		OS:              profile.GetOs(),
		Arch:            profile.GetArch(),
		GPUVendor:       profile.GetGpu().GetVendor(),
		AssetFamily:     assetFamily,
		ArtifactFormats: artifactFormats,
		ProfileKind:     profileKind,
	}
	cudaReady, _ := probeGPUCUDAReady()
	input.CUDAReady = cudaReady
	return input, true
}

func deriveCanonicalImageFacts(facts canonicalImageResolverFacts) (engine.ImageAssetFamily, engine.ImageProfileKind, []string) {
	files := normalizeStringSlice(append([]string{facts.entry}, facts.files...))
	artifactFormats := make([]string, 0, 2)

	hasGGUF := pathListHasExtension(files, ".gguf") || pathMapHasExtension(facts.hashes, ".gguf")
	hasModelIndex := pathListHasBase(files, "model_index.json") || pathMapHasBase(facts.hashes, "model_index.json")
	hasSafetensors := pathListHasExtension(files, ".safetensors") || pathMapHasExtension(facts.hashes, ".safetensors")

	// Workflow bundle: model_index.json is the definitive workflow marker.
	// artifact_roles alone (without model_index.json) do not constitute workflow completeness.
	workflowBundleComplete := hasModelIndex

	switch {
	case hasGGUF:
		return engine.ImageAssetFamilyGGUFImage, engine.ImageProfileKindSingleBinaryModel, []string{"gguf"}
	case workflowBundleComplete:
		artifactFormats = appendArtifactFormat(artifactFormats, "json_config", true)
		artifactFormats = appendArtifactFormat(artifactFormats, "safetensors", hasSafetensors)
		return engine.ImageAssetFamilyWorkflowSafetensorsImage, engine.ImageProfileKindWorkflowPipeline, artifactFormats
	case hasSafetensors:
		return engine.ImageAssetFamilySafetensorsNativeImage, engine.ImageProfileKindSingleBinaryModel, []string{"safetensors"}
	default:
		return "", "", nil
	}
}

func appendArtifactFormat(values []string, format string, include bool) []string {
	if !include {
		return values
	}
	normalized := strings.ToLower(strings.TrimSpace(format))
	for _, existing := range values {
		if existing == normalized {
			return values
		}
	}
	return append(values, normalized)
}

func pathListHasExtension(paths []string, ext string) bool {
	normalizedExt := strings.ToLower(strings.TrimSpace(ext))
	for _, path := range paths {
		if strings.EqualFold(filepath.Ext(strings.TrimSpace(path)), normalizedExt) {
			return true
		}
	}
	return false
}

func pathMapHasExtension(paths map[string]string, ext string) bool {
	normalizedExt := strings.ToLower(strings.TrimSpace(ext))
	for path := range paths {
		if strings.EqualFold(filepath.Ext(strings.TrimSpace(path)), normalizedExt) {
			return true
		}
	}
	return false
}

func pathListHasBase(paths []string, base string) bool {
	normalizedBase := strings.ToLower(strings.TrimSpace(base))
	for _, path := range paths {
		if strings.EqualFold(filepath.Base(strings.TrimSpace(path)), normalizedBase) {
			return true
		}
	}
	return false
}

func pathMapHasBase(paths map[string]string, base string) bool {
	normalizedBase := strings.ToLower(strings.TrimSpace(base))
	for path := range paths {
		if strings.EqualFold(filepath.Base(strings.TrimSpace(path)), normalizedBase) {
			return true
		}
	}
	return false
}

func canonicalSupervisedImageSupportDetailForAsset(
	engineName string,
	capabilities []string,
	kind runtimev1.LocalAssetKind,
	profile *runtimev1.LocalDeviceProfile,
) string {
	if !isCanonicalSupervisedImageAsset(engineName, capabilities, kind) {
		return ""
	}
	facts := canonicalImageResolverFactsForImport(engineName, capabilities, kind, "", nil, nil, nil, "", nil)
	return strings.TrimSpace(canonicalSupervisedImageSelection(profile, facts).CompatibilityDetail)
}

func canonicalSupervisedImageSupportDetailForVerifiedAsset(
	item *runtimev1.LocalVerifiedAssetDescriptor,
	profile *runtimev1.LocalDeviceProfile,
) string {
	if item == nil {
		return ""
	}
	return strings.TrimSpace(canonicalSupervisedImageSelection(profile, canonicalImageResolverFactsForVerifiedAsset(item)).CompatibilityDetail)
}

func canonicalSupervisedImageSupportDetailForInstallPlan(
	plan *runtimev1.LocalInstallPlanDescriptor,
	profile *runtimev1.LocalDeviceProfile,
) string {
	if plan == nil {
		return ""
	}
	return strings.TrimSpace(canonicalSupervisedImageSelection(profile, canonicalImageResolverFactsForInstallPlan(plan)).CompatibilityDetail)
}

func canonicalSupervisedImageHostSupportedForAsset(
	engineName string,
	capabilities []string,
	kind runtimev1.LocalAssetKind,
	profile *runtimev1.LocalDeviceProfile,
) bool {
	if !isCanonicalSupervisedImageAsset(engineName, capabilities, kind) {
		return true
	}
	facts := canonicalImageResolverFactsForImport(engineName, capabilities, kind, "", nil, nil, nil, "", nil)
	return canonicalSupervisedImageSelectionSupported(profile, facts)
}

func canonicalSupervisedImageHostSupportedForVerifiedAsset(
	item *runtimev1.LocalVerifiedAssetDescriptor,
	profile *runtimev1.LocalDeviceProfile,
) bool {
	if item == nil {
		return false
	}
	return canonicalSupervisedImageSelectionSupported(profile, canonicalImageResolverFactsForVerifiedAsset(item))
}

func canonicalSupervisedImageHostSupportedForInstallPlan(
	plan *runtimev1.LocalInstallPlanDescriptor,
	profile *runtimev1.LocalDeviceProfile,
) bool {
	if plan == nil {
		return false
	}
	return canonicalSupervisedImageSelectionSupported(profile, canonicalImageResolverFactsForInstallPlan(plan))
}

func canonicalSupervisedImageSelectionSupported(
	profile *runtimev1.LocalDeviceProfile,
	facts canonicalImageResolverFacts,
) bool {
	sel := canonicalSupervisedImageSelection(profile, facts)
	return sel.Matched && !sel.Conflict && sel.Entry != nil && sel.ProductState == engine.ImageProductStateSupported
}

func canonicalSupervisedImageSelectionForLocalAsset(
	model *runtimev1.LocalAssetRecord,
	profile *runtimev1.LocalDeviceProfile,
) engine.ImageSupervisedMatrixSelection {
	if model == nil {
		return engine.ImageSupervisedMatrixSelection{
			CompatibilityDetail: "local image model unavailable",
		}
	}
	return canonicalSupervisedImageSelection(profile, canonicalImageResolverFactsForLocalAsset(model))
}

func canonicalSupervisedImageAttachedEndpointDetail(
	engineName string,
	capabilities []string,
	kind runtimev1.LocalAssetKind,
) string {
	if !isCanonicalSupervisedImageAsset(engineName, capabilities, kind) {
		return ""
	}
	return "local image assets require runtime supervised execution; attached endpoints are not supported for the canonical image path"
}

func canonicalImageCatalogComparableIdentity(model *runtimev1.LocalAssetRecord, managedAlias string) string {
	if model == nil {
		return ""
	}
	base := strings.TrimSpace(model.GetLogicalModelId())
	if base == "" {
		base = strings.TrimSpace(model.GetAssetId())
	}
	alias := strings.TrimSpace(managedAlias)
	if alias == "" {
		return base
	}
	if base == "" {
		return alias
	}
	return base + "#" + alias
}

func managedRuntimeEngineForSelection(selection engine.ImageSupervisedMatrixSelection) string {
	if selection.Entry == nil {
		return ""
	}
	if selection.ControlPlane == engine.ImageControlPlaneRuntime {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(string(selection.ExecutionPlane)))
}

func executionRuntimeEngineForSelection(selection engine.ImageSupervisedMatrixSelection) string {
	if selection.Entry == nil {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(string(selection.ExecutionPlane)))
}

func (s *Service) ResolveCanonicalImageSelection(_ context.Context, requestedModelID string) (engine.ImageSupervisedMatrixSelection, error) {
	model := s.resolveManagedMediaImageModel(requestedModelID)
	if model == nil {
		return engine.ImageSupervisedMatrixSelection{}, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	return canonicalSupervisedImageSelectionForLocalAsset(model, collectDeviceProfile()), nil
}

// ManagedSupervisedImageBootstrapSelection returns the canonical image matrix
// selection currently required by supervised local image assets. The boolean
// reports whether any supervised canonical image asset is present at all.
func (s *Service) ManagedSupervisedImageBootstrapSelection() (engine.ImageSupervisedMatrixSelection, bool) {
	s.mu.RLock()
	models := make([]*runtimev1.LocalAssetRecord, 0, len(s.assets))
	modes := make(map[string]runtimev1.LocalEngineRuntimeMode, len(s.assetRuntimeModes))
	for localModelID, model := range s.assets {
		models = append(models, cloneLocalAsset(model))
		modes[localModelID] = s.assetRuntimeModes[localModelID]
	}
	s.mu.RUnlock()

	profile := collectDeviceProfile()
	found := false
	activeFound := false
	var firstActiveSelection engine.ImageSupervisedMatrixSelection
	activeSupportedSelections := map[string]engine.ImageSupervisedMatrixSelection{}
	supportedSelections := map[string]engine.ImageSupervisedMatrixSelection{}

	for _, model := range models {
		if model == nil || model.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_REMOVED {
			continue
		}
		localModelID := strings.TrimSpace(model.GetLocalAssetId())
		if normalizeRuntimeMode(modes[localModelID]) != runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED {
			continue
		}
		if !isCanonicalSupervisedImageAsset(model.GetEngine(), model.GetCapabilities(), model.GetKind()) {
			continue
		}
		found = true
		isActive := model.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE
		if isActive {
			activeFound = true
		}
		selection := canonicalSupervisedImageSelectionForLocalAsset(model, profile)
		if selection.Conflict {
			return selection, true
		}
		if !selection.Matched || selection.Entry == nil {
			if isActive && firstActiveSelection.EntryID == "" && firstActiveSelection.CompatibilityDetail == "" {
				firstActiveSelection = selection
			}
			continue
		}
		if isActive {
			if selection.ProductState == engine.ImageProductStateSupported {
				activeSupportedSelections[selection.EntryID] = selection
			} else if firstActiveSelection.EntryID == "" && firstActiveSelection.CompatibilityDetail == "" {
				firstActiveSelection = selection
			}
		}
		if selection.ProductState == engine.ImageProductStateSupported {
			supportedSelections[selection.EntryID] = selection
		}
	}

	if !found {
		return engine.ImageSupervisedMatrixSelection{}, false
	}

	selectUnique := func(
		source map[string]engine.ImageSupervisedMatrixSelection,
		conflictDetail string,
	) engine.ImageSupervisedMatrixSelection {
		entryIDs := make([]string, 0, len(source))
		for entryID := range source {
			entryIDs = append(entryIDs, entryID)
		}
		sort.Strings(entryIDs)
		if len(entryIDs) == 1 {
			return source[entryIDs[0]]
		}
		return engine.ImageSupervisedMatrixSelection{
			Matched:          true,
			Conflict:         true,
			ConflictEntryIDs: append([]string(nil), entryIDs...),
			CompatibilityDetail: fmt.Sprintf(
				conflictDetail,
				strings.Join(entryIDs, ", "),
			),
		}
	}

	if activeFound {
		if len(activeSupportedSelections) > 0 {
			return selectUnique(activeSupportedSelections, "multiple managed image topology entries are active: %s; runtime cannot arbitrate"), true
		}
		if firstActiveSelection.EntryID != "" || firstActiveSelection.CompatibilityDetail != "" {
			return firstActiveSelection, true
		}
		return engine.ImageSupervisedMatrixSelection{}, false
	}

	if len(supportedSelections) > 0 {
		return selectUnique(supportedSelections, "multiple supported managed image topology entries are installed: %s; runtime cannot arbitrate"), true
	}
	return engine.ImageSupervisedMatrixSelection{}, false
}

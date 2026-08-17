package localservice

import (
	"fmt"
	"sort"
	"strings"

	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

// verifiedAssetsFromLocalCatalog projects the K-MCAT `local` provider catalog
// (K-MCAT-032 local-plane rows + variants) into the runtime verified-asset
// surface. Per K-LOCAL-010 / K-LOCAL-011 this is the single SSOT for verified
// local-asset truth — there is no in-process hardcoded verified-asset literal.
//
// Each variant is one independent installable ModelAsset offer: asset_id and
// template_id derive from the variant-level variant_id. Passive offers carry no
// parent identity, selection, requiredness, or runnable logical model.
func verifiedAssetsFromLocalCatalog(local *catalog.LocalProviderCatalog) ([]*runtimev1.LocalVerifiedAssetDescriptor, error) {
	if local == nil {
		return nil, fmt.Errorf("verified asset projection: local provider catalog is nil")
	}
	rows := local.LocalPlaneModels()
	descriptors := make([]*runtimev1.LocalVerifiedAssetDescriptor, 0, len(rows))
	for _, row := range rows {
		for _, variant := range row.Variants {
			descriptor, projectErr := projectVerifiedAssetDescriptor(row, variant)
			if projectErr != nil {
				return nil, projectErr
			}
			descriptors = append(descriptors, descriptor)
		}
	}
	sort.Slice(descriptors, func(i, j int) bool {
		return descriptors[i].GetTemplateId() < descriptors[j].GetTemplateId()
	})
	return descriptors, nil
}

func verifiedAssetKindForPassiveModel(modelType string) (runtimev1.LocalAssetKind, error) {
	switch strings.TrimSpace(modelType) {
	case "vae":
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE, nil
	case "clip":
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CLIP, nil
	case "lora":
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_LORA, nil
	case "controlnet":
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CONTROLNET, nil
	case "auxiliary":
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY, nil
	default:
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED, fmt.Errorf("unsupported passive ModelAsset offer type %q", modelType)
	}
}

// projectVerifiedAssetDescriptor builds one LocalVerifiedAssetDescriptor from a
// catalog row + selected variant. Missing integrity material fails closed
// (K-LOCAL-010): a verified projection must never produce a placeholder
// descriptor.
// @nimi-authority: rule.nimi.runtime.model-catalog.r058
// @nimi-authority: rule.nimi.runtime.model-catalog.r033
func projectVerifiedAssetDescriptor(
	row catalog.ModelEntry,
	variant catalog.LocalPlaneVariant,
) (*runtimev1.LocalVerifiedAssetDescriptor, error) {
	install := row.Install
	if install == nil {
		return nil, fmt.Errorf("verified asset projection: model %q has no install block", row.ModelID)
	}
	variantID := strings.TrimSpace(variant.VariantID)
	if variantID == "" {
		return nil, fmt.Errorf("verified asset projection: model %q has a variant with empty variant_id", row.ModelID)
	}
	hashes := make(map[string]string, len(variant.Files))
	for _, file := range variant.Files {
		hash := strings.TrimSpace(variant.Hashes[file])
		if hash == "" {
			return nil, fmt.Errorf("verified asset projection: variant %q file %q is missing an integrity hash", variantID, file)
		}
		hashes[file] = hash
	}
	if len(hashes) == 0 {
		return nil, fmt.Errorf("verified asset projection: variant %q has no integrity material", variantID)
	}
	capabilities := append([]string(nil), row.Capabilities...)
	kind := inferAssetKindFromCapabilities(capabilities)
	passive := len(capabilities) == 0
	if passive {
		var err error
		kind, err = verifiedAssetKindForPassiveModel(row.ModelType)
		if err != nil {
			return nil, err
		}
	}
	engine := ""
	logicalModelID := ""
	if !passive {
		engine = strings.ToLower(strings.TrimSpace(install.PreferredEngine))
		if engine == "" {
			engine = defaultLocalEngine("", capabilities)
		}
		logicalModelID = strings.TrimSpace(row.ModelID)
	}
	title := strings.TrimSpace(row.ModelID)
	if variant.Quant != "" {
		title = fmt.Sprintf("%s (%s)", title, variant.Quant)
	}
	repo := strings.TrimSpace(variant.Repo)
	revision := strings.TrimSpace(variant.Revision)
	if repo == "" {
		repo = strings.TrimSpace(install.Repo)
		revision = strings.TrimSpace(install.Revision)
	}
	var metadata *structpb.Struct
	var engineConfig *structpb.Struct
	family := strings.TrimSpace(row.Family)
	backend := strings.TrimSpace(variant.DriverBackend)
	metadataValues := map[string]any{
		"accelerator":    strings.ToLower(strings.TrimSpace(variant.HostRequirement.Accelerator)),
		"min_ram_bytes":  variant.HostRequirement.MinRAMBytes,
		"min_vram_bytes": variant.HostRequirement.MinVRAMBytes,
	}
	if family != "" {
		metadataValues["family"] = family
		if !passive {
			engineConfig, _ = structpb.NewStruct(map[string]any{
				"driver_family":  family,
				"driver_backend": backend,
			})
		}
	}
	metadata, _ = structpb.NewStruct(metadataValues)
	description := fmt.Sprintf("Verified local %s asset projected from the K-MCAT local catalog", strings.Join(capabilities, ", "))
	if passive {
		description = fmt.Sprintf("Verified independent local %s ModelAsset offer", strings.Join(install.ArtifactRoles, ", "))
	}
	return &runtimev1.LocalVerifiedAssetDescriptor{
		TemplateId:       variantID,
		Title:            title,
		Description:      description,
		AssetId:          variantID,
		Kind:             kind,
		Engine:           engine,
		Entry:            strings.TrimSpace(variant.Entry),
		Files:            append([]string(nil), variant.Files...),
		Repo:             repo,
		Revision:         revision,
		Hashes:           hashes,
		FileCount:        int32(len(variant.Files)),
		TotalSizeBytes:   variant.TotalSizeBytes,
		Tags:             verifiedAssetTags(capabilities, variant.Quant),
		InstallKind:      strings.TrimSpace(install.InstallKind),
		LogicalModelId:   logicalModelID,
		Capabilities:     capabilities,
		ArtifactRoles:    append([]string(nil), install.ArtifactRoles...),
		PreferredEngine:  engine,
		Metadata:         metadata,
		EngineConfig:     engineConfig,
		HostRequirements: projectHostRequirements(variant.HostRequirement, engine),
	}, nil
}

// verifiedAssetTags derives the descriptor tag set from capabilities + quant.
func verifiedAssetTags(capabilities []string, quant string) []string {
	tags := []string{"verified"}
	for _, capability := range capabilities {
		switch strings.ToLower(strings.TrimSpace(capability)) {
		case "text.generate":
			tags = append(tags, "chat")
		case "audio.transcribe":
			tags = append(tags, "stt")
		case "audio.synthesize":
			tags = append(tags, "tts")
		case "image.generate":
			tags = append(tags, "image")
		case "video.generate":
			tags = append(tags, "video")
		}
	}
	if quant := strings.TrimSpace(quant); quant != "" {
		tags = append(tags, strings.ToLower(quant))
	}
	return tags
}

// projectHostRequirements derives the LocalHostRequirements engine-prereq block
// from a variant host_requirement. Speech engines require a Python runtime;
// accelerated variants require a GPU.
func projectHostRequirements(
	requirement catalog.LocalPlaneHostRequirement,
	engine string,
) *runtimev1.LocalHostRequirements {
	accelerator := strings.ToLower(strings.TrimSpace(requirement.Accelerator))
	return &runtimev1.LocalHostRequirements{
		GpuRequired:           accelerator == "cuda" || accelerator == "metal",
		PythonRuntimeRequired: strings.EqualFold(strings.TrimSpace(engine), "speech"),
	}
}

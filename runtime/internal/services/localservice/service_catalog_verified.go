package localservice

import (
	"fmt"
	"sort"
	"strings"

	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// verifiedAssetsFromLocalCatalog projects the K-MCAT `local` provider catalog
// (K-MCAT-032 local-plane rows + variants) into the runtime verified-asset
// surface. Per K-LOCAL-010 / K-LOCAL-011 this is the single SSOT for verified
// local-asset truth — there is no in-process hardcoded verified-asset literal.
//
// Each variant is one installable asset: asset_id / template_id derive from the
// variant-level variant_id (K-MCAT-032 installable identity), while
// logical_model_id derives from the catalog row model_id.
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

// ResolveCatalogModelIDForLocalAsset returns the canonical catalog model
// identity only when the installed asset's complete sha256 fingerprint exactly
// matches one reviewed local catalog variant. File imports keep their unique
// installed and storage identities; this proof restores only the catalog
// identity needed by catalog-owned execution metadata.
func (s *Service) ResolveCatalogModelIDForLocalAsset(localAssetID string) (string, bool) {
	if s == nil {
		return "", false
	}
	s.mu.RLock()
	asset := cloneLocalAsset(s.assets[strings.TrimSpace(localAssetID)])
	verified := make([]*runtimev1.LocalVerifiedAssetDescriptor, 0, len(s.verified))
	for _, descriptor := range s.verified {
		verified = append(verified, cloneVerifiedAsset(descriptor))
	}
	s.mu.RUnlock()
	if asset == nil {
		return "", false
	}
	assetFingerprint := localAssetSHA256Fingerprint(asset.GetHashes())
	if assetFingerprint == "" {
		return "", false
	}

	resolvedModelID := ""
	for _, descriptor := range verified {
		if descriptor == nil ||
			descriptor.GetKind() != asset.GetKind() ||
			!strings.EqualFold(strings.TrimSpace(descriptor.GetEngine()), strings.TrimSpace(asset.GetEngine())) ||
			localAssetSHA256Fingerprint(descriptor.GetHashes()) != assetFingerprint {
			continue
		}
		candidate := strings.TrimSpace(descriptor.GetLogicalModelId())
		if candidate == "" {
			continue
		}
		if resolvedModelID != "" && resolvedModelID != candidate {
			return "", false
		}
		resolvedModelID = candidate
	}
	return resolvedModelID, resolvedModelID != ""
}

func localAssetSHA256Fingerprint(hashes map[string]string) string {
	if len(hashes) == 0 {
		return ""
	}
	values := make([]string, 0, len(hashes))
	for _, value := range hashes {
		normalized := normalizeExpectedSHA256Hash(value)
		if normalized == "" {
			return ""
		}
		values = append(values, normalized)
	}
	sort.Strings(values)
	return strings.Join(values, "\n")
}

// projectVerifiedAssetDescriptor builds one LocalVerifiedAssetDescriptor from a
// catalog row + selected variant. Missing integrity material fails closed
// (K-LOCAL-010): a verified projection must never produce a placeholder
// descriptor.
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
	engine := strings.ToLower(strings.TrimSpace(install.PreferredEngine))
	if engine == "" {
		engine = defaultLocalEngine("", capabilities)
	}
	title := strings.TrimSpace(row.ModelID)
	if variant.Quant != "" {
		title = fmt.Sprintf("%s (%s)", title, variant.Quant)
	}
	return &runtimev1.LocalVerifiedAssetDescriptor{
		TemplateId:       variantID,
		Title:            title,
		Description:      fmt.Sprintf("Verified local %s asset projected from the K-MCAT local catalog", strings.Join(capabilities, ", ")),
		AssetId:          variantID,
		Kind:             kind,
		Engine:           engine,
		Entry:            strings.TrimSpace(variant.Entry),
		Files:            append([]string(nil), variant.Files...),
		Repo:             strings.TrimSpace(install.Repo),
		Revision:         strings.TrimSpace(install.Revision),
		Hashes:           hashes,
		FileCount:        int32(len(variant.Files)),
		TotalSizeBytes:   variant.TotalSizeBytes,
		Tags:             verifiedAssetTags(capabilities, variant.Quant),
		InstallKind:      strings.TrimSpace(install.InstallKind),
		LogicalModelId:   strings.TrimSpace(row.ModelID),
		Capabilities:     capabilities,
		ArtifactRoles:    append([]string(nil), install.ArtifactRoles...),
		PreferredEngine:  engine,
		HostRequirements: projectHostRequirements(variant.HostRequirement, engine),
	}, nil
}

// verifiedAssetTags derives the descriptor tag set from capabilities + quant.
func verifiedAssetTags(capabilities []string, quant string) []string {
	tags := []string{"verified"}
	for _, capability := range capabilities {
		switch strings.ToLower(strings.TrimSpace(capability)) {
		case "text.generate", "text.generate.vision":
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

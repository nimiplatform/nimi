package localservice

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"sort"
	"strings"

	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/ggufmeta"

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

// ResolveLocalTextContextMetadata returns exact Runtime-owned context metadata
// for an imported llama GGUF that has no reviewed catalog variant. The
// architecture-scoped GGUF context_length is only a training upper bound.
// Runtime reads the currently leased worker's server-selected capacity and
// verifies that worker is serving this exact model path; an explicit llama
// ctx_size is an additional upper bound. Revision identity comes from the
// installed entry's verified sha256. The caller owns the local-asset lease for
// the whole context-composition and execution interval.
func (s *Service) ResolveLocalTextContextMetadata(ctx context.Context, localAssetID string) (uint64, string, bool) {
	if s == nil {
		return 0, "", false
	}
	localAssetID = strings.TrimSpace(localAssetID)
	s.mu.RLock()
	asset := cloneLocalAsset(s.assets[localAssetID])
	s.mu.RUnlock()
	if asset == nil ||
		asset.GetKind() != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT ||
		!strings.EqualFold(strings.TrimSpace(asset.GetEngine()), "llama") {
		return 0, "", false
	}
	entryHash := expectedManagedModelEntryHash(asset)
	if entryHash == "" {
		return 0, "", false
	}
	entryPath, err := resolveManagedModelEntryAbsolutePath(resolveLocalModelsPath(s.localModelsPath), asset)
	if err != nil {
		return 0, "", false
	}
	summary, err := ggufmeta.InspectPath(entryPath)
	if err != nil {
		return 0, "", false
	}
	contextWindow, ok := ggufmeta.LLMContextLength(summary)
	if !ok || contextWindow < 512 || contextWindow > 1048576 {
		return 0, "", false
	}
	llamaConfig, err := engine.ExtractManagedLlamaEngineConfig(asset.GetEngineConfig())
	if err != nil {
		return 0, "", false
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if refreshed := s.modelByID(localAssetID); refreshed != nil {
		asset = refreshed
	}
	executionWindow, ok := probeLlamaExecutionContextWindow(ctx, s.effectiveLocalModelEndpoint(asset), entryPath)
	if !ok {
		return 0, "", false
	}
	if executionWindow < contextWindow {
		contextWindow = executionWindow
	}
	if llamaConfig.CtxSize > 0 && uint64(llamaConfig.CtxSize) < contextWindow {
		contextWindow = uint64(llamaConfig.CtxSize)
	}
	return contextWindow, "sha256:" + entryHash, true
}

func probeLlamaExecutionContextWindow(ctx context.Context, endpoint string, expectedModelPath string) (uint64, bool) {
	parsed, rootPath, err := parseCanonicalProbeBaseURL(endpoint)
	if err != nil {
		return 0, false
	}
	parsed.Path = path.Join(rootPath, "props")
	probeCtx, cancel := context.WithTimeout(ctx, localHealthProbeTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(probeCtx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return 0, false
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, false
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return 0, false
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, localHealthProbeMaxResponseBodySize+1))
	if err != nil || len(body) == 0 || len(body) > localHealthProbeMaxResponseBodySize {
		return 0, false
	}
	var props struct {
		DefaultGenerationSettings struct {
			ContextWindow uint64 `json:"n_ctx"`
		} `json:"default_generation_settings"`
		ModelPath string `json:"model_path"`
	}
	if err := json.Unmarshal(body, &props); err != nil {
		return 0, false
	}
	executionWindow := props.DefaultGenerationSettings.ContextWindow
	if executionWindow < 512 || executionWindow > 1048576 {
		return 0, false
	}
	expectedInfo, err := os.Stat(strings.TrimSpace(expectedModelPath))
	if err != nil {
		return 0, false
	}
	actualInfo, err := os.Stat(strings.TrimSpace(props.ModelPath))
	if err != nil || !os.SameFile(expectedInfo, actualInfo) {
		return 0, false
	}
	return executionWindow, true
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

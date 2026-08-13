package localservice

import (
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/ggufmeta"
	"github.com/nimiplatform/nimi/runtime/internal/modelregistry"
	"google.golang.org/protobuf/types/known/structpb"
)

func augmentManagedGGUFBundleFacts(
	_ string,
	_ string,
	_ string,
	entryPath string,
	engineName string,
	_ []string,
	_ []string,
	engineConfig *structpb.Struct,
	projectionOverride *modelregistry.NativeProjection,
) (*structpb.Struct, *modelregistry.NativeProjection, error) {
	nextProjection, err := applyManagedGGUFArchitectureFacts(entryPath, engineName, projectionOverride)
	if err != nil {
		return nil, nil, err
	}
	return engineConfig, nextProjection, nil
}

func applyManagedGGUFArchitectureFacts(entryPath string, engineName string, projectionOverride *modelregistry.NativeProjection) (*modelregistry.NativeProjection, error) {
	if strings.ToLower(filepath.Ext(strings.TrimSpace(entryPath))) != ".gguf" {
		return projectionOverride, nil
	}
	summary, err := ggufmeta.InspectPath(entryPath)
	if err != nil {
		return projectionOverride, nil
	}
	next := projectionOverride
	if strings.EqualFold(strings.TrimSpace(engineName), "llama") &&
		strings.EqualFold(ggufmeta.LLMDetectedArchitecture(summary), "gemma4") {
		next = cloneNativeProjectionOverride(next)
		next.Family = "gemma"
	}
	if strings.EqualFold(strings.TrimSpace(engineName), "media") {
		family := stableDiffusionProjectionFamily(summary, entryPath)
		if family != "" {
			next = cloneNativeProjectionOverride(next)
			next.Family = family
		}
		if managedImageProjectionIsIdeogram4Uncond(entryPath, next) {
			next = cloneNativeProjectionOverride(next)
			next.Family = "ideogram4"
			next.ArtifactRoles = []string{"uncond_diffusion_model"}
		}
	}
	return next, nil
}

func stableDiffusionProjectionFamily(summary ggufmeta.Summary, entryPath string) string {
	for _, raw := range []string{
		ggufmeta.StableDiffusionDetectedFamily(summary),
		stableDiffusionSummaryString(summary, "general.name"),
		stableDiffusionSummaryString(summary, "general.architecture"),
		entryPath,
	} {
		if family := normalizeManagedImageProjectionFamily(raw); family != "" {
			return family
		}
	}
	return ""
}

func stableDiffusionSummaryString(summary ggufmeta.Summary, key string) string {
	value, ok := summary.StringValue(key)
	if !ok {
		return ""
	}
	return value
}

func normalizeManagedImageProjectionFamily(value string) string {
	lower := strings.ToLower(strings.TrimSpace(value))
	lower = strings.ReplaceAll(lower, "_", "-")
	switch {
	case strings.Contains(lower, "ideogram4") || strings.Contains(lower, "ideogram-4"):
		return "ideogram4"
	case strings.Contains(lower, "z-image-turbo"),
		strings.Contains(lower, "z-image-base"),
		strings.Contains(lower, "z-image"):
		return "z-image"
	case strings.Contains(lower, "qwen-image"):
		return "qwen-image"
	case strings.Contains(lower, "ovis-image"):
		return "ovis-image"
	case strings.Contains(lower, "chroma"):
		return "chroma"
	case strings.Contains(lower, "flux"):
		return "flux"
	default:
		return ""
	}
}

func managedImageProjectionIsIdeogram4Uncond(entryPath string, projection *modelregistry.NativeProjection) bool {
	if projection == nil {
		return false
	}
	if normalizeProfileRuntimeImageModelFamily(projection.Family) != "ideogram4" {
		return false
	}
	for _, role := range projection.ArtifactRoles {
		if strings.EqualFold(strings.TrimSpace(role), "uncond_diffusion_model") {
			return true
		}
	}
	normalizedPath := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(entryPath), "_", "-"))
	return strings.Contains(normalizedPath, "uncond")
}

func resolveManagedBundleRootAbsolutePath(modelsPath string, model *runtimev1.LocalAssetRecord) (string, error) {
	entryPath, err := resolveManagedModelEntryAbsolutePath(modelsPath, model)
	if err != nil {
		return "", err
	}
	cleanEntry, err := sanitizeManagedEntryPath(model.GetEntry())
	if err != nil {
		return "", err
	}
	root := entryPath
	for _, segment := range strings.Split(filepath.Clean(cleanEntry), string(filepath.Separator)) {
		if strings.TrimSpace(segment) == "" || segment == "." {
			continue
		}
		root = filepath.Dir(root)
	}
	return root, nil
}

func validateManagedBundleRelativeFileExists(bundleRoot string, bundleRelativePath string) error {
	normalized, err := normalizeArtifactRelativeFile(bundleRelativePath)
	if err != nil {
		return err
	}
	bundleAbs, err := filepath.Abs(strings.TrimSpace(bundleRoot))
	if err != nil {
		return fmt.Errorf("resolve managed bundle root: %w", err)
	}
	absPath, err := filepath.Abs(filepath.Join(bundleAbs, filepath.FromSlash(normalized)))
	if err != nil {
		return fmt.Errorf("resolve managed bundle file %q: %w", normalized, err)
	}
	rel, err := filepath.Rel(bundleAbs, absPath)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return fmt.Errorf("managed bundle file %q escapes bundle root", normalized)
	}
	info, err := os.Stat(absPath)
	if err != nil {
		return fmt.Errorf("managed bundle file %q missing", normalized)
	}
	if info.IsDir() {
		return fmt.Errorf("managed bundle file %q must be a file", normalized)
	}
	return nil
}

func listManagedBundleRelativeFiles(bundleRoot string) ([]string, error) {
	root := strings.TrimSpace(bundleRoot)
	if root == "" {
		return nil, nil
	}
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return nil, fmt.Errorf("resolve managed bundle root: %w", err)
	}
	var out []string
	err = filepath.WalkDir(rootAbs, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d == nil || d.IsDir() {
			return nil
		}
		if strings.EqualFold(d.Name(), "asset.manifest.json") {
			return nil
		}
		rel, err := filepath.Rel(rootAbs, path)
		if err != nil {
			return err
		}
		out = append(out, filepath.ToSlash(rel))
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

func capabilityListContains(values []string, want string) bool {
	for _, value := range values {
		if strings.EqualFold(strings.TrimSpace(value), want) {
			return true
		}
	}
	return false
}

func cloneNativeProjectionOverride(input *modelregistry.NativeProjection) *modelregistry.NativeProjection {
	if input == nil {
		return &modelregistry.NativeProjection{}
	}
	cloned := *input
	cloned.ArtifactRoles = append([]string(nil), input.ArtifactRoles...)
	cloned.FallbackEngines = append([]string(nil), input.FallbackEngines...)
	cloned.HostRequirements = cloneHostRequirements(input.HostRequirements)
	return &cloned
}

func healManagedImageNativeProjection(modelsRoot string, record *runtimev1.LocalAssetRecord, logger *slog.Logger) bool {
	if record == nil || invalidProfileRuntimeImageModelFamily(record.GetFamily()) {
		return false
	}
	if !isCanonicalSupervisedImageAsset(record.GetEngine(), record.GetCapabilities(), record.GetKind()) {
		return false
	}
	entryPath, err := resolveManagedModelEntryAbsolutePath(modelsRoot, record)
	if err != nil {
		if logger != nil {
			logger.Warn("skip managed image projection self-heal: resolve entry failed",
				"local_asset_id", record.GetLocalAssetId(),
				"error", err,
			)
		}
		return false
	}
	projection, err := applyManagedGGUFArchitectureFacts(entryPath, record.GetEngine(), &modelregistry.NativeProjection{
		Family:           record.GetFamily(),
		ArtifactRoles:    append([]string(nil), record.GetArtifactRoles()...),
		PreferredEngine:  record.GetPreferredEngine(),
		FallbackEngines:  append([]string(nil), record.GetFallbackEngines()...),
		HostRequirements: cloneHostRequirements(record.GetHostRequirements()),
	})
	if err != nil || projection == nil {
		if err != nil && logger != nil {
			logger.Warn("skip managed image projection self-heal: inspect entry failed",
				"local_asset_id", record.GetLocalAssetId(),
				"entry_path", entryPath,
				"error", err,
			)
		}
		return false
	}
	healed := false
	if family := strings.TrimSpace(projection.Family); family != "" && family != strings.TrimSpace(record.GetFamily()) {
		record.Family = family
		healed = true
	}
	if len(projection.ArtifactRoles) > 0 && !stringSlicesEqual(record.GetArtifactRoles(), projection.ArtifactRoles) {
		record.ArtifactRoles = normalizeStringSlice(projection.ArtifactRoles)
		healed = true
	}
	return healed
}

func stringSlicesEqual(left []string, right []string) bool {
	left = normalizeStringSlice(left)
	right = normalizeStringSlice(right)
	if len(left) != len(right) {
		return false
	}
	sort.Strings(left)
	sort.Strings(right)
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

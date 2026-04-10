package localservice

import (
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/ggufmeta"
	"github.com/nimiplatform/nimi/runtime/internal/modelregistry"
	"google.golang.org/protobuf/types/known/structpb"
)

func augmentManagedLlamaBundleFacts(
	modelsRoot string,
	resolvedBundleRoot string,
	existingBundleRoot string,
	entryPath string,
	engineName string,
	capabilities []string,
	files []string,
	engineConfig *structpb.Struct,
	projectionOverride *modelregistry.NativeProjection,
) (*structpb.Struct, *modelregistry.NativeProjection, error) {
	nextConfig, err := normalizeManagedLlamaBundleEngineConfig(modelsRoot, resolvedBundleRoot, existingBundleRoot, engineName, capabilities, files, engineConfig)
	if err != nil {
		return nil, nil, err
	}
	nextProjection, err := applyManagedGGUFArchitectureFacts(entryPath, engineName, projectionOverride)
	if err != nil {
		return nil, nil, err
	}
	return nextConfig, nextProjection, nil
}

func normalizeManagedLlamaBundleEngineConfig(
	modelsRoot string,
	resolvedBundleRoot string,
	existingBundleRoot string,
	engineName string,
	capabilities []string,
	files []string,
	engineConfig *structpb.Struct,
) (*structpb.Struct, error) {
	if !strings.EqualFold(strings.TrimSpace(engineName), "llama") {
		return engineConfig, nil
	}
	llamaCfg, err := engine.ExtractManagedLlamaEngineConfig(engineConfig)
	if err != nil {
		return nil, err
	}

	if llamaCfg.Mmproj == "" {
		candidates := findMmprojCandidates(files)
		switch len(candidates) {
		case 0:
		case 1:
			if err := validateManagedBundleRelativeFileExists(existingBundleRoot, candidates[0]); err != nil {
				return nil, err
			}
			resolved, err := resolveManagedBundleFileToModelsRelativePath(modelsRoot, resolvedBundleRoot, candidates[0])
			if err != nil {
				return nil, err
			}
			llamaCfg.Mmproj = resolved
		default:
			return nil, fmt.Errorf(
				"multiple mmproj candidates (%s); set engine_config.llama.mmproj explicitly",
				strings.Join(candidates, ", "),
			)
		}
	}

	if llamaCfg.Mmproj != "" {
		if err := validateManagedLlamaMMProjPath(modelsRoot, resolvedBundleRoot, existingBundleRoot, llamaCfg.Mmproj); err != nil {
			return nil, err
		}
	}

	if capabilityListContains(capabilities, "text.generate.vision") && llamaCfg.Mmproj == "" {
		return nil, fmt.Errorf("model declares text.generate.vision but no mmproj artifact available")
	}

	if !llamaEngineConfigNeedsPersistence(engineConfig, llamaCfg) {
		return engineConfig, nil
	}
	return upsertManagedLlamaEngineConfig(engineConfig, llamaCfg), nil
}

func applyManagedGGUFArchitectureFacts(entryPath string, engineName string, projectionOverride *modelregistry.NativeProjection) (*modelregistry.NativeProjection, error) {
	if !strings.EqualFold(strings.TrimSpace(engineName), "llama") {
		return projectionOverride, nil
	}
	if strings.ToLower(filepath.Ext(strings.TrimSpace(entryPath))) != ".gguf" {
		return projectionOverride, nil
	}
	summary, err := ggufmeta.InspectPath(entryPath)
	if err != nil {
		return projectionOverride, nil
	}
	if !strings.EqualFold(ggufmeta.LLMDetectedArchitecture(summary), "gemma4") {
		return projectionOverride, nil
	}

	next := cloneNativeProjectionOverride(projectionOverride)
	next.Family = "gemma"
	return next, nil
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

func resolveManagedBundleFileToModelsRelativePath(modelsRoot string, bundleRoot string, bundleRelativePath string) (string, error) {
	normalized, err := normalizeArtifactRelativeFile(bundleRelativePath)
	if err != nil {
		return "", err
	}
	rootAbs, err := filepath.Abs(strings.TrimSpace(modelsRoot))
	if err != nil {
		return "", fmt.Errorf("resolve models root: %w", err)
	}
	bundleAbs, err := filepath.Abs(strings.TrimSpace(bundleRoot))
	if err != nil {
		return "", fmt.Errorf("resolve managed bundle root: %w", err)
	}
	absPath, err := filepath.Abs(filepath.Join(bundleAbs, filepath.FromSlash(normalized)))
	if err != nil {
		return "", fmt.Errorf("resolve managed bundle file %q: %w", normalized, err)
	}
	rel, err := filepath.Rel(rootAbs, absPath)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("managed bundle file %q escapes models root", normalized)
	}
	return filepath.ToSlash(rel), nil
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

func validateManagedLlamaMMProjPath(modelsRoot string, resolvedBundleRoot string, existingBundleRoot string, mmprojPath string) error {
	trimmed := strings.TrimSpace(mmprojPath)
	if trimmed == "" {
		return nil
	}
	if !strings.HasSuffix(strings.ToLower(trimmed), ".gguf") {
		return fmt.Errorf("extract llama engine config: mmproj must be a .gguf file: %q", trimmed)
	}
	rootAbs, err := filepath.Abs(strings.TrimSpace(modelsRoot))
	if err != nil {
		return fmt.Errorf("resolve models root: %w", err)
	}
	resolvedBundleAbs, err := filepath.Abs(strings.TrimSpace(resolvedBundleRoot))
	if err != nil {
		return fmt.Errorf("resolve managed bundle root: %w", err)
	}
	existingBundleAbs, err := filepath.Abs(strings.TrimSpace(existingBundleRoot))
	if err != nil {
		return fmt.Errorf("resolve managed bundle root: %w", err)
	}
	expectedAbs, err := filepath.Abs(filepath.Join(rootAbs, filepath.FromSlash(trimmed)))
	if err != nil {
		return fmt.Errorf("resolve mmproj path: %w", err)
	}
	rel, err := filepath.Rel(rootAbs, expectedAbs)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return fmt.Errorf("mmproj path %q escapes models root", trimmed)
	}
	validatePath := expectedAbs
	if resolvedBundleAbs != existingBundleAbs {
		if bundleRel, err := filepath.Rel(resolvedBundleAbs, expectedAbs); err == nil &&
			bundleRel != ".." && !strings.HasPrefix(bundleRel, ".."+string(filepath.Separator)) {
			validatePath = filepath.Join(existingBundleAbs, bundleRel)
		}
	}
	info, err := os.Stat(validatePath)
	if err != nil {
		return fmt.Errorf("mmproj path %q missing under models root", trimmed)
	}
	if info.IsDir() {
		return fmt.Errorf("mmproj path %q must be a file", trimmed)
	}
	return nil
}

func upsertManagedLlamaEngineConfig(engineConfig *structpb.Struct, cfg engine.ManagedLlamaEngineConfig) *structpb.Struct {
	root := structToMap(engineConfig)
	llama := valueAsObject(root["llama"])
	if cfg.Mmproj != "" {
		llama["mmproj"] = cfg.Mmproj
	}
	root["llama"] = llama
	return toStruct(root)
}

func llamaEngineConfigNeedsPersistence(engineConfig *structpb.Struct, cfg engine.ManagedLlamaEngineConfig) bool {
	if strings.TrimSpace(cfg.Mmproj) == "" {
		return false
	}
	existing, err := engine.ExtractManagedLlamaEngineConfig(engineConfig)
	if err != nil {
		return false
	}
	return existing.Mmproj != cfg.Mmproj
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

func healMissingMmprojEngineConfig(modelsRoot string, record *runtimev1.LocalAssetRecord, logger *slog.Logger) bool {
	if record == nil {
		return false
	}
	if !strings.EqualFold(strings.TrimSpace(record.GetEngine()), "llama") {
		return false
	}

	llamaCfg, err := engine.ExtractManagedLlamaEngineConfig(record.GetEngineConfig())
	if err != nil {
		if logger != nil {
			logger.Warn("skip llama mmproj self-heal: extract engine config failed",
				"local_asset_id", record.GetLocalAssetId(),
				"error", err,
			)
		}
		return false
	}
	if strings.TrimSpace(llamaCfg.Mmproj) != "" {
		return false
	}

	bundleRoot, err := resolveManagedBundleRootAbsolutePath(modelsRoot, record)
	if err != nil {
		return false
	}
	files, err := listManagedBundleRelativeFiles(bundleRoot)
	if err != nil {
		if logger != nil {
			logger.Warn("skip llama mmproj self-heal: list bundle files failed",
				"local_asset_id", record.GetLocalAssetId(),
				"bundle_root", bundleRoot,
				"error", err,
			)
		}
		return false
	}
	files = normalizeStringSlice(files)
	nextConfig, err := normalizeManagedLlamaBundleEngineConfig(
		modelsRoot,
		bundleRoot,
		bundleRoot,
		record.GetEngine(),
		record.GetCapabilities(),
		files,
		record.GetEngineConfig(),
	)
	if err != nil {
		if logger != nil {
			logger.Warn("skip llama mmproj self-heal: normalize bundle engine config failed",
				"local_asset_id", record.GetLocalAssetId(),
				"bundle_root", bundleRoot,
				"error", err,
			)
		}
		return false
	}

	healed := false
	if len(files) > 0 && !stringSlicesEqual(record.GetFiles(), files) {
		record.Files = append([]string(nil), files...)
		healed = true
	}
	if llamaEngineConfigNeedsPersistence(record.GetEngineConfig(), mustExtractManagedLlamaEngineConfig(nextConfig)) {
		record.EngineConfig = cloneStruct(nextConfig)
		healed = true
	}
	return healed
}

func mustExtractManagedLlamaEngineConfig(engineConfig *structpb.Struct) engine.ManagedLlamaEngineConfig {
	cfg, err := engine.ExtractManagedLlamaEngineConfig(engineConfig)
	if err != nil {
		return engine.ManagedLlamaEngineConfig{}
	}
	return cfg
}

func stringSlicesEqual(left []string, right []string) bool {
	left = normalizeStringSlice(left)
	right = normalizeStringSlice(right)
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

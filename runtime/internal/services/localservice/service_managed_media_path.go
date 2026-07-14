package localservice

import (
	"context"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

func (s *Service) localAssetByID(localArtifactID string) *runtimev1.LocalAssetRecord {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cloneLocalAsset(s.assets[strings.TrimSpace(localArtifactID)])
}

func (s *Service) ResolveManagedAssetPath(_ context.Context, localArtifactID string) (string, error) {
	artifact := s.localAssetByID(localArtifactID)
	relPath, err := s.resolveManagedAssetEntryPath(artifact)
	if err != nil {
		return "", err
	}
	return filepath.Join(s.resolvedLocalModelsPath(), filepath.FromSlash(relPath)), nil
}

func (s *Service) resolveManagedAssetEntryPath(artifact *runtimev1.LocalAssetRecord) (string, error) {
	if artifact == nil {
		return "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	modelsRoot := s.resolvedLocalModelsPath()
	repo := strings.TrimSpace(artifact.GetSource().GetRepo())
	if strings.HasPrefix(repo, "file://") {
		return resolveManagedEntryRelativePath(modelsRoot, artifact.GetAssetId(), repo, artifact.GetEntry())
	}
	if isLocalImportSourceRepo(repo) {
		return "", grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			Message:    "local-import source repos are not storage truth; re-import from asset.manifest.json",
			ActionHint: "reimport_asset_manifest",
		})
	}
	root := strings.TrimSpace(modelsRoot)
	if root == "" {
		return "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	rootAbs = canonicalManagedPath(rootAbs)
	cleanEntry, err := sanitizeManagedEntryPath(artifact.GetEntry())
	if err != nil {
		return "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	var absPath string
	if isRunnableKind(artifact.GetKind()) {
		logicalModelID := strings.Trim(strings.TrimSpace(artifact.GetLogicalModelId()), "/")
		if logicalModelID != "" {
			absPath = filepath.Join(rootAbs, "resolved", filepath.FromSlash(logicalModelID), cleanEntry)
		}
	}
	if absPath == "" {
		absPath = filepath.Join(rootAbs, "resolved", slugifyLocalAssetID(artifact.GetAssetId()), cleanEntry)
	}
	absPath, err = filepath.Abs(absPath)
	if err != nil {
		return "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	if !strings.HasPrefix(absPath, rootAbs+string(filepath.Separator)) && absPath != rootAbs {
		return "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	if _, statErr := os.Stat(absPath); statErr != nil {
		return "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	relPath, err := filepath.Rel(rootAbs, absPath)
	if err != nil {
		return "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	return filepath.ToSlash(relPath), nil
}

func isLocalImportSourceRepo(sourceRepo string) bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(sourceRepo)), "local-import/")
}

func (s *Service) resolvedLocalModelsPath() string {
	s.mu.RLock()
	localModelsPath := s.localModelsPath
	s.mu.RUnlock()
	return resolveLocalModelsPath(localModelsPath)
}

func resolveManagedEntryRelativePath(modelsRoot string, itemID string, sourceRepo string, entry string) (string, error) {
	root := strings.TrimSpace(modelsRoot)
	if root == "" {
		return "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	rootAbs = canonicalManagedPath(rootAbs)
	baseDir, err := resolveManagedBaseDir(rootAbs, itemID, sourceRepo)
	if err != nil {
		return "", err
	}
	cleanEntry := filepath.Clean(strings.TrimSpace(entry))
	if cleanEntry == "." || cleanEntry == "" || filepath.IsAbs(cleanEntry) || cleanEntry == ".." ||
		strings.HasPrefix(cleanEntry, ".."+string(filepath.Separator)) {
		return "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	absPath := filepath.Join(baseDir, cleanEntry)
	absPath, err = filepath.Abs(absPath)
	if err != nil {
		return "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	if !strings.HasPrefix(absPath, rootAbs+string(filepath.Separator)) && absPath != rootAbs {
		return "", grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			Message:    "dynamic local media asset must reside under local models root",
			ActionHint: "reimport_under_local_models_root",
		})
	}
	if _, statErr := os.Stat(absPath); statErr != nil {
		return "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	relPath, err := filepath.Rel(rootAbs, absPath)
	if err != nil {
		return "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	return filepath.ToSlash(relPath), nil
}

func resolveManagedBaseDir(modelsRoot string, itemID string, sourceRepo string) (string, error) {
	repo := strings.TrimSpace(sourceRepo)
	if isLocalImportSourceRepo(repo) {
		return "", grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			Message:    "local-import source repos are not storage truth; re-import from asset.manifest.json",
			ActionHint: "reimport_asset_manifest",
		})
	}
	if strings.HasPrefix(repo, "file://") {
		path, err := resolveManagedFileRepoPath(repo)
		if err != nil || strings.TrimSpace(path) == "" {
			return "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
		}
		if !strings.EqualFold(filepath.Base(path), "asset.manifest.json") {
			return "", grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
				Message:    "file source repos must point to asset.manifest.json",
				ActionHint: "reimport_asset_manifest",
			})
		}
		baseDir, err := filepath.Abs(filepath.Dir(path))
		if err != nil {
			return "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
		}
		resolvedBaseDir, err := filepath.EvalSymlinks(baseDir)
		if err != nil {
			return "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
		}
		return resolvedBaseDir, nil
	}
	return filepath.Join(modelsRoot, slugifyLocalModelID(itemID)), nil
}

func canonicalManagedPath(path string) string {
	resolved, err := filepath.EvalSymlinks(strings.TrimSpace(path))
	if err == nil && strings.TrimSpace(resolved) != "" {
		return resolved
	}
	return path
}

func resolveManagedFileRepoPath(sourceRepo string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(sourceRepo))
	if err != nil {
		return "", err
	}
	path, err := url.PathUnescape(parsed.Path)
	if err != nil {
		return "", err
	}
	switch {
	case runtime.GOOS == "windows" && len(parsed.Host) == 2 && parsed.Host[1] == ':':
		path = parsed.Host + filepath.FromSlash(path)
	case parsed.Host != "" && parsed.Host != "localhost" && runtime.GOOS == "windows":
		path = `\\` + parsed.Host + filepath.FromSlash(path)
	case runtime.GOOS == "windows" && len(path) >= 3 && path[0] == '/' && path[2] == ':':
		path = path[1:]
	case parsed.Host != "" && parsed.Host != "localhost":
		path = string(filepath.Separator) + filepath.Join(parsed.Host, filepath.FromSlash(path))
	}
	return filepath.FromSlash(path), nil
}

func valueAsString(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	default:
		return ""
	}
}

func valueAsObject(value any) map[string]any {
	if object, ok := value.(map[string]any); ok {
		return cloneAnyMap(object)
	}
	return map[string]any{}
}

func valueAsStringSlice(value any) []string {
	raw, ok := value.([]any)
	if !ok {
		if typed, ok := value.([]string); ok {
			return append([]string(nil), typed...)
		}
		return []string{}
	}
	result := make([]string, 0, len(raw))
	for _, item := range raw {
		if text := valueAsString(item); text != "" {
			result = append(result, text)
		}
	}
	return result
}

func cloneAnyMap(input map[string]any) map[string]any {
	if len(input) == 0 {
		return map[string]any{}
	}
	out := make(map[string]any, len(input))
	for key, value := range input {
		switch typed := value.(type) {
		case map[string]any:
			out[key] = cloneAnyMap(typed)
		case []any:
			out[key] = append([]any(nil), typed...)
		default:
			out[key] = typed
		}
	}
	return out
}

func mergeMaps(base map[string]any, overrides map[string]any) map[string]any {
	out := cloneAnyMap(base)
	for key, value := range overrides {
		nextMap, nextIsMap := value.(map[string]any)
		currentMap, currentIsMap := out[key].(map[string]any)
		if nextIsMap && currentIsMap {
			out[key] = mergeMaps(currentMap, nextMap)
			continue
		}
		switch typed := value.(type) {
		case map[string]any:
			out[key] = cloneAnyMap(typed)
		case []any:
			out[key] = append([]any(nil), typed...)
		default:
			out[key] = typed
		}
	}
	return out
}

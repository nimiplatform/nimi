package localservice

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/modelregistry"
	"google.golang.org/grpc/codes"
)

type localAssetImportFacts struct {
	displayName      string
	sourceFileName   string
	importInstanceID string
}

func localAssetImportFactsFromManifest(manifest map[string]any, assetID string, entry string) localAssetImportFacts {
	importInstanceID := manifestStringDefault(manifest, "import_instance_id", "importInstanceId")
	displayName := manifestStringDefault(manifest, "display_name", "displayName")
	sourceFileName := manifestStringDefault(manifest, "source_file_name", "sourceFileName")
	if strings.TrimSpace(importInstanceID) == "" && strings.HasPrefix(strings.TrimSpace(assetID), "local-import/") {
		importInstanceID = newLocalImportInstanceID()
	}
	if strings.TrimSpace(displayName) == "" {
		displayName = defaultLocalImportDisplayName(assetID, importInstanceID)
	}
	if strings.TrimSpace(sourceFileName) == "" {
		sourceFileName = filepath.Base(strings.TrimSpace(entry))
		if sourceFileName == "." {
			sourceFileName = ""
		}
	}
	return localAssetImportFacts{
		displayName:      strings.TrimSpace(displayName),
		sourceFileName:   strings.TrimSpace(sourceFileName),
		importInstanceID: strings.TrimSpace(importInstanceID),
	}
}

func defaultLocalImportDisplayName(assetID string, importInstanceID string) string {
	value := strings.Trim(strings.TrimPrefix(strings.TrimSpace(assetID), "local-import/"), "/")
	instanceID := strings.TrimSpace(importInstanceID)
	if instanceID != "" {
		value = strings.TrimSuffix(value, "/"+instanceID)
	}
	if value == "" {
		value = strings.TrimSpace(assetID)
	}
	if strings.Contains(value, "/") {
		value = filepath.Base(filepath.FromSlash(value))
	}
	return strings.TrimSpace(value)
}

func (s *Service) applyLocalAssetImportFacts(record *runtimev1.LocalAssetRecord, facts localAssetImportFacts) *runtimev1.LocalAssetRecord {
	if record == nil {
		return nil
	}
	if facts.displayName == "" && facts.sourceFileName == "" && facts.importInstanceID == "" {
		return record
	}
	cloned := cloneLocalAsset(record)
	if facts.displayName != "" {
		cloned.DisplayName = facts.displayName
	}
	if facts.sourceFileName != "" {
		cloned.SourceFileName = facts.sourceFileName
	}
	if facts.importInstanceID != "" {
		cloned.ImportInstanceId = facts.importInstanceID
	}
	s.mu.Lock()
	if _, ok := s.assets[cloned.GetLocalAssetId()]; ok {
		s.assets[cloned.GetLocalAssetId()] = cloneLocalAsset(cloned)
	}
	s.mu.Unlock()
	return cloned
}

func (s *Service) ImportLocalAsset(ctx context.Context, req *runtimev1.ImportLocalAssetRequest) (*runtimev1.ImportLocalAssetResponse, error) {
	return s.importLocalAsset(ctx, req, localAssetExistingPolicyDuplicate)
}

func (s *Service) importLocalAsset(_ context.Context, req *runtimev1.ImportLocalAssetRequest, existingPolicy localAssetExistingPolicy) (*runtimev1.ImportLocalAssetResponse, error) {
	manifestPath := strings.TrimSpace(req.GetManifestPath())
	if manifestPath == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID)
	}
	if err := validateResolvedModelManifestPath(manifestPath, resolveLocalModelsPath(s.localModelsPath)); err != nil {
		return nil, grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID,
			err,
			grpcerr.ReasonOptions{Message: "local asset manifest path is invalid"},
		)
	}
	content, err := os.ReadFile(manifestPath)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID,
			err,
			grpcerr.ReasonOptions{Message: "local asset manifest could not be read"},
		)
	}
	var manifest map[string]any
	if err := json.Unmarshal(content, &manifest); err != nil {
		return nil, grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID,
			err,
			grpcerr.ReasonOptions{Message: "local asset manifest is not valid JSON"},
		)
	}

	if manifestHasAnyKey(manifest, "model_id", "modelId", "artifact_id", "artifactId", "assetId", "asset_kind", "assetKind", "logicalModelId", "localInvokeProfileId", "endpoint") {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID)
	}
	assetID, ok := manifestString(manifest, "asset_id")
	if !ok || strings.TrimSpace(assetID) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID)
	}
	kind, ok := manifestAssetKind(manifest, "kind")
	if !ok || kind == runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID)
	}
	engineConfig, engineConfigErr := manifestStruct(manifest, "engine_config", "engineConfig")
	if engineConfigErr != nil {
		return nil, grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID,
			engineConfigErr,
			grpcerr.ReasonOptions{Message: "local asset manifest engine_config is invalid"},
		)
	}
	if req.GetEngineConfig() != nil {
		engineConfig = cloneStruct(req.GetEngineConfig())
	}
	capabilities, capsErr := manifestStringSlice(manifest, "capabilities")
	if capsErr != nil {
		return nil, grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID,
			capsErr,
			grpcerr.ReasonOptions{Message: "local asset manifest capabilities are invalid"},
		)
	}
	capabilities = normalizeAssetCapabilities(capabilities)
	if isRunnableKind(kind) && len(capabilities) == 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID)
	}
	if !isRunnableKind(kind) && len(capabilities) > 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID)
	}
	artifactRoles, artifactRolesErr := manifestStringSliceKeys(manifest, "artifact_roles", "artifactRoles")
	if artifactRolesErr != nil {
		return nil, grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID,
			artifactRolesErr,
			grpcerr.ReasonOptions{Message: "local asset manifest artifact_roles are invalid"},
		)
	}
	hashes, hashesErr := manifestStringMap(manifest, "hashes")
	if hashesErr != nil {
		return nil, grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID,
			hashesErr,
			grpcerr.ReasonOptions{Message: "local asset manifest hashes are invalid"},
		)
	}
	manifestFiles := valueAsStringSlice(manifest["files"])
	bundleEntries, bundleEntriesErr := localBundleEntriesFromManifest(manifest, hashes)
	if bundleEntriesErr != nil {
		return nil, grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID,
			bundleEntriesErr,
			grpcerr.ReasonOptions{Message: "local asset bundle entry manifest is invalid"},
		)
	}
	engine := defaultLocalEngine(manifestStringDefault(manifest, "engine"), capabilities)
	preferredEngine := manifestStringDefault(manifest, "preferred_engine", "preferredEngine")
	if preferredEngine == "" && !isRunnableKind(kind) {
		preferredEngine = engine
	}
	entry := defaultString(manifestStringDefault(manifest, "entry"), "./dist/index.js")
	importFacts := localAssetImportFactsFromManifest(manifest, assetID, entry)
	license := defaultString(manifestStringDefault(manifest, "license"), "unknown")
	if err := validateImportManifestDeclaredFileHashes(manifest, hashes); err != nil {
		return nil, grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID,
			err,
			grpcerr.ReasonOptions{Message: "local asset manifest requires non-empty sha256 hash declarations"},
		)
	}
	fallbackEngines, fallbackEnginesErr := manifestStringSliceKeys(manifest, "fallback_engines", "fallbackEngines")
	if fallbackEnginesErr != nil {
		return nil, grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID,
			fallbackEnginesErr,
			grpcerr.ReasonOptions{Message: "local asset manifest fallback_engines are invalid"},
		)
	}
	logicalModelID := manifestStringDefault(manifest, "logical_model_id")
	repo := manifestStringDefault(manifest, "repo")
	revision := defaultString(manifestStringDefault(manifest, "revision"), "import")
	if sourceValue, ok := manifest["source"]; ok {
		sourceObj, objOK := sourceValue.(map[string]any)
		if !objOK {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID)
		}
		if sourceRepo, ok := manifestString(sourceObj, "repo"); ok {
			repo = sourceRepo
		}
		if sourceRevision, ok := manifestString(sourceObj, "revision"); ok {
			revision = sourceRevision
		}
	}
	if repo == "" {
		repo = "file://" + manifestPath
	}
	if len(manifestFiles) > 0 {
		repo = "file://" + filepath.ToSlash(manifestPath)
		tempModel := &runtimev1.LocalAssetRecord{
			AssetId:        assetID,
			Kind:           kind,
			Capabilities:   append([]string(nil), capabilities...),
			Engine:         engine,
			Entry:          entry,
			Files:          append([]string(nil), manifestFiles...),
			Source:         &runtimev1.LocalAssetSource{Repo: repo, Revision: revision},
			Hashes:         cloneStringMap(hashes),
			LogicalModelId: logicalModelID,
		}
		entryPath, resolveErr := resolveManagedModelEntryAbsolutePath(resolveLocalModelsPath(s.localModelsPath), tempModel)
		if resolveErr != nil {
			return nil, grpcerr.WrapWithReasonCode(
				codes.InvalidArgument,
				runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID,
				resolveErr,
				grpcerr.ReasonOptions{Message: "local model entry path is invalid"},
			)
		}
		if validateErr := s.validateManagedModelEntryForModel(entryPath, tempModel); validateErr != nil {
			return nil, grpcerr.WrapWithReasonCode(
				codes.InvalidArgument,
				runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID,
				validateErr,
				grpcerr.ReasonOptions{Message: "local model entry is incompatible with its declared asset kind"},
			)
		}
		engineConfig, projectionOverride, augmentErr := augmentManagedGGUFBundleFacts(
			resolveLocalModelsPath(s.localModelsPath),
			filepath.Dir(manifestPath),
			filepath.Dir(manifestPath),
			entryPath,
			engine,
			capabilities,
			manifestFiles,
			engineConfig,
			&modelregistry.NativeProjection{
				LogicalModelID:  logicalModelID,
				Family:          manifestStringDefault(manifest, "family"),
				ArtifactRoles:   artifactRoles,
				PreferredEngine: preferredEngine,
				FallbackEngines: normalizePublicFallbackEngines(fallbackEngines),
			},
		)
		if augmentErr != nil {
			return nil, grpcerr.WrapWithReasonCode(
				codes.InvalidArgument,
				runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID,
				augmentErr,
				grpcerr.ReasonOptions{Message: "local model bundle metadata is invalid"},
			)
		}
		record, err := s.installLocalAssetRecord(
			assetID,
			kind,
			normalizeStringSlice(capabilities),
			engine,
			entry,
			license,
			repo,
			revision,
			hashes,
			manifestStringDefault(manifest, "local_invoke_profile_id"),
			engineConfig,
			projectionOverride,
			"runtime_model_imported",
			manifestPath,
			existingPolicy,
		)
		if err != nil {
			return nil, err
		}
		record = s.applyLocalAssetImportFacts(record, importFacts)
		record = applyLocalAssetBundleManifest(s, record, manifestFiles, bundleEntries)
		return &runtimev1.ImportLocalAssetResponse{Asset: record}, nil
	}
	record, err := s.installLocalAssetRecord(
		assetID,
		kind,
		normalizeStringSlice(capabilities),
		engine,
		entry,
		license,
		repo,
		revision,
		hashes,
		manifestStringDefault(manifest, "local_invoke_profile_id"),
		engineConfig,
		&modelregistry.NativeProjection{
			LogicalModelID:  logicalModelID,
			Family:          manifestStringDefault(manifest, "family"),
			ArtifactRoles:   artifactRoles,
			PreferredEngine: preferredEngine,
			FallbackEngines: normalizePublicFallbackEngines(fallbackEngines),
		},
		"runtime_model_imported",
		manifestPath,
		existingPolicy,
	)
	if err != nil {
		return nil, err
	}
	record = s.applyLocalAssetImportFacts(record, importFacts)
	record = applyLocalAssetBundleManifest(s, record, manifestFiles, bundleEntries)
	return &runtimev1.ImportLocalAssetResponse{Asset: record}, nil
}

func validateImportManifestDeclaredFileHashes(manifest map[string]any, hashes map[string]string) error {
	files := normalizeStringSlice(valueAsStringSlice(manifest["files"]))
	if len(files) == 0 {
		return nil
	}
	for _, file := range files {
		if strings.TrimSpace(file) == "" {
			continue
		}
		if expectedModelSHA256(hashes, file) == "" {
			return fmt.Errorf("manifest file %q requires non-empty sha256 hash", file)
		}
	}
	return nil
}

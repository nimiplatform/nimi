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

	if manifestHasAnyKey(manifest, "model_id", "modelId", "artifact_id", "artifactId", "assetId", "asset_kind", "assetKind", "logicalModelId", "localInvokeProfileId") {
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
	engine := defaultLocalEngine(manifestStringDefault(manifest, "engine"), capabilities)
	preferredEngine := manifestStringDefault(manifest, "preferred_engine", "preferredEngine")
	if preferredEngine == "" && !isRunnableKind(kind) {
		preferredEngine = engine
	}
	entry := defaultString(manifestStringDefault(manifest, "entry"), "./dist/index.js")
	importFacts := localAssetImportFactsFromManifest(manifest, assetID, entry)
	license := defaultString(manifestStringDefault(manifest, "license"), "unknown")
	endpoint := strings.TrimSpace(req.GetEndpoint())
	if endpoint == "" {
		endpoint = manifestStringDefault(manifest, "endpoint")
	}
	binding := resolveInstallRuntimeBinding(
		engine,
		capabilities,
		kind,
		endpoint,
		collectDeviceProfile(),
	)
	binding = normalizeLocalImportRuntimeBinding(engine, capabilities, kind, binding)
	if err := validateImportManifestDeclaredFileHashes(manifest, manifestPath, hashes, normalizeRuntimeMode(binding.mode) == runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED); err != nil {
		return nil, grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID,
			err,
			grpcerr.ReasonOptions{Message: "local asset manifest requires non-empty sha256 hash declarations"},
		)
	}
	deviceProfile := collectDeviceProfile()
	importCompatibilityDetail := ""
	if isCanonicalSupervisedImageAsset(engine, capabilities, kind) {
		manifestFacts := canonicalImageResolverFactsForImport(
			engine,
			capabilities,
			kind,
			entry,
			nil,
			hashes,
			artifactRoles,
			preferredEngine,
			engineConfig,
		)
		if !canonicalSupervisedImageSelectionSupported(deviceProfile, manifestFacts) {
			importCompatibilityDetail = strings.TrimSpace(canonicalSupervisedImageSelection(deviceProfile, manifestFacts).CompatibilityDetail)
		}
	}
	if isRunnableKind(kind) && normalizeRuntimeMode(binding.mode) == runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT && strings.TrimSpace(binding.endpoint) == "" {
		if detail := attachedEndpointRequiredDetailForAsset(engine, capabilities, kind, collectDeviceProfile()); detail != "" {
			return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_ENDPOINT_REQUIRED, grpcerr.ReasonOptions{
				Message:    detail,
				ActionHint: "set_local_provider_endpoint",
			})
		}
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_ENDPOINT_REQUIRED)
	}
	if detail := attachedLoopbackConfigErrorDetail(engine, binding.mode, binding.endpoint, collectDeviceProfile()); detail != "" {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_ENDPOINT_REQUIRED, grpcerr.ReasonOptions{
			Message:    detail,
			ActionHint: "set_local_provider_endpoint",
		})
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
	if normalizeRuntimeMode(binding.mode) == runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED {
		repo = "file://" + filepath.ToSlash(manifestPath)
	}
	if normalizeRuntimeMode(binding.mode) == runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED {
		tempModel := &runtimev1.LocalAssetRecord{
			AssetId:        assetID,
			Kind:           kind,
			Capabilities:   append([]string(nil), capabilities...),
			Engine:         engine,
			Entry:          entry,
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
				grpcerr.ReasonOptions{Message: "local model entry is incompatible with its runtime-supported diffusion or model declaration"},
			)
		}
		bundleFiles := valueAsStringSlice(manifest["files"])
		if len(bundleFiles) == 0 {
			discoveredFiles, err := listManagedBundleRelativeFiles(filepath.Dir(manifestPath))
			if err != nil {
				return nil, grpcerr.WrapWithReasonCode(
					codes.InvalidArgument,
					runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID,
					err,
					grpcerr.ReasonOptions{Message: "managed model bundle contents could not be enumerated"},
				)
			}
			bundleFiles = discoveredFiles
		}
		engineConfig, projectionOverride, augmentErr := augmentManagedGGUFBundleFacts(
			resolveLocalModelsPath(s.localModelsPath),
			filepath.Dir(manifestPath),
			filepath.Dir(manifestPath),
			entryPath,
			engine,
			capabilities,
			bundleFiles,
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
				grpcerr.ReasonOptions{Message: "managed model bundle metadata is invalid"},
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
			binding.endpoint,
			binding.mode,
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
		record, err = s.finalizeImportedCanonicalImageRecord(record, importCompatibilityDetail)
		if err != nil {
			return nil, err
		}
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
		binding.endpoint,
		binding.mode,
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
	record, err = s.finalizeImportedCanonicalImageRecord(record, importCompatibilityDetail)
	if err != nil {
		return nil, err
	}
	return &runtimev1.ImportLocalAssetResponse{Asset: record}, nil
}

func validateImportManifestDeclaredFileHashes(manifest map[string]any, manifestPath string, hashes map[string]string, supervised bool) error {
	files := normalizeStringSlice(valueAsStringSlice(manifest["files"]))
	if len(files) == 0 {
		if !supervised {
			return nil
		}
		discovered, err := listManagedBundleRelativeFiles(filepath.Dir(manifestPath))
		if err != nil {
			return err
		}
		files = normalizeStringSlice(discovered)
	}
	if supervised && len(files) == 0 {
		return fmt.Errorf("supervised import manifest files are required")
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

func (s *Service) finalizeImportedCanonicalImageRecord(record *runtimev1.LocalAssetRecord, compatibilityDetail string) (*runtimev1.LocalAssetRecord, error) {
	if record == nil {
		return nil, nil
	}
	if strings.TrimSpace(compatibilityDetail) == "" {
		return record, nil
	}
	return s.updateModelStatus(
		record.GetLocalAssetId(),
		runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY,
		strings.TrimSpace(compatibilityDetail),
	)
}

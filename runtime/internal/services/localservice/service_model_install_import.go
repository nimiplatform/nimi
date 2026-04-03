package localservice

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/modelregistry"
	"google.golang.org/grpc/codes"
)

func (s *Service) ImportLocalAsset(_ context.Context, req *runtimev1.ImportLocalAssetRequest) (*runtimev1.ImportLocalAssetResponse, error) {
	manifestPath := strings.TrimSpace(req.GetManifestPath())
	if manifestPath == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID)
	}
	if err := validateResolvedModelManifestPath(manifestPath, resolveLocalModelsPath(s.localModelsPath)); err != nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID)
	}
	content, err := os.ReadFile(manifestPath)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID)
	}
	var manifest map[string]any
	if err := json.Unmarshal(content, &manifest); err != nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID)
	}

	if manifestHasAnyKey(manifest, "model_id", "modelId", "artifact_id", "artifactId") {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID)
	}
	assetID, ok := manifestString(manifest, "asset_id", "assetId")
	if !ok || strings.TrimSpace(assetID) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID)
	}
	kind, ok := manifestAssetKind(manifest, "kind", "asset_kind", "assetKind")
	if !ok || kind == runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID)
	}
	engineConfig, engineConfigErr := manifestStruct(manifest, "engine_config", "engineConfig")
	if engineConfigErr != nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID)
	}
	if req.GetEngineConfig() != nil {
		engineConfig = cloneStruct(req.GetEngineConfig())
	}
	capabilities, capsErr := manifestStringSlice(manifest, "capabilities")
	if capsErr != nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID)
	}
	if isRunnableKind(kind) && len(capabilities) == 0 {
		capabilities = defaultCapabilitiesForAssetKind(kind)
	}
	if isRunnableKind(kind) && len(capabilities) == 0 {
		capabilities = []string{"chat"}
	}
	if !isRunnableKind(kind) && len(capabilities) > 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID)
	}
	preferredEngine := manifestStringDefault(manifest, "preferred_engine", "preferredEngine")
	artifactRoles, artifactRolesErr := manifestStringSliceKeys(manifest, "artifact_roles", "artifactRoles")
	if artifactRolesErr != nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID)
	}
	hashes, hashesErr := manifestStringMap(manifest, "hashes")
	if hashesErr != nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID)
	}
	engine := defaultLocalEngine(manifestStringDefault(manifest, "engine"), capabilities)
	entry := defaultString(manifestStringDefault(manifest, "entry"), "./dist/index.js")
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
	deviceProfile := collectDeviceProfile()
	if detail := canonicalSupervisedImageAttachedEndpointDetail(engine, capabilities, kind); detail != "" &&
		normalizeRuntimeMode(binding.mode) == runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT {
		return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			Message:    detail,
			ActionHint: "use_supported_supervised_image_host",
		})
	}
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
			return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
				Message:    strings.TrimSpace(canonicalSupervisedImageSelection(deviceProfile, manifestFacts).CompatibilityDetail),
				ActionHint: "use_supported_supervised_image_host",
			})
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
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID)
	}
	logicalModelID := manifestStringDefault(manifest, "logical_model_id", "logicalModelId")
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
			return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID, grpcerr.ReasonOptions{
				Message: resolveErr.Error(),
			})
		}
		if validateErr := s.validateManagedModelEntryForModel(entryPath, tempModel); validateErr != nil {
			return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID, grpcerr.ReasonOptions{
				Message: validateErr.Error(),
			})
		}
		bundleFiles := valueAsStringSlice(manifest["files"])
		if len(bundleFiles) == 0 {
			discoveredFiles, err := listManagedBundleRelativeFiles(filepath.Dir(manifestPath))
			if err != nil {
				return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID, grpcerr.ReasonOptions{
					Message: err.Error(),
				})
			}
			bundleFiles = discoveredFiles
		}
		engineConfig, projectionOverride, augmentErr := augmentManagedLlamaBundleFacts(
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
			return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID, grpcerr.ReasonOptions{
				Message: augmentErr.Error(),
			})
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
			manifestStringDefault(manifest, "local_invoke_profile_id", "localInvokeProfileId"),
			engineConfig,
			projectionOverride,
			"runtime_model_imported",
			manifestPath,
			true,
		)
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
		manifestStringDefault(manifest, "local_invoke_profile_id", "localInvokeProfileId"),
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
		true,
	)
	if err != nil {
		return nil, err
	}
	return &runtimev1.ImportLocalAssetResponse{Asset: record}, nil
}

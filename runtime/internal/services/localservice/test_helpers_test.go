package localservice

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func mustInstallAttachedLocalModel(t *testing.T, svc *Service, req installLocalAssetParams) *runtimev1.LocalAssetRecord {
	t.Helper()
	capabilities := normalizeStringSlice(req.capabilities)
	engine := defaultLocalEngine(req.engine, capabilities)
	endpoint := req.endpoint
	if endpoint == "" {
		endpoint = managedDefaultEndpointForEngine(engine)
	}
	record, err := svc.installLocalAsset(context.Background(), installLocalAssetParams{
		assetID:      req.assetID,
		repo:         req.repo,
		revision:     req.revision,
		capabilities: capabilities,
		engine:       engine,
		entry:        req.entry,
		files:        append([]string(nil), req.files...),
		license:      req.license,
		hashes:       cloneStringMap(req.hashes),
		endpoint:     endpoint,
		engineConfig: cloneStruct(req.engineConfig),
	})
	if err != nil {
		t.Fatalf("install local model: %v", err)
	}
	return record
}

func mustInstallSupervisedLocalModel(t *testing.T, svc *Service, req installLocalAssetParams) *runtimev1.LocalAssetRecord {
	t.Helper()
	capabilities := normalizeStringSlice(req.capabilities)
	engine := defaultLocalEngine(req.engine, capabilities)
	record, err := svc.installLocalAssetRecord(
		req.assetID,
		inferAssetKindFromCapabilities(capabilities),
		capabilities,
		engine,
		defaultString(req.entry, "./dist/index.js"),
		defaultString(req.license, "unknown"),
		req.repo,
		defaultString(req.revision, "main"),
		req.hashes,
		"",
		runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED,
		"",
		req.engineConfig,
		nil,
		"runtime_model_ready_after_install",
		"model installed",
		localAssetExistingPolicyFail,
	)
	if err != nil {
		t.Fatalf("install supervised local model: %v", err)
	}
	return record
}

func verifiedSelectedSourceRecordForTest(record localEnvironmentSelectedSourceRecordState) localEnvironmentSelectedSourceRecordState {
	if record.SourceKind == "" {
		record.SourceKind = localEnvironmentSourceManaged
	}
	if record.CanonicalRoot == "" {
		record.CanonicalRoot = "test-canonical-root"
	}
	if record.Version == "" && len(record.Hashes) == 0 {
		record.Version = "test-version"
	}
	if len(record.CompatibilityEvidence) == 0 {
		record.CompatibilityEvidence = []string{"test compatibility evidence"}
	}
	if len(record.VerifiedArtifacts) == 0 {
		record.VerifiedArtifacts = []string{"test-artifact"}
	}
	if len(record.SelectedConsumers) == 0 {
		record.SelectedConsumers = []string{"test-consumer"}
	}
	if record.SourceManifestRef == "" {
		record.SourceManifestRef = "test-source-manifest#" + shortHash(record.EnvironmentKey)
	}
	if record.VerificationEvidenceRef == "" {
		record.VerificationEvidenceRef = "test-verification-evidence#" + shortHash(record.EnvironmentKey)
	}
	if record.AuditReasonCode == "" {
		record.AuditReasonCode = "test_ready"
	}
	return record
}

func writeSelectedSourceLocalArtifactsForTest(t *testing.T, record localEnvironmentSelectedSourceRecordState) {
	t.Helper()
	for _, check := range localEnvironmentSelectedSourceLocalArtifactChecks(record) {
		if check.Path == "" {
			continue
		}
		if check.RequireDirectory {
			if err := os.MkdirAll(check.Path, 0o755); err != nil {
				t.Fatalf("mkdir selected source artifact dir %q: %v", check.Path, err)
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(check.Path), 0o755); err != nil {
			t.Fatalf("mkdir selected source artifact parent %q: %v", check.Path, err)
		}
		if err := os.WriteFile(check.Path, []byte("test artifact"), 0o644); err != nil {
			t.Fatalf("write selected source artifact %q: %v", check.Path, err)
		}
	}
}

func writeManagedBundleFilesForTest(t *testing.T, svc *Service, model *runtimev1.LocalAssetRecord, declaredFiles []string, files map[string][]byte) string {
	t.Helper()
	if model == nil {
		t.Fatal("missing local asset")
	}
	modelsRoot := resolveLocalModelsPath(svc.localModelsPath)
	bundleDir := runtimeManagedResolvedModelDir(modelsRoot, model.GetLogicalModelId())
	if err := os.MkdirAll(bundleDir, 0o755); err != nil {
		t.Fatalf("mkdir managed bundle dir: %v", err)
	}
	for relativePath, content := range files {
		targetPath := filepath.Join(bundleDir, filepath.FromSlash(relativePath))
		if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
			t.Fatalf("mkdir managed bundle file dir: %v", err)
		}
		if err := os.WriteFile(targetPath, content, 0o644); err != nil {
			t.Fatalf("write managed bundle file %q: %v", relativePath, err)
		}
	}
	normalizedDeclaredFiles := normalizeStringSlice(declaredFiles)
	if len(normalizedDeclaredFiles) == 0 {
		normalizedDeclaredFiles = make([]string, 0, len(files))
		for relativePath := range files {
			normalizedDeclaredFiles = append(normalizedDeclaredFiles, relativePath)
		}
	}
	sort.Strings(normalizedDeclaredFiles)
	manifestPath := runtimeManagedAssetManifestPath(modelsRoot, model.GetLogicalModelId())
	if err := writeModelManifest(manifestPath, managedModelManifestDescriptor{
		assetID:        model.GetAssetId(),
		kind:           model.GetKind(),
		logicalModelID: model.GetLogicalModelId(),
		capabilities:   append([]string(nil), model.GetCapabilities()...),
		engine:         model.GetEngine(),
		entry:          model.GetEntry(),
		files:          normalizedDeclaredFiles,
		license:        model.GetLicense(),
		repo:           defaultString(model.GetSource().GetRepo(), "test/managed-bundle"),
		revision:       defaultString(model.GetSource().GetRevision(), "main"),
		hashes:         cloneStringMap(model.GetHashes()),
		endpoint:       model.GetEndpoint(),
		engineConfig:   cloneStruct(model.GetEngineConfig()),
		integrityMode:  "test",
	}); err != nil {
		t.Fatalf("write managed bundle manifest: %v", err)
	}
	svc.rewriteManagedLocalAssetSourceRepo(model.GetLocalAssetId(), manifestPath)
	return bundleDir
}
